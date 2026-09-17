import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_ROOT } from "./server-lib/local-paths.js";
import { readBestCache, writeCacheSafely, validateDashboard } from "./server-lib/dashboard-cache.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(__dirname, "dist", "client");
const REMOTE_BASE = (process.env.SITES_BASE_URL || "https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site").replace(/\/$/, "");
const PORT = Number(process.env.PORT || 12014);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
    if (url.pathname === "/api/health") {
      return sendJson(res, 200, { ok: true, appId: "aum-dashboard", mode: "local-cache-proxy", remote: REMOTE_BASE, dataRoot: DATA_ROOT, time: new Date().toISOString() });
    }
    if (url.pathname === "/api/dashboard" && req.method === "GET") {
      try {
        const response = await fetchWithTimeout(`${REMOTE_BASE}/api/dashboard`, { headers: { accept: "application/json" } }, 20_000);
        if (!response.ok) throw new Error(`Sites dashboard HTTP ${response.status}`);
        const payload = await response.json();
        validateDashboard(payload);
        await writeCacheSafely(payload);
        return sendJson(res, 200, { ...payload, offline: false, localProxy: true });
      } catch (error) {
        const cached = await readBestCache();
        if (!cached) throw error;
        validateDashboard(cached);
        return sendJson(res, 200, { ...cached, offline: true, localProxy: true, cachedAt: cached.generatedAt || null, offlineReason: messageOf(error) });
      }
    }
    if (url.pathname === "/api/dashboard/version" && req.method === "GET") {
      try { return await proxyApi(req, res, url); }
      catch (error) {
        const cached = await readBestCache();
        if (!cached) throw error;
        return sendJson(res, 200, { appId: "aum-dashboard", dataVersion: cached.dataVersion, generatedAt: cached.generatedAt, offline: true, job: null });
      }
    }
    if (url.pathname.startsWith("/api/")) return await proxyApi(req, res, url);
    return serveSpa(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: messageOf(error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`LTMH WealthX AUM & AUA dashboard running on http://127.0.0.1:${PORT}`);
  console.log(`Canonical Sites API: ${REMOTE_BASE}`);
});

async function proxyApi(req, res, url) {
  const target = `${REMOTE_BASE}${url.pathname}${url.search}`;
  const body = ["POST", "PUT", "PATCH"].includes(req.method || "") ? await readBody(req) : undefined;
  const response = await fetchWithTimeout(target, {
    method: req.method,
    headers: { accept: req.headers.accept || "application/json", "content-type": req.headers["content-type"] || "application/json" },
    body
  }, 60_000);
  const buffer = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/octet-stream", "cache-control": "no-store" });
  res.end(buffer);
}

async function serveSpa(res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.normalize(path.join(STATIC_DIR, relative));
  if (!candidate.startsWith(STATIC_DIR)) return sendText(res, 404, "Not found");
  try {
    const content = await fs.readFile(candidate);
    res.writeHead(200, { "content-type": contentType(candidate), "cache-control": candidate.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable" });
    res.end(content);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const content = await fs.readFile(path.join(STATIC_DIR, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(content);
  }
}

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

function messageOf(error) { return error instanceof Error ? error.message : String(error); }
