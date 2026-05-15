import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRefreshState, loadDashboardData, refreshAll, scheduleDailyRefresh } from "./server-lib/sec-refresh.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 4173);

const nextRefresh = scheduleDailyRefresh();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/dashboard") {
      return sendJson(res, await loadDashboardData());
    }

    if (url.pathname === "/api/refresh" && req.method === "POST") {
      refreshAll({ full: url.searchParams.get("full") === "1" });
      return sendJson(res, { ok: true, status: getRefreshState() });
    }

    if (url.pathname === "/api/refresh/status") {
      return sendJson(res, { ...getRefreshState(), nextRefreshAt: nextRefresh.toISOString() });
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
    if (!filePath.startsWith(PUBLIC_DIR)) return notFound(res);

    const content = await fs.readFile(filePath);
    res.writeHead(200, { "content-type": contentType(filePath), "cache-control": "no-store" });
    res.end(content);
  } catch (error) {
    if (error.code === "ENOENT") return notFound(res);
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, () => {
  console.log(`AUM dashboard running on http://localhost:${PORT}`);
  console.log(`Next scheduled refresh: ${nextRefresh.toISOString()} (09:00 Asia/Bangkok)`);
});

function sendJson(res, payload) {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}
