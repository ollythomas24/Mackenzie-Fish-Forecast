// Local dev server for tests: static files + the real API handler on an in-memory store.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createHandler } from "../netlify/lib/handler.mjs";
import { memStore } from "./mem-store.mjs";

const handler = createHandler({ stores: { users: memStore(), sessions: memStore(), catches: memStore(), photos: memStore() }, env: {} });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };
const root = new URL("../public/", import.meta.url).pathname;
const port = Number(process.env.PORT || 8899);

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await handler(new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }));
      const headers = {};
      r.headers.forEach((v, k) => (headers[k] = v));
      res.writeHead(r.status, headers);
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let p = normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
    if (p === "/" || p === "") p = "/index.html";
    const data = await readFile(join(root, p));
    res.writeHead(200, { "content-type": types[extname(p)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(port, () => console.log("listening on", port));
