import {
  nzParts, nzYMD, nzMidnight, addDays, fmtTime, NZ_TZ,
} from "./astro.js";
import {
  SPOTS, spotById, loadWeather, buildDay, snapshotFor, describeSky, GATES_URL,
} from "./conditions.js";

/* ------------------------------------------------------------------ helpers */

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");

const ICONS = {
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  wind: '<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 9.5 4.25 4.25 0 0 1 17 18z"/>',
  drop: '<path d="M12 3s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.2 12 3 12 3z"/>',
  gauge: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="m12 16 4-5"/>',
  sunrise: '<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 6v3M5.6 10.6l1.8 1.8M18.4 10.6l-1.8 1.8"/>',
  sunset: '<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 12V9M5.6 10.6l1.8 1.8M18.4 10.6l-1.8 1.8"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11"/>',
  map: '<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  fish: '<path d="M2 12c3-4.5 8-6 13-3.5L19 6v12l-4-2.5C10 18 5 16.5 2 12z"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
};
const icon = (name, size = 20, extra = "") =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${ICONS[name] || ""}</svg>`;

const dayFmt = new Intl.DateTimeFormat("en-NZ", { timeZone: NZ_TZ, weekday: "short", day: "numeric", month: "short" });
const stampFmt = new Intl.DateTimeFormat("en-NZ", {
  timeZone: NZ_TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const dayLabel = (ymd) => dayFmt.format(new Date(nzMidnight(ymd) + 6 * 3600e3)).replace(",", "");
const stamp = (iso) => stampFmt.format(new Date(iso)).replace(",", "");
const round = (n) => (n == null ? "–" : Math.round(n));

const LURE_TYPES = [
  ["spinner", "Spinner / spoon"], ["minnow", "Minnow"], ["soft-bait", "Soft bait"], ["fly", "Fly"], ["bait", "Bait"], ["other", "Other"],
];
const LURE_LABEL = Object.fromEntries(LURE_TYPES);
const SPECIES = ["Brown trout", "Rainbow trout", "Chinook salmon", "Other"];

/* ------------------------------------------------------------------ state */

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const state = {
  ready: false,
  user: null,
  inviteRequired: false,
  spotId: store.get("tr_spot", SPOTS[0].id),
  ymd: nzYMD(Date.now()),
  weather: null,
  weatherErr: "",
  weatherLoading: false,
  catches: null,
  catchesErr: "",
  filter: "all",
  species: "all",
  draft: null,
  saving: false,
  authMode: "in",
  authErr: "",
  authBusy: false,
  installEvt: null,
};
if (!SPOTS.some((s) => s.id === state.spotId)) state.spotId = SPOTS[0].id;

async function api(path, { method = "GET", json, body, headers = {} } = {}) {
  const res = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: { "x-requested-with": "tailrace", ...(json ? { "content-type": "application/json" } : {}), ...headers },
    body: json ? JSON.stringify(json) : body,
  });
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) {
    const err = new Error(data?.error || "Something went wrong. Try again.");
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ------------------------------------------------------------------ routing */

const PROTECTED = ["log", "map", "add", "edit", "catch", "account"];
function route() {
  const parts = (location.hash.replace(/^#\/?/, "") || "today").split("/");
  return { name: parts[0] || "today", id: parts[1] };
}
const go = (hash) => { location.hash = hash; };

/* ------------------------------------------------------------------ data loading */

async function ensureWeather(force = false) {
  if (state.weatherLoading) return;
  if (state.weather && !force && state.weather._spot === state.spotId) return;
  state.weatherLoading = true;
  state.weatherErr = "";
  render();
  try {
    const spot = spotById(state.spotId);
    const w = await loadWeather(spot, { force });
    w._spot = state.spotId;
    state.weather = w;
    if (!w.days.includes(state.ymd)) state.ymd = w.days[0];
  } catch (e) {
    state.weatherErr = navigator.onLine ? "Couldn't reach the weather service." : "You're offline, so there's no forecast right now.";
  } finally {
    state.weatherLoading = false;
    render();
  }
}

async function ensureCatches(force = false) {
  if (!state.user) return;
  if (state.catches && !force) return;
  try {
    state.catchesErr = "";
    state.catches = (await api("/catches")).catches;
  } catch (e) {
    if (e.status === 401) { state.user = null; }
    state.catchesErr = e.message;
    state.catches = state.catches || [];
  }
  render();
}

/* ------------------------------------------------------------------ rendering: shell */

function brandMark(size = 28) {
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" fill="none" stroke="#0E6F73" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12c4-4 6 4 10 0s6 4 10 0 4 2 6 0"/><path d="M3 21c4-4 6 4 10 0s6 4 10 0 4 2 6 0"/></svg>`;
}

function shell(name, inner) {
  const tab = (href, id, label, ic) =>
    `<a class="tab ${name === id ? "on" : ""}" href="${href}" ${name === id ? 'aria-current="page"' : ""}>${icon(ic, 24)}<span>${label}</span></a>`;
  const link = (href, id, label) => `<a class="navlink ${name === id ? "on" : ""}" href="${href}">${label}</a>`;
  const acct = state.user
    ? `<a class="acct" href="#/account" aria-label="Account">${esc(state.user.name.slice(0, 1).toUpperCase())}</a>`
    : `<a class="btn ghost small" href="#/auth">Sign in</a>`;
  return `
  <div class="shell">
    <header class="top">
      <a class="brand" href="#/today">${brandMark()}<span>Tailrace</span></a>
      <nav class="topnav" aria-label="Main">${link("#/today", "today", "Today")}${link("#/log", "log", "Log")}${link("#/map", "map", "Map")}</nav>
      <div class="topright">
        <a class="btn primary small addbtn" href="#/add">${icon("plus", 18)}Add catch</a>
        ${acct}
      </div>
    </header>
    <main class="main" id="view">${inner}</main>
    <nav class="tabs" aria-label="Main">
      ${tab("#/today", "today", "Today", "sun")}
      ${tab("#/log", "log", "Log", "book")}
      <a class="fab" href="#/add" aria-label="Add a catch">${icon("plus", 26)}</a>
      ${tab("#/map", "map", "Map", "map")}
    </nav>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
  </div>`;
}

function toast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

