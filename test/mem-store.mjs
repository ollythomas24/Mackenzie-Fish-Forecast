// In-memory stand-in for a Netlify Blobs store (same method names we use).
export function memStore() {
  const m = new Map();
  return {
    async get(key, opts = {}) {
      if (!m.has(key)) return null;
      const v = m.get(key);
      if (opts.type === "json") return JSON.parse(v);
      return v;
    },
    async setJSON(key, value) { m.set(key, JSON.stringify(value)); },
    async set(key, value) { m.set(key, value); },
    async delete(key) { m.delete(key); },
    async list() { return { blobs: [...m.keys()].map((key) => ({ key, etag: "x" })) }; },
    _size: () => m.size,
  };
}
