import assert from "node:assert/strict";
import { moonPhase, phaseName, solunarForDay, nzMidnight, nzYMD, fmtTime, addDays, moonAltitude } from "../public/js/astro.js";

export async function run() {
  // Known moon phases (UTC): full moon 2025-10-07 03:47, new moon 2025-10-21 12:25, full 2026-01-03 10:03
  const near = (ms, target, tol) => Math.abs(((ms - target + 0.5) % 1) - 0.5) < tol;
  const full = moonPhase(Date.UTC(2025, 9, 7, 3, 47)).phase;
  assert.ok(Math.abs(full - 0.5) < 0.02, "full moon 7 Oct 2025, got " + full);
  const nu = moonPhase(Date.UTC(2025, 9, 21, 12, 25)).phase;
  assert.ok(near(nu, 0, 0.02), "new moon 21 Oct 2025, got " + nu);
  const full2 = moonPhase(Date.UTC(2026, 0, 3, 10, 3)).phase;
  assert.ok(Math.abs(full2 - 0.5) < 0.02, "full moon 3 Jan 2026, got " + full2);
  assert.equal(phaseName(0.5), "Full moon");
  assert.equal(phaseName(0.6), "Waning gibbous");

  // NZ day helpers across the daylight-saving change (NZ DST starts 27 Sep 2026)
  assert.equal(nzYMD(nzMidnight("2026-10-03")), "2026-10-03");
  assert.equal(fmtTime(nzMidnight("2026-10-03")), "00:00");
  assert.equal(fmtTime(nzMidnight("2026-06-10")), "00:00");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(nzMidnight("2026-10-04") - nzMidnight("2026-10-03"), 24 * 3600e3);

  // Solunar for Twizel area: overhead and underfoot are ~12h25m apart, minors sit between
  const lat = -44.2, lng = 170.1;
  const w = solunarForDay("2026-10-03", lat, lng);
  const majors = w.filter((x) => x.kind === "major");
  const minors = w.filter((x) => x.kind === "minor");
  assert.ok(majors.length >= 1 && majors.length <= 3, "majors: " + majors.length);
  assert.ok(minors.length >= 1 && minors.length <= 3, "minors: " + minors.length);
  for (const m of majors) assert.equal(m.to - m.from, 2 * 3600e3);
  for (const m of minors) assert.equal(m.to - m.from, 3600e3);
  // at an "overhead" event the moon must be high; at "underfoot" low
  for (const m of majors) {
    const alt = moonAltitude(m.t, lat, lng);
    if (m.label === "Moon overhead") assert.ok(alt > 0.3, "overhead alt " + alt);
    else assert.ok(alt < -0.3, "underfoot alt " + alt);
  }
  for (const m of minors) assert.ok(Math.abs(moonAltitude(m.t, lat, lng)) < 0.05);
  console.log("astro: all checks passed");
  console.log("  3 Oct 2026 windows:", w.map((x) => `${x.kind} ${fmtTime(x.from)}-${fmtTime(x.to)}`).join(", "));
  console.log("  moon:", phaseName(moonPhase(nzMidnight("2026-10-03") + 12 * 3600e3).phase));
}