let lastRoute = "";
function render() {
  if (!state.ready) return;
  const r = route();
  let name = r.name;
  const needsAuth = PROTECTED.includes(name) && !state.user;
  if (needsAuth) name = "auth";
  if (name === "auth" && state.user) { go("#/today"); return; }

  const key = location.hash;
  const scroll = key === lastRoute ? window.scrollY : 0;
  lastRoute = key;

  let inner = "";
  let after = null;
  switch (name) {
    case "today": inner = viewToday(); break;
    case "log": inner = viewLog(); after = null; break;
    case "catch": inner = viewCatch(r.id); after = mountCatchMap; break;
    case "add":
    case "edit": inner = viewForm(r); after = mountFormMap; break;
    case "map": inner = viewMap(); after = mountBigMap; break;
    case "account": inner = viewAccount(); break;
    case "auth": inner = viewAuth(); break;
    default: inner = `<div class="card"><h2>Not found</h2><a class="btn" href="#/today">Back to Today</a></div>`;
  }
  const active = name === "edit" ? "add" : name;
  $("#app").innerHTML = shell(active, inner);
  window.scrollTo(0, scroll);
  if (after) after();
}

/* ------------------------------------------------------------------ Today */

function viewToday() {
  const spot = spotById(state.spotId);
  const w = state.weather;
  const spotSelect = `
    <label class="spot-pick">${icon("pin", 18)}
      <span class="sr">Fishing spot</span>
      <select data-change="spot">${SPOTS.map((s) => `<option value="${s.id}" ${s.id === state.spotId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
      ${icon("chevDown", 16)}
    </label>`;

  let body = "";
  if (state.weatherLoading && !w) body = `<div class="card muted-card">Loading conditions…</div>`;
  else if (state.weatherErr && !w)
    body = `<div class="card"><p>${esc(state.weatherErr)}</p><button class="btn primary" data-action="refresh">Try again</button></div>`;
  else if (w) body = todayBody(w, spot);

  const idx = w ? w.days.indexOf(state.ymd) : 0;
  const todayYmd = nzYMD(Date.now());
  const sub = state.ymd === todayYmd ? "Today" : state.ymd === addDays(todayYmd, 1) ? "Tomorrow" : "";
  const head = `
    <div class="today-head">
      <div class="dayswitch">
        <button class="round" aria-label="Previous day" data-action="day" data-v="-1" ${idx <= 0 ? "disabled" : ""}>${icon("left", 22)}</button>
        <div class="daylabel"><h1>${esc(dayLabel(state.ymd))}</h1><div class="sub">${sub || "&nbsp;"}</div></div>
        <button class="round" aria-label="Next day" data-action="day" data-v="1" ${!w || idx >= w.days.length - 1 ? "disabled" : ""}>${icon("right", 22)}</button>
      </div>
      ${spotSelect}
    </div>`;

  return `${head}<div class="today-grid">${body}${sideColumn()}</div>`;
}

function sideColumn() {
  if (!state.user) {
    return `<aside class="side"><div class="card tint">
      <h2>Log your fish</h2>
      <p>Make a free account to keep a catch log with photos and map pins, and see what your mates are catching.</p>
      <a class="btn primary" href="#/auth">Sign in or create account</a></div></aside>`;
  }
  ensureCatches();
  const recent = (state.catches || []).slice(0, 3);
  return `<aside class="side"><div class="card">
    <div class="rowbetween"><h2>Recent catches</h2><a class="link" href="#/log">See all</a></div>
    ${recent.length ? recent.map(catchRowCompact).join("") : `<p class="muted">Nothing logged yet. Your first fish goes here.</p>`}
    <a class="btn primary block" href="#/add">${icon("plus", 18)}Add a catch</a>
  </div></aside>`;
}


function weekSection(w, spot) {
  const todayYmd = nzYMD(Date.now());
  const days = w.days.map((ymd) => buildDay(w, ymd, spot)).filter(Boolean);
  if (!days.length) return "";
  const dow = (ymd) => new Date(ymd + "T12:00:00Z").getUTCDay();
  const isWeekend = (ymd) => dow(ymd) === 0 || dow(ymd) === 6;
  // Best days: highest score, then lowest rain chance, then soonest. Today only counts while there is still daylight left.
  const eligible = days.filter((d) => !(d.isToday && Date.now() > d.sunset));
  const ranked = [...eligible].sort((a, b) => b.score - a.score || a.maxRain - b.maxRain || (a.ymd < b.ymd ? -1 : 1));
  const picks = ranked.slice(0, 2).filter((d) => d.score >= 3);
  const pickIds = new Set(picks.map((d) => d.ymd));
  const short = (ymd) => dayLabel(ymd);

  const callout = picks.length
    ? `<div class="picks"><div class="label">Best days to go</div>${picks.map((d) => `
        <button class="pick" data-action="day-set" data-v="${d.ymd}">
          <span class="pk-day"><b>${esc(short(d.ymd))}</b>${isWeekend(d.ymd) ? '<i class="tag">Weekend</i>' : ""}</span>
          <span class="pk-body">${esc(d.headline)}${d.best ? ` · <span class="num">${fmtTime(d.best.from)}–${fmtTime(d.best.to)}</span>` : ""}</span>
          <span class="pk-score num">${d.score}/5</span>
        </button>`).join("")}</div>`
    : `<div class="picks"><div class="label">Best days to go</div><p class="muted">Nothing above "fair" this week. Check back as the forecast firms up.</p></div>`;

  const rows = days.map((d) => {
    const wx = d.bestWx;
    const bits = [
      d.best ? `<span class="num">${fmtTime(d.best.from)}–${fmtTime(d.best.to)}</span>` : "",
      wx ? `<span class="num">${round(wx.tempC)}°</span>` : "",
      wx ? `<span class="num">${esc(wx.windDir)} ${round(wx.windKmh)} km/h</span>` : "",
      `<span class="num">${round(d.maxRain)}% rain</span>`,
    ].filter(Boolean).join(" · ");
    const [wd, ...rest] = short(d.ymd).split(" ");
    return `
    <button class="weekrow ${d.ymd === state.ymd ? "sel" : ""} ${pickIds.has(d.ymd) ? "pickd" : ""}" data-action="day-set" data-v="${d.ymd}" aria-label="${esc(short(d.ymd))}, ${esc(d.headline)}">
      <span class="wd"><b>${esc(wd)}</b><span>${esc(rest.join(" "))}</span></span>
      <span class="wmid">
        <span class="whead"><span class="wlabel">${esc(d.headline)}</span>${d.ymd === todayYmd ? '<i class="tag">Today</i>' : ""}${isWeekend(d.ymd) && d.ymd !== todayYmd ? '<i class="tag">Weekend</i>' : ""}</span>
        <span class="wmeter" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= d.score ? "on" : ""}"></i>`).join("")}</span>
        <span class="wbits muted">${bits}</span>
      </span>
      <span class="wscore num">${d.score}</span>
    </button>`;
  }).join("");

  return `
    <section class="card c-week">
      <div class="rowbetween wrap"><h2>Week ahead</h2><span class="muted small">${esc(spot.name)} · tap a day for the detail</span></div>
      ${callout}
      <div class="weeklist">${rows}</div>
      <p class="fine dark-text">Forecasts firm up closer to the day, so recheck before you leave. Rule of thumb only.</p>
    </section>`;
}

function todayBody(w, spot) {
  const day = buildDay(w, state.ymd, spot);
  if (!day) return `<div class="card">No forecast for that day yet.</div>`;
  const dayStart = nzMidnight(state.ymd);
  const pct = (t) => Math.max(0, Math.min(100, ((t - dayStart) / 864e5) * 100));
  const rise = pct(day.sunrise);
  const set = pct(day.sunset);

  const bars = day.windows
    .map((x) => {
      const l = pct(x.from);
      const r = pct(x.to);
      return `<div class="win ${x.kind}" style="left:${l}%;width:${Math.max(r - l, 1.5)}%"></div>`;
    })
    .join("");

  const rows = day.windows
    .map((x) => `
      <div class="timerow">
        <span class="swatch ${x.kind}"></span>
        <span class="tname">${x.kind === "major" ? "Major" : "Minor"}<small>${esc(x.label)}</small></span>
        <span class="num">${fmtTime(x.from)} – ${fmtTime(x.to)}</span>
      </div>`)
    .join("");

  const ref = day.ref;
  const refLabel = day.isToday ? "Now" : `At ${fmtTime(day.refMs)}`;
  const gateCard = `
    <div class="card gates c-gates">
      <div class="label">Canal gates &amp; flow</div>
      <p class="gates-copy">Canal flows follow power-station demand and change through the day. Meridian doesn't publish canal gate data in a form this app can read, so check their page before you head out.</p>
      <a class="btn primary" href="${GATES_URL}" target="_blank" rel="noopener">Check Meridian lake levels &amp; flows ${icon("external", 16)}</a>
    </div>`;

  return `
    <section class="card dark outlook c-outlook">
      <div class="outlook-top">
        <div class="label light">Fishing outlook</div>
        <div class="score" aria-label="${day.score} out of 5">${day.score}<span>/5</span></div>
      </div>
      <h2 class="headline">${esc(day.headline)}</h2>
      <div class="meter" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= day.score ? "on" : ""}"></i>`).join("")}</div>
      <p class="summary">${esc(day.summary)}</p>
      ${day.best ? `<div class="bestwin">${icon("clock", 20)}<div>Best window <b class="num">${fmtTime(day.best.from)} – ${fmtTime(day.best.to)}</b></div></div>` : ""}
      <p class="fine">A rule of thumb from weather, light and moon. Fish haven't read it.</p>
    </section>

    ${weekSection(w, spot)}

    ${gateCard}

    <section class="card c-times">
      <div class="rowbetween wrap">
        <div class="label">Major &amp; minor times</div>
        <div class="moonname">${icon("moon", 16)}${esc(day.moonName)}</div>
      </div>
      <div class="timeline" role="img" aria-label="Major and minor fishing periods across the day">
        <div class="night" style="left:0;width:${rise}%"></div>
        <div class="night" style="left:${set}%;right:0"></div>
        ${bars}
      </div>
      <div class="ticks num"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
      <div class="times">${rows || `<p class="muted">No periods fall on this day.</p>`}</div>
      <div class="sunrow">
        <div>${icon("sunrise", 22)}<span>Sunrise <b class="num">${fmtTime(day.sunrise)}</b></span></div>
        <div>${icon("sunset", 22)}<span>Sunset <b class="num">${fmtTime(day.sunset)}</b></span></div>
      </div>
    </section>

    <section class="card c-weather">
      <div class="label">Weather at the canal</div>
      ${ref ? `
      <div class="wx-head">
        <span class="bigtemp">${round(ref.tempC)}°</span>
        <div><div>${esc(describeSky(ref.cloudPct))}</div><div class="muted">${refLabel} · feels ${round(ref.feelsC)}° · high ${round(day.maxC)}° / low ${round(day.minC)}°</div></div>
      </div>
      <div class="tiles">
        <div class="tile"><div class="tl">${icon("wind", 16)}Wind</div><div class="tv num">${round(ref.windKmh)} km/h ${esc(ref.windDir)}</div><div class="muted">Gusts to ${round(ref.gustKmh)}</div></div>
        <div class="tile"><div class="tl">${icon("gauge", 16)}Pressure</div><div class="tv num">${round(ref.pressureHpa)} hPa</div><div class="muted">${esc(ref.trend.label || "–")}</div></div>
        <div class="tile"><div class="tl">${icon("cloud", 16)}Cloud</div><div class="tv num">${round(ref.cloudPct)}%</div><div class="muted">${esc(describeSky(ref.cloudPct))}</div></div>
        <div class="tile"><div class="tl">${icon("drop", 16)}Rain</div><div class="tv num">${round(day.maxRain)}%</div><div class="muted">Chance today</div></div>
      </div>
      <div class="hourly-title">Through the day</div>
      <div class="hourly">${day.hours.map((h) => `<div class="hr num"><span class="muted">${h.t}</span><b>${round(h.tempC)}°</b><span class="muted">${round(h.windKmh)} km/h</span></div>`).join("")}</div>`
      : `<p class="muted">No weather data for that time.</p>`}
      <p class="fine dark-text">Weather by Open-Meteo. Moon times worked out on this device.</p>
    </section>`;
}

/* ------------------------------------------------------------------ Log */

const periodChip = (p) => (p ? `<span class="chip ${p}">${p === "major" ? "Major period" : "Minor period"}</span>` : "");
const condChip = (c) => {
  if (!c || c.tempC == null) return "";
  return `<span class="chip">${round(c.tempC)}° · ${c.windDir ? esc(c.windDir) + " " : ""}${round(c.windKmh)} km/h</span>`;
};
const sizeText = (c) => [c.lengthCm != null ? `${c.lengthCm} cm` : "", c.weightKg != null ? `${c.weightKg} kg` : ""].filter(Boolean).join(" · ");
const lureText = (c) => [c.lureName || LURE_LABEL[c.lureType], c.lureSize, c.lureColour].filter(Boolean).join(" · ");
const photoThumb = (c, cls = "thumb") =>
  c.photoIds && c.photoIds.length
    ? `<img class="${cls}" src="/api/photos/${esc(c.photoIds[0])}" alt="Photo of ${esc(c.species)}" loading="lazy">`
    : `<div class="${cls} ph">${icon("camera", 26)}</div>`;

function catchRowCompact(c) {
  return `<a class="mini" href="#/catch/${esc(c.id)}">${photoThumb(c, "thumb sm")}<div><b>${esc(c.species)}</b> <span class="num">${esc(sizeText(c))}</span><div class="muted">${esc(lureText(c))}</div><div class="muted">${esc(stamp(c.caughtAt))} · ${c.mine ? "Me" : esc(c.userName)}</div></div></a>`;
}

function filteredCatches() {
  let list = state.catches || [];
  if (state.filter === "mine") list = list.filter((c) => c.mine);
  else if (state.filter.startsWith("u:")) list = list.filter((c) => c.userName === state.filter.slice(2));
  if (state.species !== "all") list = list.filter((c) => c.species === state.species);
  return list;
}

function viewLog() {
  ensureCatches();
  const all = state.catches;
  if (!all) return `<h1 class="page">Catch log</h1><div class="card muted-card">Loading your catches…</div>`;
  const mates = [...new Set(all.filter((c) => !c.mine).map((c) => c.userName))];
  const speciesSeen = [...new Set(all.map((c) => c.species))];
  const list = filteredCatches();

  const biggest = all.reduce((m, c) => (c.lengthCm != null && c.lengthCm > m ? c.lengthCm : m), 0);
  const lureCount = {};
  for (const c of all) {
    const n = (c.lureName || "").trim();
    if (n) lureCount[n.toLowerCase()] = [(lureCount[n.toLowerCase()]?.[0] || 0) + 1, n];
  }
  const top = Object.values(lureCount).sort((a, b) => b[0] - a[0])[0];

  const chip = (label, v, cur, action) =>
    `<button class="pill ${cur === v ? "on" : ""}" data-action="${action}" data-v="${esc(v)}">${esc(label)}</button>`;

  return `
    <div class="rowbetween pagehead"><h1 class="page">Catch log</h1><a class="btn primary small desktop-only" href="#/add">${icon("plus", 18)}Add catch</a></div>
    ${state.catchesErr ? `<div class="card warn">${esc(state.catchesErr)}</div>` : ""}
    <div class="stats">
      <div class="stat dark"><b>${all.length}</b><span>Fish logged</span></div>
      <div class="stat"><b>${biggest ? biggest + '<small> cm</small>' : "–"}</b><span>Biggest</span></div>
      <div class="stat"><b class="small">${top ? esc(top[1]) : "–"}</b><span>Top lure</span></div>
    </div>
    <div class="filters">
      ${chip("All", "all", state.filter, "filter")}
      ${chip("Me", "mine", state.filter, "filter")}
      ${mates.map((m) => chip(m, "u:" + m, state.filter, "filter")).join("")}
    </div>
    ${speciesSeen.length > 1 ? `<div class="filters">${chip("Any species", "all", state.species, "species")}${speciesSeen.map((s) => chip(s, s, state.species, "species")).join("")}</div>` : ""}
    <div class="catch-list">
      ${list.length ? list.map(catchCard).join("") : `
        <div class="card empty"><h2>${all.length ? "Nothing matches that filter" : "No catches yet"}</h2>
        <p class="muted">${all.length ? "Try a different filter." : "Log your first fish and it'll show up here, with the weather and moon from that moment."}</p>
        ${all.length ? "" : `<a class="btn primary" href="#/add">${icon("plus", 18)}Add your first catch</a>`}</div>`}
    </div>
    <div class="card tint invite"><div><b>Fishing with a crew?</b><div class="muted">Send your mates the link so they can log fish too.</div></div>
      <button class="btn small" data-action="copy-link">Copy link</button></div>`;
}

function catchCard(c) {
  return `<a class="catch" href="#/catch/${esc(c.id)}">
    ${photoThumb(c, "thumb")}
    <div class="cbody">
      <div class="rowbetween"><span class="species">${esc(c.species)}</span><span class="num size">${esc(sizeText(c))}</span></div>
      <div>${esc(lureText(c))}</div>
      ${c.spot ? `<div class="muted iconline">${icon("pin", 14)}${esc(c.spot)}</div>` : ""}
      <div class="muted num">${esc(stamp(c.caughtAt))} · ${c.outcome === "kept" ? "Kept" : "Released"} · ${c.mine ? "Me" : esc(c.userName)}${c.visibility === "me" ? " · Private" : ""}</div>
      <div class="chips">${periodChip(c.conditions?.period)}${condChip(c.conditions)}</div>
    </div></a>`;
}

/* ------------------------------------------------------------------ Catch detail */

function findCatch(id) { return (state.catches || []).find((c) => c.id === id); }

function viewCatch(id) {
  ensureCatches();
  if (!state.catches) return `<div class="card muted-card">Loading…</div>`;
  const c = findCatch(id);
  if (!c) return `<a class="back" href="#/log">${icon("left", 20)}Log</a><div class="card"><h2>Catch not found</h2><p class="muted">It may have been deleted.</p></div>`;
  const k = c.conditions || {};
  const rows = [
    ["Length", c.lengthCm != null ? c.lengthCm + " cm" : ""], ["Weight", c.weightKg != null ? c.weightKg + " kg" : ""],
    ["Lure", [LURE_LABEL[c.lureType], c.lureName].filter(Boolean).join(" · ")], ["Lure size", c.lureSize], ["Colour", c.lureColour],
    ["Outcome", c.outcome === "kept" ? "Kept" : "Released"], ["Caught by", c.mine ? "Me" : c.userName],
  ].filter((r) => r[1]);
  const cond = [
    k.tempC != null ? `${round(k.tempC)}°${k.feelsC != null ? ` (feels ${round(k.feelsC)}°)` : ""}` : "",
    k.windKmh != null ? `Wind ${k.windDir || ""} ${round(k.windKmh)} km/h` : "",
    k.pressureHpa != null ? `${round(k.pressureHpa)} hPa ${(k.pressureTrend || "").toLowerCase()}` : "",
    k.cloudPct != null ? `Cloud ${round(k.cloudPct)}%` : "",
    k.period ? (k.period === "major" ? "Major period" : "Minor period") : "",
    k.moon || "",
  ].filter(Boolean);
  return `
    <div class="rowbetween pagehead"><a class="back" href="#/log">${icon("left", 20)}Log</a>
      ${c.mine ? `<div class="actions"><a class="btn small" href="#/edit/${esc(c.id)}">${icon("edit", 16)}Edit</a><button class="btn small danger" data-action="delete-catch" data-id="${esc(c.id)}">${icon("trash", 16)}Delete</button></div>` : ""}</div>
    ${c.photoIds?.length ? `<div class="gallery">${c.photoIds.map((p) => `<img src="/api/photos/${esc(p)}" alt="Photo of ${esc(c.species)}" loading="lazy">`).join("")}</div>` : ""}
    <div class="detail-grid">
      <div class="card">
        <h1 class="page tight">${esc(c.species)}</h1>
        <div class="muted num">${esc(stamp(c.caughtAt))}${c.spot ? " · " + esc(c.spot) : ""}${c.visibility === "me" ? " · Private" : ""}</div>
        <dl class="facts">${rows.map((r) => `<div><dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd></div>`).join("")}</dl>
        ${c.notes ? `<p class="notes">${esc(c.notes)}</p>` : ""}
      </div>
      <div class="card">
        <div class="label">Conditions at the time</div>
        <div class="chips big">${cond.length ? cond.map((x) => `<span class="chip">${esc(x)}</span>`).join("") : `<span class="muted">Not recorded</span>`}</div>
        ${c.lat != null ? `<div class="label spaced">Where</div><div id="catchMapSlot" class="mapslot"></div><div class="muted num">${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}</div>` : ""}
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ Add / edit form */

