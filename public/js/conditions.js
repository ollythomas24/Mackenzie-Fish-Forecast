// Weather (Open-Meteo, free, no key) + a simple rule-of-thumb fishing outlook.
import { nzParts, nzYMD, nzMidnight, solunarForDay, moonPhase, phaseName } from "./astro.js";

// Approximate spots. The weather is area-level so a few hundred metres doesn't matter,
// and catch pins are set by hand on the map anyway.
export const SPOTS = [
  { id: "salmon-farm", name: "Salmon farm canal", lat: -44.19, lng: 170.14 },
  { id: "pukaki-dam", name: "Below Pukaki dam", lat: -44.2, lng: 170.16 },
];
export const spotById = (id) => SPOTS.find((s) => s.id === id) || SPOTS[0];

export const GATES_URL = "https://www.meridianenergy.co.nz/power-stations/lake-levels";

const cache = new Map();
const pad = (n) => String(n).padStart(2, "0");
const hourKey = (ms) => {
  const p = nzParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:00`;
};

export async function loadWeather(spot, { force = false } = {}) {
  const hit = cache.get(spot.id);
  if (hit && !force && Date.now() - hit.at < 15 * 60e3) return hit.data;
  const q = new URLSearchParams({
    latitude: spot.lat,
    longitude: spot.lng,
    hourly: "temperature_2m,apparent_temperature,precipitation_probability,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl",
    daily: "sunrise,sunset,temperature_2m_max,temperature_2m_min",
    timezone: "Pacific/Auckland",
    wind_speed_unit: "kmh",
    past_days: "2",
    forecast_days: "7",
  });
  const res = await fetch("https://api.open-meteo.com/v1/forecast?" + q);
  if (!res.ok) throw new Error("Weather service said " + res.status);
  const j = await res.json();
  const hourly = new Map();
  j.hourly.time.forEach((t, i) => {
    hourly.set(t, {
      tempC: j.hourly.temperature_2m[i],
      feelsC: j.hourly.apparent_temperature[i],
      rainPct: j.hourly.precipitation_probability[i],
      cloudPct: j.hourly.cloud_cover[i],
      windKmh: j.hourly.wind_speed_10m[i],
      windDeg: j.hourly.wind_direction_10m[i],
      gustKmh: j.hourly.wind_gusts_10m[i],
      pressureHpa: j.hourly.pressure_msl[i],
    });
  });
  const daily = {};
  j.daily.time.forEach((ymd, i) => {
    const at = (s) => {
      const [h, m] = s.split("T")[1].split(":").map(Number);
      return nzMidnight(ymd) + h * 3600e3 + m * 60e3;
    };
    daily[ymd] = {
      sunrise: at(j.daily.sunrise[i]),
      sunset: at(j.daily.sunset[i]),
      maxC: j.daily.temperature_2m_max[i],
      minC: j.daily.temperature_2m_min[i],
    };
  });
  const data = { hourly, daily, days: j.daily.time.filter((d) => d >= nzYMD(Date.now())) };
  cache.set(spot.id, { at: Date.now(), data });
  return data;
}

const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const dirName = (deg) => (deg == null ? "" : DIRS[Math.round(deg / 45) % 8]);

export function pressureTrend(w, ms) {
  const now = w.hourly.get(hourKey(ms));
  const before = w.hourly.get(hourKey(ms - 6 * 3600e3));
  if (!now || !before || now.pressureHpa == null || before.pressureHpa == null) return { label: "", delta: null };
  const delta = now.pressureHpa - before.pressureHpa;
  let label = "Steady";
  if (delta <= -4) label = "Falling fast";
  else if (delta < -1.5) label = "Falling";
  else if (delta >= 4) label = "Rising fast";
  else if (delta > 1.5) label = "Rising";
  return { label, delta };
}

export function weatherAt(w, ms) {
  const h = w.hourly.get(hourKey(ms));
  if (!h) return null;
  return { ...h, windDir: dirName(h.windDeg), trend: pressureTrend(w, ms) };
}

function describeSky(c) {
  if (c == null) return "";
  if (c < 15) return "Clear";
  if (c < 40) return "Mostly clear";
  if (c < 70) return "Partly cloudy";
  if (c < 90) return "Mostly cloudy";
  return "Overcast";
}
export { describeSky };

/** Everything the Today screen needs for one NZ calendar day. */
export function buildDay(w, ymd, spot, nowMs = Date.now()) {
  const d = w.daily[ymd];
  if (!d) return null;
  const windows = solunarForDay(ymd, spot.lat, spot.lng);
  const noon = nzMidnight(ymd) + 12 * 3600e3;
  const moon = moonPhase(noon);

  const scored = windows.map((x) => {
    const mid = (x.from + x.to) / 2;
    const nearRise = Math.abs(mid - d.sunrise) <= 90 * 60e3;
    const nearSet = Math.abs(mid - d.sunset) <= 90 * 60e3;
    const dark = mid < d.sunrise - 90 * 60e3 || mid > d.sunset + 90 * 60e3;
    const score = (x.kind === "major" ? 2 : 1) + (nearRise || nearSet ? 2 : 0) - (dark ? 1.5 : 0);
    return { ...x, mid, nearRise, nearSet, score };
  });
  const best = [...scored].sort((a, b) => b.score - a.score || a.from - b.from)[0] || null;

  const isToday = ymd === nzYMD(nowMs);
  const refMs = isToday ? nowMs : best ? best.mid : noon;
  const ref = weatherAt(w, refMs);

  // Rule-of-thumb outlook. Honest about being a nudge, not a forecast of fish.
  let pts = 2.5;
  const good = [];
  const bad = [];
  if (ref) {
    if (ref.windKmh <= 15) { pts += 0.5; good.push("light wind"); }
    else if (ref.windKmh > 30) { pts -= 1; bad.push("strong wind"); }
    if (ref.gustKmh > 45) { pts -= 0.5; bad.push("gusty"); }
    if (ref.trend.label === "Steady") { pts += 0.25; good.push("steady pressure"); }
    if (ref.trend.label === "Falling fast") { pts -= 0.5; bad.push("pressure dropping fast"); }
  }
  let maxRain = 0;
  for (let h = 6; h <= 21; h++) {
    const r = w.hourly.get(`${ymd}T${pad(h)}:00`);
    if (r && r.rainPct > maxRain) maxRain = r.rainPct;
  }
  if (maxRain > 70) { pts -= 1; bad.push("rain likely"); }
  else if (maxRain > 40) { pts -= 0.5; bad.push("showers possible"); }
  if (best && best.kind === "major" && (best.nearRise || best.nearSet)) {
    pts += 1;
    good.push(best.nearRise ? "major period at first light" : "major period at last light");
  } else if (best && (best.nearRise || best.nearSet)) {
    pts += 0.5;
    good.push(best.nearRise ? "minor period around sunrise" : "minor period around sunset");
  }
  const p = ((moon.phase % 1) + 1) % 1;
  if (Math.min(p, Math.abs(p - 0.5), 1 - p) < 0.06) { pts += 0.5; good.push("near new/full moon"); }

  const score = Math.max(1, Math.min(5, Math.round(pts)));
  const label = ["", "Tough", "Quiet", "Fair", "Good", "Prime"][score];
  const when = best && (best.nearRise || best.nearSet) ? (best.nearRise ? "dawn bite" : "evening bite") : "day";
  const headline = `${label} ${when}`;
  const parts = [];
  if (good.length) parts.push(cap(good.slice(0, 3).join(", ")));
  if (bad.length) parts.push((good.length ? "but " : "") + bad.slice(0, 2).join(" and "));
  const summary = parts.length ? parts.join(", ") + "." : "Nothing stands out either way.";

  const hours = [6, 9, 12, 15, 18, 21].map((h) => {
    const r = w.hourly.get(`${ymd}T${pad(h)}:00`);
    return { t: `${pad(h)}:00`, tempC: r?.tempC, windKmh: r?.windKmh };
  });

  return {
    ymd, isToday, windows: scored, best, ref, refMs, hours, maxRain,
    bestWx: weatherAt(w, best ? best.mid : noon),
    sunrise: d.sunrise, sunset: d.sunset, maxC: d.maxC, minC: d.minC,
    moonName: phaseName(moon.phase), score, headline, summary,
  };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Conditions to store with a catch, for a given moment. */
export function snapshotFor(w, ms, spot) {
  const r = weatherAt(w, ms);
  const ymd = nzYMD(ms);
  const win = solunarForDay(ymd, spot.lat, spot.lng).find((x) => ms >= x.from && ms <= x.to);
  const moon = phaseName(moonPhase(ms).phase);
  if (!r) return { moon, period: win ? win.kind : "" };
  return {
    tempC: round1(r.tempC), feelsC: round1(r.feelsC), windKmh: Math.round(r.windKmh), gustKmh: Math.round(r.gustKmh),
    windDir: r.windDir, cloudPct: Math.round(r.cloudPct), rainPct: Math.round(r.rainPct ?? 0),
    pressureHpa: Math.round(r.pressureHpa), pressureTrend: r.trend.label, moon, period: win ? win.kind : "",
  };
}
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
