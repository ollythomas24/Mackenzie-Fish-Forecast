import assert from "node:assert/strict";
import { createHandler } from "../netlify/lib/handler.mjs";
import { memStore } from "./mem-store.mjs";

const stores = { users: memStore(), sessions: memStore(), catches: memStore(), photos: memStore() };
const handle = createHandler({ stores, env: {} });
const BASE = "https://tailrace.test";

async function call(method, path, { body, cookie, raw, noHeader } = {}) {
  const headers = {};
  if (!noHeader) headers["x-requested-with"] = "tailrace";
  if (cookie) headers.cookie = cookie;
  let payload;
  if (raw) payload = raw;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await handle(new Request(BASE + "/api" + path, { method, headers, body: payload }));
  const setCookie = res.headers.get("set-cookie");
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, cookie: setCookie ? setCookie.split(";")[0] : null, res };
}

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const goodCatch = (extra = {}) => ({
  species: "Brown trout", lengthCm: 54, weightKg: 2.1, lureType: "spinner", lureName: "Black Toby",
  lureSize: "18 g", lureColour: "Silver / black", outcome: "released", canal: "salmon-farm",
  spot: "Below the gates", lat: -44.2, lng: 170.1, caughtAt: "2026-10-03T06:42:00+13:00", notes: "Nice",
  conditions: { tempC: 11, windKmh: 12, windDir: "NW", pressureHpa: 1018, pressureTrend: "Steady", period: "major", evil: "x" },
  ...extra,
});

