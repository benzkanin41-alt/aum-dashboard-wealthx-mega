import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const edge = process.env.BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:5174";
const outputDir = path.resolve(process.env.QA_OUTPUT || path.join(process.cwd(), "qa-output"));
const profile = path.resolve(os.tmpdir(), `ltmh-dashboard-qa-${process.pid}`);
const port = 9337;
const cases = [
  { name: "desktop-dark", width: 1440, height: 1100, mobile: false, theme: "dark" },
  { name: "desktop-light", width: 1440, height: 1100, mobile: false, theme: "light" },
  { name: "iphone-dark", width: 390, height: 844, mobile: true, theme: "dark" },
  { name: "iphone-light", width: 390, height: 844, mobile: true, theme: "light" },
  { name: "ipad-dark", width: 820, height: 1180, mobile: true, theme: "dark" },
  { name: "ipad-light", width: 820, height: 1180, mobile: true, theme: "light" }
];

await fs.mkdir(outputDir, { recursive: true });
const browser = spawn(edge, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--disable-extensions",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank"
], { stdio: "ignore", windowsHide: true });

try {
  await waitForBrowser();
  const results = [];
  for (const item of cases) results.push(await runCase(item));
  console.log(JSON.stringify({ ok: results.every((item) => item.ok), outputDir, results }, null, 2));
  if (results.some((item) => !item.ok)) process.exitCode = 1;
} finally {
  browser.kill();
  await sleep(400);
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (profile.startsWith(tempRoot)) await fs.rm(profile, { recursive: true, force: true });
}

async function runCase(item) {
  const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(baseUrl)}`, { method: "PUT" }).then((response) => response.json());
  const cdp = await connect(target.webSocketDebuggerUrl);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: item.width,
      height: item.height,
      deviceScaleFactor: 1,
      mobile: item.mobile,
      screenWidth: item.width,
      screenHeight: item.height
    });
    await cdp.send("Page.navigate", { url: baseUrl });
    await waitForReady(cdp);
    await cdp.send("Runtime.evaluate", {
      expression: `localStorage.setItem("ltmh-aum-theme", "${item.theme}"); location.reload()`
    });
    await waitForReady(cdp);
    const metrics = await evaluate(cdp, `(() => {
      const html = document.documentElement;
      const body = document.body;
      const visibleText = body.innerText;
      return {
        appId: document.querySelector('meta[name="application-id"]')?.content || null,
        theme: html.dataset.theme || null,
        viewport: { width: innerWidth, height: innerHeight },
        documentWidth: html.scrollWidth,
        bodyWidth: body.scrollWidth,
        globalOverflow: html.scrollWidth > innerWidth + 1 || body.scrollWidth > innerWidth + 1,
        chartCount: document.querySelectorAll(".chart-panel").length,
        scatterSymbolCount: document.querySelectorAll(".recharts-scatter-symbol").length,
        scatterBounds: [...document.querySelectorAll(".recharts-scatter-symbol")].map((element) => {
          const rect = element.getBoundingClientRect();
          return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
        }),
        metricCount: document.querySelectorAll(".metric-card").length,
        hasActual: visibleText.includes("AUA ทางการ"),
        hasProjection: visibleText.includes("AUA Projection"),
        updateEnabled: !document.querySelector('[data-testid="refresh-button"]')?.disabled
      };
    })()`);
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    const file = path.join(outputDir, `${item.name}.png`);
    await fs.writeFile(file, Buffer.from(screenshot.data, "base64"));
    const ok = metrics.appId === "aum-dashboard"
      && metrics.theme === item.theme
      && !metrics.globalOverflow
      && metrics.chartCount === 3
      && metrics.scatterSymbolCount === 7
      && metrics.scatterBounds.every((rect) => rect.width > 0 && rect.height > 0)
      && metrics.metricCount === 5
      && metrics.hasActual
      && metrics.hasProjection
      && metrics.updateEnabled;
    await cdp.send("Page.close");
    return { ...item, ok, file, metrics };
  } finally {
    cdp.close();
  }
}

async function waitForReady(cdp) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await evaluate(cdp, `Boolean(document.querySelector(".kpi-grid") && document.querySelectorAll(".metric-card").length === 5)`);
    if (ready) return;
    await sleep(150);
  }
  throw new Error("Dashboard did not reach the ready state");
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed");
  return result.result.value;
}

async function waitForBrowser() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error("Headless browser did not start");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        const id = nextId++;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise((resolveMessage, rejectMessage) => pending.set(id, { resolve: resolveMessage, reject: rejectMessage }));
      },
      close() { socket.close(); }
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !pending.has(message.id)) return;
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
    socket.addEventListener("error", () => reject(new Error("CDP connection failed")));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
