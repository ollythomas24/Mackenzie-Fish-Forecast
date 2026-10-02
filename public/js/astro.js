// Moon position, phase and solunar (major/minor) windows. No dependencies.
// Formulas follow the standard low-precision astronomical approximations
// (good to a few minutes, plenty for "when is the moon overhead").

const RAD = Math.PI / 180;
const DAY_MS = 864e5;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;
export const NZ_TZ = "Pacific/Auckland";

const toDays = (ms) => ms / DAY_MS - 0.5 + J1970 - J2000;
const rightAscension = (l, b) =>
  Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l, b) =>
  Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
const siderealTime = (d, lw) => RAD * (280.16 + 360.9856235 * d) - lw;

function moonCoords(d) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
}

function sunCoords(d) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  return { ra: rightAscension(L, 0), dec: declination(L, 0) };
}

/** Moon altitude above the horizon, in radians. */
export function moonAltitude(ms, lat, lng) {
  const d = toDays(ms);
  const c = moonCoords(d);
  const H = siderealTime(d, RAD * -lng) - c.ra;
  const phi = RAD * lat;
  return Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H));
}

/** phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
export function moonPhase(ms) {
  const d = toDays(ms);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const sunDist = 149598000;
  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra)
  );
  const inc = Math.atan2(sunDist * Math.sin(phi), m.dist - sunDist * Math.cos(phi));
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra)
  );
  return {
    fraction: (1 + Math.cos(inc)) / 2,
    phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI,
  };
}

export function phaseName(phase) {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.03 || p >= 0.97) return "New moon";
  if (p < 0.22) return "Waxing crescent";
  if (p < 0.28) return "First quarter";
  if (p < 0.47) return "Waxing gibbous";
  if (p < 0.53) return "Full moon";
  if (p < 0.72) return "Waning gibbous";
  if (p < 0.78) return "Last quarter";
  return "Waning crescent";
}

/* ---------- New Zealand time helpers (so a visitor's device time zone doesn't matter) ---------- */

const partsFmt = new Intl.DateTimeFormat("en-NZ", {
  timeZone: NZ_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit",
});
export function nzParts(ms) {
  const o = {};
  for (const p of partsFmt.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o;
}
export const nzYMD = (ms) => {
  const p = nzParts(ms);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};
/** Epoch ms of 00:00 NZ time on a YYYY-MM-DD date. */
export function nzMidnight(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  for (const off of [13, 12, 14, 11]) {
    const cand = base - off * 3600e3;
    const p = nzParts(cand);
    if (p.hour === 0 && p.minute === 0 && nzYMD(cand) === ymd) return cand;
  }
  return base - 12 * 3600e3;
}
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
const timeFmt = new Intl.DateTimeFormat("en-NZ", { timeZone: NZ_TZ, hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
export const fmtTime = (ms) => timeFmt.format(new Date(ms));

/* ---------- Solunar windows ---------- */

const STEP = 5 * 60e3;

/**
 * Major periods (about 2 h) are centred on moon overhead and moon underfoot.
 * Minor periods (about 1 h) are centred on moonrise and moonset.
 * Returns windows touching the given NZ calendar day, sorted by start.
 */
export function solunarForDay(ymd, lat, lng) {
  const start = nzMidnight(ymd) - 3 * 3600e3;
  const end = nzMidnight(addDays(ymd, 1)) + 3 * 3600e3;
  const alts = [];
  for (let t = start; t <= end; t += STEP) alts.push([t, moonAltitude(t, lat, lng)]);

  const events = [];
  for (let i = 1; i < alts.length - 1; i++) {
    const [t, a] = alts[i];
    const prev = alts[i - 1][1];
    const next = alts[i + 1][1];
    if (a > prev && a >= next) events.push({ kind: "major", label: "Moon overhead", t });
    if (a < prev && a <= next) events.push({ kind: "major", label: "Moon underfoot", t });
    if (prev < 0 && a >= 0) events.push({ kind: "minor", label: "Moonrise", t });
    if (prev > 0 && a <= 0) events.push({ kind: "minor", label: "Moonset", t });
  }

  const dayStart = nzMidnight(ymd);
  const dayEnd = nzMidnight(addDays(ymd, 1));
  return events
    .map((e) => {
      const half = (e.kind === "major" ? 60 : 30) * 60e3;
      return { ...e, from: e.t - half, to: e.t + half };
    })
    .filter((w) => w.to > dayStart && w.from < dayEnd)
    .sort((a, b) => a.from - b.from);
}