const whenNow = () => {
  const p = nzParts(Date.now());
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
};
const whenToMs = (v) => {
  const [d, t] = v.split("T");
  const [h, m] = (t || "00:00").split(":").map(Number);
  return nzMidnight(d) + h * 3600e3 + m * 60e3;
};
const msToWhen = (ms) => {
  const p = nzParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
};

function newDraft() {
  return {
    id: null, species: "Brown trout", speciesOther: "", lengthCm: "", weightKg: "", lureType: "spinner", lureName: "", lureSize: "",
    lureColour: "", outcome: "released", canal: state.spotId, spot: "", lat: null, lng: null, when: whenNow(), notes: "",
    visibility: "crew", photos: [], conditions: {}, freshMap: true,
  };
}
function draftFrom(c) {
  const known = SPECIES.slice(0, -1).includes(c.species);
  return {
    id: c.id, species: known ? c.species : "Other", speciesOther: known ? "" : c.species,
    lengthCm: c.lengthCm ?? "", weightKg: c.weightKg ?? "", lureType: c.lureType, lureName: c.lureName, lureSize: c.lureSize,
    lureColour: c.lureColour, outcome: c.outcome, canal: c.canal === "other" ? state.spotId : c.canal, spot: c.spot, lat: c.lat, lng: c.lng,
    when: msToWhen(new Date(c.caughtAt).getTime()), notes: c.notes, visibility: c.visibility,
    photos: (c.photoIds || []).map((id) => ({ id, url: `/api/photos/${id}` })), conditions: c.conditions || {}, freshMap: true,
  };
}

