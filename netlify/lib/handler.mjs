// Tailrace API: accounts, sessions, catches, photos.
// Storage is injected (Netlify Blobs in production, an in-memory map in tests).
import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from "node:crypto";

const MAX_JSON = 30_000;
const MAX_PHOTO = 3_500_000;
const MAX_PHOTOS_PER_CATCH = 6;
const SESSION_DAYS = 60;
const LURE_TYPES = ["spinner", "minnow", "soft-bait", "fly", "bait", "other"];
const OUTCOMES = ["released", "kept"];
const CANALS = ["salmon-farm", "pukaki-dam", "other"];
const PHOTO_ID = /^[0-9a-f-]{36}__[0-9a-f-]{36}$/;
const CATCH_ID = /^[0-9a-f-]{36}$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (m) => new HttpError(400, m);

const sha = (s) => createHash("sha256").update(s).digest("hex");
const S = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const N = (v, min, max) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}
function checkPassword(password, salt, hash) {
  const a = Buffer.from(scryptSync(password, salt, 64).toString("hex"));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cleanCatch(b) {
  const caughtAt = new Date(b.caughtAt);
  if (isNaN(caughtAt.getTime())) throw bad("The date and time look wrong.");
  const species = S(b.species, 40);
  if (!species) throw bad("Pick a species.");
  const c = b.conditions && typeof b.conditions === "object" ? b.conditions : {};
  const lat = N(b.lat, -90, 90);
  const lng = N(b.lng, -180, 180);
  return {
    species,
    lengthCm: N(b.lengthCm, 0, 200),
    weightKg: N(b.weightKg, 0, 60),
    lureType: LURE_TYPES.includes(b.lureType) ? b.lureType : "other",
    lureName: S(b.lureName, 60),
    lureSize: S(b.lureSize, 30),
    lureColour: S(b.lureColour, 40),
    outcome: OUTCOMES.includes(b.outcome) ? b.outcome : "released",
    canal: CANALS.includes(b.canal) ? b.canal : "other",
    spot: S(b.spot, 80),
    lat: lat !== null && lng !== null ? lat : null,
    lng: lat !== null && lng !== null ? lng : null,
    caughtAt: caughtAt.toISOString(),
    notes: S(b.notes, 1000),
    visibility: b.visibility === "me" ? "me" : "crew",
    conditions: {
      tempC: N(c.tempC, -50, 60),
      feelsC: N(c.feelsC, -60, 60),
      windKmh: N(c.windKmh, 0, 300),
      gustKmh: N(c.gustKmh, 0, 400),
      windDir: S(c.windDir, 3),
      cloudPct: N(c.cloudPct, 0, 100),
      rainPct: N(c.rainPct, 0, 100),
      pressureHpa: N(c.pressureHpa, 850, 1100),
      pressureTrend: S(c.pressureTrend, 14),
      moon: S(c.moon, 24),
      period: ["major", "minor"].includes(c.period) ? c.period : "",
    },
  };
}

export function createHandler({ stores, env = {} }) {
  const { users, sessions, catches, photos } = stores;

  const json = (data, status = 200, headers = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
    });

  function cookieHeader(token, req, maxAge) {
    const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
    return `tr_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }
  function readCookie(req, name) {
    const raw = req.headers.get("cookie") || "";
    for (const part of raw.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === name) return v.join("=");
    }
    return "";
  }
  async function readJSON(req) {
    const text = await req.text();
    if (text.length > MAX_JSON) throw new HttpError(413, "That request is too big.");
    try {
      return JSON.parse(text || "{}");
    } catch {
      throw bad("Could not read that request.");
    }
  }

  async function currentUser(req) {
    const token = readCookie(req, "tr_session");
    if (!token) return null;
    const key = sha(token);
    const s = await sessions.get(key, { type: "json" });
    if (!s) return null;
    if (s.exp < Date.now()) {
      await sessions.delete(key);
      return null;
    }
    const u = await users.get(`id/${s.userId}`, { type: "json" });
    return u ? { id: u.id, name: u.name } : null;
  }
  async function startSession(user, req) {
    const token = randomBytes(32).toString("hex");
    await sessions.setJSON(sha(token), { userId: user.id, exp: Date.now() + SESSION_DAYS * 864e5 });
    return cookieHeader(token, req, SESSION_DAYS * 86400);
  }
  const requireUser = async (req) => {
    const u = await currentUser(req);
    if (!u) throw new HttpError(401, "Please sign in.");
    return u;
  };

  async function listCatches(me) {
    const { blobs } = await catches.list();
    const all = (await Promise.all(blobs.map((b) => catches.get(b.key, { type: "json" })))).filter(Boolean);
    const visible = all.filter((c) => c.visibility !== "me" || c.userId === me.id);
    const names = new Map();
    for (const id of new Set(visible.map((c) => c.userId))) {
      const u = await users.get(`id/${id}`, { type: "json" });
      names.set(id, u ? u.name : "Unknown");
    }
    return visible
      .map((c) => ({ ...c, userName: names.get(c.userId), mine: c.userId === me.id }))
      .sort((a, b) => (a.caughtAt < b.caughtAt ? 1 : -1));
  }

  function checkPhotoIds(ids, me) {
    if (!Array.isArray(ids)) return [];
    const out = ids.filter((id) => typeof id === "string" && PHOTO_ID.test(id) && id.startsWith(`${me.id}__`));
    return out.slice(0, MAX_PHOTOS_PER_CATCH);
  }

  return async function handle(req) {
    try {
      const url = new URL(req.url);
      const path = url.pathname.replace(/^\/api/, "") || "/";
      const method = req.method;

      if (method !== "GET" && req.headers.get("x-requested-with") !== "tailrace") {
        throw new HttpError(403, "Request blocked.");
      }

      if (path === "/me" && method === "GET") {
        const user = await currentUser(req);
        return json({ user, inviteRequired: !!env.SIGNUP_CODE });
      }

      if (path === "/signup" && method === "POST") {
        const b = await readJSON(req);
        if (env.SIGNUP_CODE && S(b.code, 100) !== env.SIGNUP_CODE) throw new HttpError(403, "That invite code isn't right.");
        const name = S(b.name, 40);
        const email = S(b.email, 120).toLowerCase();
        const password = typeof b.password === "string" ? b.password : "";
        if (!name) throw bad("Add your name.");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad("That email doesn't look right.");
        if (password.length < 8 || password.length > 200) throw bad("Password needs at least 8 characters.");
        const key = `email/${sha(email)}`;
        if (await users.get(key, { type: "json" })) throw new HttpError(409, "That email already has an account. Try signing in.");
        const { salt, hash } = hashPassword(password);
        const user = { id: randomUUID(), name, email, salt, hash, createdAt: new Date().toISOString() };
        await users.setJSON(key, user);
        await users.setJSON(`id/${user.id}`, { id: user.id, name });
        const cookie = await startSession(user, req);
        return json({ user: { id: user.id, name } }, 201, { "set-cookie": cookie });
      }

      if (path === "/login" && method === "POST") {
        const b = await readJSON(req);
        const email = S(b.email, 120).toLowerCase();
        const password = typeof b.password === "string" ? b.password.slice(0, 200) : "";
        const u = await users.get(`email/${sha(email)}`, { type: "json" });
        const ok = u ? checkPassword(password, u.salt, u.hash) : (hashPassword(password), false);
        if (!u || !ok) throw new HttpError(401, "Email or password isn't right.");
        const cookie = await startSession(u, req);
        return json({ user: { id: u.id, name: u.name } }, 200, { "set-cookie": cookie });
      }

      if (path === "/logout" && method === "POST") {
        const token = readCookie(req, "tr_session");
        if (token) await sessions.delete(sha(token));
        return json({ ok: true }, 200, { "set-cookie": cookieHeader("", req, 0) });
      }

      if (path === "/catches" && method === "GET") {
        const me = await requireUser(req);
        return json({ catches: await listCatches(me) });
      }

      if (path === "/catches" && method === "POST") {
        const me = await requireUser(req);
        const b = await readJSON(req);
        const data = cleanCatch(b);
        const id = randomUUID();
        const record = { id, userId: me.id, ...data, photoIds: checkPhotoIds(b.photoIds, me), createdAt: new Date().toISOString() };
        await catches.setJSON(id, record);
        return json({ catch: { ...record, userName: me.name, mine: true } }, 201);
      }

      const cm = path.match(/^\/catches\/([^/]+)$/);
      if (cm) {
        const me = await requireUser(req);
        const id = cm[1];
        if (!CATCH_ID.test(id)) throw new HttpError(404, "Not found.");
        const existing = await catches.get(id, { type: "json" });
        if (!existing || (existing.visibility === "me" && existing.userId !== me.id)) throw new HttpError(404, "Not found.");
        if (method === "GET") {
          const u = await users.get(`id/${existing.userId}`, { type: "json" });
          return json({ catch: { ...existing, userName: u ? u.name : "Unknown", mine: existing.userId === me.id } });
        }
        if (existing.userId !== me.id) throw new HttpError(403, "That catch belongs to someone else.");
        if (method === "PUT") {
          const b = await readJSON(req);
          const data = cleanCatch(b);
          const record = { ...existing, ...data, photoIds: checkPhotoIds(b.photoIds, me), updatedAt: new Date().toISOString() };
          await catches.setJSON(id, record);
          const removed = (existing.photoIds || []).filter((p) => !record.photoIds.includes(p));
          await Promise.all(removed.map((p) => photos.delete(p)));
          return json({ catch: { ...record, userName: me.name, mine: true } });
        }
        if (method === "DELETE") {
          await Promise.all((existing.photoIds || []).map((p) => photos.delete(p)));
          await catches.delete(id);
          return json({ ok: true });
        }
      }

      if (path === "/photos" && method === "POST") {
        const me = await requireUser(req);
        const buf = await req.arrayBuffer();
        if (buf.byteLength > MAX_PHOTO) throw new HttpError(413, "That photo is too big.");
        const head = new Uint8Array(buf.slice(0, 3));
        if (!(head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)) throw bad("Photos need to be JPEG.");
        const id = `${me.id}__${randomUUID()}`;
        await photos.set(id, buf);
        return json({ id }, 201);
      }

      const pm = path.match(/^\/photos\/([^/]+)$/);
      if (pm && method === "GET") {
        await requireUser(req);
        if (!PHOTO_ID.test(pm[1])) throw new HttpError(404, "Not found.");
        const buf = await photos.get(pm[1], { type: "arrayBuffer" });
        if (!buf) throw new HttpError(404, "Not found.");
        return new Response(buf, {
          headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000, immutable" },
        });
      }

      throw new HttpError(404, "Not found.");
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Something went wrong on our side." }, 500);
    }
  };
}