export async function run() {
  // CSRF-style header required on writes
  assert.equal((await call("POST", "/login", { body: {}, noHeader: true })).status, 403);

  // not signed in
  assert.equal((await call("GET", "/me")).data.user, null);
  assert.equal((await call("GET", "/catches")).status, 401);

  // signup validation
  assert.equal((await call("POST", "/signup", { body: { name: "", email: "a@b.co", password: "longenough" } })).status, 400);
  assert.equal((await call("POST", "/signup", { body: { name: "Olly", email: "nope", password: "longenough" } })).status, 400);
  assert.equal((await call("POST", "/signup", { body: { name: "Olly", email: "o@x.nz", password: "short" } })).status, 400);

  // signup + session
  const s1 = await call("POST", "/signup", { body: { name: "Olly", email: "Olly@Example.nz", password: "correct horse" } });
  assert.equal(s1.status, 201);
  assert.match(s1.res.headers.get("set-cookie"), /HttpOnly/);
  assert.match(s1.res.headers.get("set-cookie"), /Secure/);
  const ollyCookie = s1.cookie;
  assert.equal((await call("GET", "/me", { cookie: ollyCookie })).data.user.name, "Olly");

  // duplicate email (case-insensitive)
  assert.equal((await call("POST", "/signup", { body: { name: "X", email: "olly@example.nz", password: "correct horse" } })).status, 409);

  // login good / bad
  assert.equal((await call("POST", "/login", { body: { email: "olly@example.nz", password: "wrong password" } })).status, 401);
  assert.equal((await call("POST", "/login", { body: { email: "ghost@example.nz", password: "whatever1" } })).status, 401);
  const l = await call("POST", "/login", { body: { email: "OLLY@example.nz", password: "correct horse" } });
  assert.equal(l.status, 200);

  // second user
  const s2 = await call("POST", "/signup", { body: { name: "Mate", email: "mate@example.nz", password: "another pass" } });
  const mateCookie = s2.cookie;

  // photo upload: JPEG only
  assert.equal((await call("POST", "/photos", { cookie: ollyCookie, raw: Buffer.from("not a jpeg") })).status, 400);
  assert.equal((await call("POST", "/photos", { raw: jpeg })).status, 401);
  const up = await call("POST", "/photos", { cookie: ollyCookie, raw: jpeg });
  assert.equal(up.status, 201);
  const photoId = up.data.id;

  // can't attach someone else's photo
  const stolen = await call("POST", "/catches", { cookie: mateCookie, body: goodCatch({ photoIds: [photoId] }) });
  assert.equal(stolen.status, 201);
  assert.deepEqual(stolen.data.catch.photoIds, []);

  // create catch with own photo; conditions whitelist
  const c1 = await call("POST", "/catches", { cookie: ollyCookie, body: goodCatch({ photoIds: [photoId] }) });
  assert.equal(c1.status, 201);
  assert.deepEqual(c1.data.catch.photoIds, [photoId]);
  assert.equal(c1.data.catch.conditions.evil, undefined);
  assert.equal(c1.data.catch.conditions.period, "major");
  const catchId = c1.data.catch.id;

  // validation
  assert.equal((await call("POST", "/catches", { cookie: ollyCookie, body: goodCatch({ species: "" }) })).status, 400);
  assert.equal((await call("POST", "/catches", { cookie: ollyCookie, body: goodCatch({ caughtAt: "yesterday-ish" }) })).status, 400);
  const clamped = await call("POST", "/catches", { cookie: ollyCookie, body: goodCatch({ lengthCm: 9999, lat: 500, lng: 10 }) });
  assert.equal(clamped.data.catch.lengthCm, 200);
  assert.equal(clamped.data.catch.lat, 90);

  // private catch hidden from others
  const priv = await call("POST", "/catches", { cookie: ollyCookie, body: goodCatch({ visibility: "me", spot: "Secret" }) });
  const mateList = (await call("GET", "/catches", { cookie: mateCookie })).data.catches;
  assert.ok(mateList.some((c) => c.id === catchId), "mate sees crew catch");
  assert.ok(!mateList.some((c) => c.id === priv.data.catch.id), "mate must not see private catch");
  assert.equal((await call("GET", "/catches/" + priv.data.catch.id, { cookie: mateCookie })).status, 404);
  const ollyList = (await call("GET", "/catches", { cookie: ollyCookie })).data.catches;
  assert.ok(ollyList.some((c) => c.id === priv.data.catch.id));
  assert.equal(ollyList.find((c) => c.id === catchId).userName, "Olly");
  assert.equal(mateList.find((c) => c.id === catchId).mine, false);

  // mate cannot edit/delete Olly's catch
  assert.equal((await call("PUT", "/catches/" + catchId, { cookie: mateCookie, body: goodCatch() })).status, 403);
  assert.equal((await call("DELETE", "/catches/" + catchId, { cookie: mateCookie })).status, 403);

  // photo served only when signed in
  assert.equal((await call("GET", "/photos/" + photoId)).status, 401);
  const pic = await call("GET", "/photos/" + photoId, { cookie: mateCookie });
  assert.equal(pic.status, 200);
  assert.equal(pic.res.headers.get("content-type"), "image/jpeg");
  assert.equal((await call("GET", "/photos/not-an-id", { cookie: mateCookie })).status, 404);

  // owner edit removes dropped photo
  const edited = await call("PUT", "/catches/" + catchId, { cookie: ollyCookie, body: goodCatch({ species: "Rainbow trout", photoIds: [] }) });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.catch.species, "Rainbow trout");
  assert.equal((await call("GET", "/photos/" + photoId, { cookie: ollyCookie })).status, 404);

  // delete
  assert.equal((await call("DELETE", "/catches/" + catchId, { cookie: ollyCookie })).data.ok, true);
  assert.equal((await call("GET", "/catches/" + catchId, { cookie: ollyCookie })).status, 404);

  // logout kills the session
  const out = await call("POST", "/logout", { cookie: mateCookie });
  assert.equal(out.status, 200);
  assert.equal((await call("GET", "/catches", { cookie: mateCookie })).status, 401);

  // invite code mode
  const gated = createHandler({ stores: { users: memStore(), sessions: memStore(), catches: memStore(), photos: memStore() }, env: { SIGNUP_CODE: "tussock" } });
  const sg = (code) => gated(new Request(BASE + "/api/signup", { method: "POST", headers: { "x-requested-with": "tailrace" }, body: JSON.stringify({ name: "F", email: "f@x.nz", password: "longenough", code }) }));
  assert.equal((await sg("nope")).status, 403);
  assert.equal((await sg("tussock")).status, 201);

  // unknown route
  assert.equal((await call("GET", "/nothing", { cookie: ollyCookie })).status, 404);
  console.log("api: all checks passed");
}