function viewForm(r) {
  if (r.name === "edit") {
    ensureCatches();
    if (!state.catches) return `<div class="card muted-card">Loading…</div>`;
    const c = findCatch(r.id);
    if (!c || !c.mine) return `<div class="card"><h2>Can't edit that catch</h2><a class="btn" href="#/log">Back to log</a></div>`;
    if (!state.draft || state.draft.id !== c.id) state.draft = draftFrom(c);
  } else if (!state.draft || state.draft.id) {
    state.draft = newDraft();
    refreshConditions();
  }
  const d = state.draft;
  const pill = (k, v, label) => `<button type="button" class="pill ${d[k] === v ? "on" : ""}" data-action="pick" data-k="${k}" data-v="${esc(v)}">${esc(label)}</button>`;
  const inp = (id, label, k, extra = "") =>
    `<div class="field"><label for="${id}">${label}</label><input id="${id}" data-field="${k}" value="${esc(d[k])}" ${extra}></div>`;

  return `
    <div class="rowbetween pagehead"><a class="back" href="${d.id ? "#/catch/" + esc(d.id) : "#/log"}">${icon("left", 20)}Back</a></div>
    <h1 class="page">${d.id ? "Edit catch" : "New catch"}</h1>
    <form class="form" data-form="catch" novalidate>
      <div class="form-col">
        <section class="block">
          <div class="flabel">Photos</div>
          <div class="photos">
            ${d.photos.map((p, i) => `<div class="pthumb"><img src="${esc(p.url)}" alt="Catch photo ${i + 1}"><button type="button" aria-label="Remove photo ${i + 1}" data-action="photo-del" data-i="${i}">${icon("x", 14)}</button></div>`).join("")}
            ${d.photos.length < 6 ? `<button type="button" class="padd" data-action="photo-add">${icon("camera", 26)}Add photo</button>` : ""}
          </div>
          <input id="photoInput" type="file" accept="image/*" multiple hidden>
          <div class="muted small">Up to 6. They're shrunk on your phone before upload.</div>
        </section>

        <section class="block">
          <div class="flabel">Species</div>
          <div class="pills">${SPECIES.map((s) => pill("species", s, s)).join("")}</div>
          ${d.species === "Other" ? inp("sp-other", "Which species?", "speciesOther", 'maxlength="40"') : ""}
        </section>

        <section class="block two">
          ${inp("len", "Length (cm)", "lengthCm", 'inputmode="decimal"')}
          ${inp("wt", 'Weight (kg) <span class="opt">optional</span>', "weightKg", 'inputmode="decimal"')}
        </section>

        <section class="block boxed">
          <div class="flabel">Lure</div>
          <div class="pills">${LURE_TYPES.map(([v, l]) => pill("lureType", v, l)).join("")}</div>
          ${inp("lname", "Name / brand", "lureName", 'maxlength="60" placeholder="e.g. Black Toby"')}
          <div class="two">
            ${inp("lsize", "Size", "lureSize", 'maxlength="30" placeholder="e.g. 18 g"')}
            ${inp("lcol", "Colour", "lureColour", 'maxlength="40" placeholder="e.g. silver / black"')}
          </div>
        </section>

        <section class="block">
          <div class="flabel">What happened to it?</div>
          <div class="seg">
            <button type="button" class="${d.outcome === "released" ? "on" : ""}" data-action="pick" data-k="outcome" data-v="released">Released</button>
            <button type="button" class="${d.outcome === "kept" ? "on" : ""}" data-action="pick" data-k="outcome" data-v="kept">Kept</button>
          </div>
        </section>
      </div>

      <div class="form-col">
        <section class="block">
          <div class="flabel">When &amp; where</div>
          <div class="field"><label for="when">Date and time (NZ)</label><input id="when" type="datetime-local" data-field="when" value="${esc(d.when)}"></div>
          <div class="field"><label for="canal">Spot</label>
            <select id="canal" data-field="canal">${SPOTS.map((s) => `<option value="${s.id}" ${d.canal === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}<option value="other" ${d.canal === "other" ? "selected" : ""}>Somewhere else</option></select></div>
          <div id="formMapSlot" class="mapslot tall"></div>
          <div class="maprow">
            <button type="button" class="btn small tealish" data-action="locate">${icon("locate", 18)}Use my location</button>
            <div class="muted small num" id="coords">${d.lat != null ? d.lat.toFixed(5) + ", " + d.lng.toFixed(5) : "Tap the map to drop a pin"}</div>
          </div>
          ${inp("spotname", 'Spot name <span class="opt">optional</span>', "spot", 'maxlength="80" placeholder="e.g. Below the control gates"')}
        </section>

        <section class="block cond">
          <div class="rowbetween"><b>Conditions, added for you</b></div>
          <div id="condBox" class="chips big">${condBoxHtml(d.conditions)}</div>
          <div class="muted small">Saved with the fish so you can spot patterns later.</div>
        </section>

        <section class="block">
          <div class="field"><label for="notes">Notes <span class="opt">optional</span></label><textarea id="notes" data-field="notes" rows="3" maxlength="1000">${esc(d.notes)}</textarea></div>
        </section>

        <section class="block">
          <label class="check"><input type="checkbox" data-field="private" ${d.visibility === "me" ? "checked" : ""}> ${icon("lock", 16)}<span>Keep this one to myself<small>Other people won't see this catch or its pin.</small></span></label>
        </section>
        <div id="formErr" class="formerr" role="alert"></div>
      </div>

      <div class="savebar">
        <a class="btn" href="${d.id ? "#/catch/" + esc(d.id) : "#/log"}">Cancel</a>
        <button type="submit" class="btn primary grow" ${state.saving ? "disabled" : ""}>${icon("check", 20)}${state.saving ? "Saving…" : "Save catch"}</button>
      </div>
    </form>`;
}

function condBoxHtml(c) {
  if (!c || (c.tempC == null && !c.moon && !c.period)) return `<span class="muted">Not available for that time.</span>`;
  const bits = [
    c.tempC != null ? `${round(c.tempC)}°${c.feelsC != null ? ` · feels ${round(c.feelsC)}°` : ""}` : "",
    c.windKmh != null ? `${c.windDir || ""} ${round(c.windKmh)} km/h` : "",
    c.pressureHpa != null ? `${round(c.pressureHpa)} hPa ${(c.pressureTrend || "").toLowerCase()}` : "",
    c.period ? (c.period === "major" ? "Major period" : "Minor period") : "",
    c.moon || "",
  ].filter(Boolean);
  return bits.map((b) => `<span class="chip">${esc(b.trim())}</span>`).join("");
}

async function refreshConditions() {
  const d = state.draft;
  if (!d) return;
  try {
    const spot = spotById(d.canal === "other" ? state.spotId : d.canal);
    const w = await loadWeather(spot);
    if (state.draft !== d) return;
    d.conditions = snapshotFor(w, whenToMs(d.when), spot);
  } catch {
    d.conditions = {};
  }
  const box = $("#condBox");
  if (box && state.draft === d) box.innerHTML = condBoxHtml(d.conditions);
}

/* ---- maps (Leaflet from CDN, loaded only when needed) ---- */

let leafletP;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (!leafletP) {
    leafletP = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.append(css);
      const s = document.createElement("script");
      s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      s.onload = resolve;
      s.onerror = () => { leafletP = null; reject(new Error("Map didn't load")); };
      document.head.append(s);
    });
  }
  return leafletP;
}
const pinIcon = (cls = "") => L.divIcon({ className: "pinwrap", html: `<span class="pin ${cls}"></span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
function addTiles(map) {
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
}
function mapFallback(slot, msg) {
  if (slot) slot.innerHTML = `<div class="mapfail">${esc(msg)}</div>`;
}

const formMap = { node: null, map: null, marker: null };
async function mountFormMap() {
  const slot = $("#formMapSlot");
  if (!slot) return;
  try { await loadLeaflet(); } catch (e) { return mapFallback(slot, "The map needs a connection. You can still save without a pin."); }
  const d = state.draft;
  if (!d || !$("#formMapSlot")) return;
  if (!formMap.node) {
    formMap.node = document.createElement("div");
    formMap.node.className = "mapbox";
    formMap.map = L.map(formMap.node, { zoomControl: true });
    addTiles(formMap.map);
    formMap.map.on("click", (e) => setPin(e.latlng.lat, e.latlng.lng));
  }
  $("#formMapSlot").replaceChildren(formMap.node);
  formMap.map.invalidateSize();
  if (d.freshMap) {
    d.freshMap = false;
    if (formMap.marker) { formMap.map.removeLayer(formMap.marker); formMap.marker = null; }
    if (d.lat != null) { placeMarker(d.lat, d.lng); formMap.map.setView([d.lat, d.lng], 16); }
    else { const s = spotById(d.canal === "other" ? state.spotId : d.canal); formMap.map.setView([s.lat, s.lng], 14); }
  }
}
function placeMarker(lat, lng) {
  if (!formMap.marker) {
    formMap.marker = L.marker([lat, lng], { draggable: true, icon: pinIcon("sel") }).addTo(formMap.map);
    formMap.marker.on("dragend", () => { const p = formMap.marker.getLatLng(); setPin(p.lat, p.lng, true); });
  } else formMap.marker.setLatLng([lat, lng]);
}
function setPin(lat, lng, fromDrag = false) {
  const d = state.draft;
  if (!d) return;
  d.lat = Math.round(lat * 1e6) / 1e6;
  d.lng = Math.round(lng * 1e6) / 1e6;
  if (!fromDrag) placeMarker(d.lat, d.lng);
  const c = $("#coords");
  if (c) c.textContent = `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}`;
}
function locateMe() {
  if (!navigator.geolocation) return toast("This device can't share its location.");
  toast("Finding you…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setPin(pos.coords.latitude, pos.coords.longitude);
      if (formMap.map) formMap.map.setView([pos.coords.latitude, pos.coords.longitude], 17);
    },
    () => toast("Couldn't get your location. Tap the map to drop a pin instead."),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
  );
}

