// Local server: static files from public/ + the bundled API. Usage: node tests/support/server.mjs [port]
import "./env.mjs";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { default: handler } = await import(path.join(root, "tests/.build/api.mjs"));
const pub = path.join(root, "public");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const port = Number(process.argv[2] || 8899);
http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      let body = ""; for await (const c of req) body += c;
      const r = await handler(new Request("http://localhost" + req.url, {
        method: req.method, headers: req.headers, body: ["GET", "HEAD", "DELETE"].includes(req.method) ? undefined : body,
      }), {});
      res.writeHead(r.status, { "content-type": "application/json" }); res.end(await r.text()); return;
    }
    const rel = decodeURIComponent(req.url.split("?")[0]);
    const file = path.join(pub, rel === "/" ? "index.html" : rel);
    if (!file.startsWith(pub) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": (types[path.extname(file)] || "application/octet-stream") + ";charset=utf-8" });
    fs.createReadStream(file).pipe(res);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
}).listen(port, () => console.log(`test server on http://localhost:${port}`));