async function mountCatchMap() {
  const slot = $("#catchMapSlot");
  const c = findCatch(route().id);
  if (!slot || !c || c.lat == null) return;
  try { await loadLeaflet(); } catch { return mapFallback(slot, "Map unavailable offline."); }
  const node = document.createElement("div");
  node.className = "mapbox";
  slot.replaceChildren(node);
  const m = L.map(node, { zoomControl: true }).setView([c.lat, c.lng], 16);
  addTiles(m);
  L.marker([c.lat, c.lng], { icon: pinIcon("sel") }).addTo(m);
}

const bigMap = { node: null, map: null, layer: null };
function viewMap() {
  ensureCatches();
  const all = state.catches || [];
  const species = [...new Set(all.map((c) => c.species))];
  const pinned = all.filter((c) => c.lat != null);
  return `
    <div class="rowbetween pagehead"><h1 class="page">Catch map</h1><div class="muted num">${pinned.length} pinned</div></div>
    ${species.length > 1 ? `<div class="filters">${["all", ...species].map((s) => `<button class="pill ${state.species === s ? "on" : ""}" data-action="species" data-v="${esc(s)}">${s === "all" ? "All fish" : esc(s)}</button>`).join("")}</div>` : ""}
    <div id="bigMapSlot" class="mapslot huge"></div>
    ${state.catches && !pinned.length ? `<div class="card tint"><b>No pins yet.</b> <span class="muted">Drop a pin when you log a catch and it will show up here.</span></div>` : ""}`;
}
async function mountBigMap() {
  const slot = $("#bigMapSlot");
  if (!slot) return;
  try { await loadLeaflet(); } catch { return mapFallback(slot, "The map needs a connection."); }
  if (!$("#bigMapSlot")) return;
  if (!bigMap.node) {
    bigMap.node = document.createElement("div");
    bigMap.node.className = "mapbox";
    bigMap.map = L.map(bigMap.node);
    addTiles(bigMap.map);
    bigMap.layer = L.layerGroup().addTo(bigMap.map);
    const s = spotById(state.spotId);
    bigMap.map.setView([s.lat, s.lng], 13);
  }
  $("#bigMapSlot").replaceChildren(bigMap.node);
  bigMap.map.invalidateSize();
  bigMap.layer.clearLayers();
  const pts = filteredCatches().filter((c) => c.lat != null);
  for (const c of pts) {
    L.marker([c.lat, c.lng], { icon: pinIcon(c.mine ? "mine" : "") })
      .bindPopup(`<div class="pop"><b>${esc(c.species)}</b> ${esc(sizeText(c))}<br>${esc(lureText(c))}<br><span>${esc(stamp(c.caughtAt))} · ${c.mine ? "Me" : esc(c.userName)}</span><br><a href="#/catch/${esc(c.id)}">Open catch</a></div>`)
      .addTo(bigMap.layer);
  }
  if (pts.length) bigMap.map.fitBounds(L.latLngBounds(pts.map((c) => [c.lat, c.lng])).pad(0.3), { maxZoom: 16 });
}

/* ------------------------------------------------------------------ Account / auth */

function viewAccount() {
  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  return `
    <h1 class="page">Account</h1>
    <div class="account-grid">
      <div class="card"><div class="label">Signed in as</div><h2 class="tight">${esc(state.user.name)}</h2>
        <button class="btn" data-action="logout">Sign out</button></div>
      <div class="card tint"><h2>Bring your mates</h2><p>Anyone with this link can make an account and start logging.</p>
        <div class="linkbox num">${esc(location.origin)}</div>
        <button class="btn primary" data-action="copy-link">Copy link</button></div>
      ${standalone ? "" : `<div class="card"><h2>Put it on your phone</h2>
        ${state.installEvt ? `<p>Install Tailrace so it opens like a normal app.</p><button class="btn primary" data-action="install">Install app</button>`
          : isiOS ? `<p>In Safari, tap the Share button, then <b>Add to Home Screen</b>.</p>`
          : `<p>In your browser menu, choose <b>Install app</b> or <b>Add to Home screen</b>.</p>`}</div>`}
    </div>`;
}

function viewAuth() {
  const up = state.authMode === "up";
  return `
    <div class="auth">
      <div class="card">
        <div class="authbrand">${brandMark(36)}<h1>Tailrace</h1></div>
        <p class="muted">Canal conditions, major and minor times, and a shared catch log.</p>
        <div class="seg">
          <button type="button" class="${!up ? "on" : ""}" data-action="auth-mode" data-v="in">Sign in</button>
          <button type="button" class="${up ? "on" : ""}" data-action="auth-mode" data-v="up">Create account</button>
        </div>
        <form data-form="auth" novalidate>
          ${up ? `<div class="field"><label for="a-name">Your name</label><input id="a-name" name="name" autocomplete="name" maxlength="40" required></div>` : ""}
          <div class="field"><label for="a-email">Email</label><input id="a-email" name="email" type="email" autocomplete="email" required></div>
          <div class="field"><label for="a-pass">Password${up ? ' <span class="opt">8+ characters</span>' : ""}</label><input id="a-pass" name="password" type="password" autocomplete="${up ? "new-password" : "current-password"}" required></div>
          ${up && state.inviteRequired ? `<div class="field"><label for="a-code">Invite code</label><input id="a-code" name="code" autocomplete="off"></div>` : ""}
          <div class="formerr" role="alert">${esc(state.authErr)}</div>
          <button class="btn primary block" type="submit" ${state.authBusy ? "disabled" : ""}>${state.authBusy ? "One sec…" : up ? "Create account" : "Sign in"}</button>
        </form>
        <p class="muted small center"><a class="link" href="#/today">Just looking at conditions? Skip for now</a></p>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ events */

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  const v = el.dataset.v;

  if (a === "day") {
    const w = state.weather;
    const i = w.days.indexOf(state.ymd) + Number(v);
    if (i >= 0 && i < w.days.length) { state.ymd = w.days[i]; render(); }
  } else if (a === "day-set") { state.ymd = v; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  else if (a === "refresh") ensureWeather(true);
  else if (a === "filter") { state.filter = v; render(); }
  else if (a === "species") { state.species = v; render(); }
  else if (a === "pick") {
    state.draft[el.dataset.k] = el.dataset.v;
    if (el.dataset.k === "species" || el.dataset.k === "lureType" || el.dataset.k === "outcome") render();
  } else if (a === "photo-add") $("#photoInput")?.click();
  else if (a === "photo-del") { state.draft.photos.splice(Number(el.dataset.i), 1); render(); }
  else if (a === "locate") locateMe();
  else if (a === "copy-link") {
    try { await navigator.clipboard.writeText(location.origin); toast("Link copied"); } catch { toast(location.origin); }
  } else if (a === "install" && state.installEvt) {
    state.installEvt.prompt();
    await state.installEvt.userChoice;
    state.installEvt = null;
    render();
  } else if (a === "auth-mode") { state.authMode = v; state.authErr = ""; render(); }
  else if (a === "logout") {
    try { await api("/logout", { method: "POST" }); } catch { /* ignore */ }
    state.user = null; state.catches = null; state.draft = null;
    go("#/today"); render();
  } else if (a === "delete-catch") {
    if (!confirm("Delete this catch? This can't be undone.")) return;
    try {
      await api("/catches/" + el.dataset.id, { method: "DELETE" });
      state.catches = null;
      toast("Catch deleted");
      go("#/log");
    } catch (err) { toast(err.message); }
  }
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset.change === "spot") {
    state.spotId = t.value;
    store.set("tr_spot", t.value);
    state.weather = null;
    ensureWeather();
    return;
  }
  if (t.id === "photoInput") { addPhotos([...t.files]); t.value = ""; return; }
  const f = t.dataset.field;
  if (!f || !state.draft) return;
  if (f === "private") state.draft.visibility = t.checked ? "me" : "crew";
  else state.draft[f] = t.value;
  if (f === "when" || f === "canal") {
    if (f === "canal" && state.draft.lat == null && formMap.map && t.value !== "other") {
      const s = spotById(t.value);
      formMap.map.setView([s.lat, s.lng], 14);
    }
    refreshConditions();
  }
});
document.addEventListener("input", (e) => {
  const f = e.target.dataset?.field;
  if (f && state.draft && e.target.type !== "checkbox" && e.target.tagName !== "SELECT" && e.target.type !== "datetime-local") state.draft[f] = e.target.value;
});

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === "auth") return submitAuth(form);
  if (form.dataset.form === "catch") return submitCatch();
});

async function submitAuth(form) {
  const fd = Object.fromEntries(new FormData(form));
  state.authBusy = true; state.authErr = ""; render();
  try {
    const up = state.authMode === "up";
    const res = await api(up ? "/signup" : "/login", { method: "POST", json: fd });
    state.user = res.user;
    state.catches = null;
    state.authBusy = false;
    const back = sessionStorage.getItem("tr_next");
    sessionStorage.removeItem("tr_next");
    go(back || "#/today");
    render();
  } catch (err) {
    state.authBusy = false;
    state.authErr = err.message;
    render();
    for (const [id, k] of [["#a-name", "name"], ["#a-email", "email"], ["#a-code", "code"]]) {
      const el = $(id);
      if (el && fd[k]) el.value = fd[k];
    }
  }
}

async function addPhotos(files) {
  const d = state.draft;
  if (!d) return;
  for (const file of files.slice(0, 6 - d.photos.length)) {
    try {
      const blob = await shrink(file);
      d.photos.push({ blob, url: URL.createObjectURL(blob) });
    } catch { toast("Couldn't read one of those photos."); }
  }
  render();
}
async function shrink(file, max = 1600) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.82));
}

async function submitCatch() {
  const d = state.draft;
  const err = $("#formErr");
  const fail = (m) => { if (err) err.textContent = m; };
  const species = d.species === "Other" ? d.speciesOther.trim() || "Other" : d.species;
  const len = d.lengthCm === "" ? null : Number(d.lengthCm);
  const wt = d.weightKg === "" ? null : Number(d.weightKg);
  if (len !== null && (!Number.isFinite(len) || len < 0)) return fail("Length should be a number in cm.");
  if (wt !== null && (!Number.isFinite(wt) || wt < 0)) return fail("Weight should be a number in kg.");
  if (!d.when) return fail("Add when you caught it.");
  state.saving = true; render();
  try {
    const photoIds = [];
    for (const p of d.photos) {
      if (p.id) photoIds.push(p.id);
      else photoIds.push((await api("/photos", { method: "POST", body: p.blob, headers: { "content-type": "image/jpeg" } })).id);
    }
    const payload = {
      species, lengthCm: len, weightKg: wt, lureType: d.lureType, lureName: d.lureName, lureSize: d.lureSize, lureColour: d.lureColour,
      outcome: d.outcome, canal: d.canal, spot: d.spot, lat: d.lat, lng: d.lng, caughtAt: new Date(whenToMs(d.when)).toISOString(),
      notes: d.notes, visibility: d.visibility, conditions: d.conditions, photoIds,
    };
    if (d.id) await api("/catches/" + d.id, { method: "PUT", json: payload });
    else await api("/catches", { method: "POST", json: payload });
    d.photos.forEach((p) => p.blob && URL.revokeObjectURL(p.url));
    state.draft = null; state.catches = null; state.saving = false;
    toast(d.id ? "Catch updated" : "Catch saved");
    go("#/log");
  } catch (e) {
    state.saving = false;
    if (e.status === 401) { state.user = null; sessionStorage.setItem("tr_next", "#/add"); render(); return; }
    render();
    fail(e.message);
  }
}

/* ------------------------------------------------------------------ boot */

window.addEventListener("hashchange", () => {
  const r = route();
  if (r.name !== "add" && r.name !== "edit" && state.draft && !state.saving) state.draft = state.draft; // keep draft while browsing
  if (PROTECTED.includes(r.name) && !state.user) sessionStorage.setItem("tr_next", location.hash);
  render();
  if (r.name === "today") ensureWeather();
});
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); state.installEvt = e; });

async function boot() {
  $("#app").innerHTML = `<div class="boot">${brandMark(44)}</div>`;
  try {
    const me = await api("/me");
    state.user = me.user;
    state.inviteRequired = me.inviteRequired;
  } catch { /* offline or API down: show public screens */ }
  state.ready = true;
  if (!location.hash) history.replaceState(null, "", "#/today");
  if (PROTECTED.includes(route().name) && !state.user) sessionStorage.setItem("tr_next", location.hash);
  render();
  if (route().name === "today") ensureWeather();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}
boot();
