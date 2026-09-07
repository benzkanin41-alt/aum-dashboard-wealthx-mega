import { existsSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || process.argv[2] || "http://127.0.0.1:5174";
const outputDir = path.resolve(process.env.QA_OUTPUT || process.argv[3] || path.join(process.cwd(), "qa-output"));
const cases = [
  { name: "desktop-dark", width: 1440, height: 1100, mobile: false, theme: "dark" },
  { name: "desktop-light", width: 1440, height: 1100, mobile: false, theme: "light" },
  { name: "iphone-dark", width: 390, height: 844, mobile: true, theme: "dark" },
  { name: "iphone-light", width: 390, height: 844, mobile: true, theme: "light" },
  { name: "ipad-dark", width: 820, height: 1180, mobile: true, theme: "dark" },
  { name: "ipad-light", width: 820, height: 1180, mobile: true, theme: "light" }
];

await fs.mkdir(outputDir, { recursive: true });
const executablePath = resolveBrowserExecutable();
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {})
});

try {
  const results = [];
  for (const item of cases) {
    console.error(`QA ${item.name}`);
    results.push(await runCase(browser, item));
  }
  console.log(JSON.stringify({ ok: results.every((item) => item.ok), outputDir, browser: executablePath || "playwright-default", results }, null, 2));
  if (results.some((item) => !item.ok)) process.exitCode = 1;
} finally {
  await browser.close();
}

async function runCase(browserInstance, item) {
  const context = await browserInstance.newContext({
    viewport: { width: item.width, height: item.height },
    screen: { width: item.width, height: item.height },
    deviceScaleFactor: 1,
    isMobile: item.mobile,
    hasTouch: item.mobile
  });
  const page = await context.newPage();
  try {
    await page.addInitScript((theme) => localStorage.setItem("ltmh-aum-theme", theme), item.theme);
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector(".kpi-grid", { state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => document.querySelectorAll(".metric-card").length === 5 && document.querySelectorAll(".recharts-wrapper").length >= 4);

    const chartIds = ["aum-history", "official-aua", "aua-aum-comparison", "aua-aum-projection"];
    const ranges = ["1Y", "6M", "3M", "1M"];
    const timelineInteraction = { ranges: {}, buckets: {} };
    for (const range of ranges) {
      for (const chartId of chartIds) {
        await page.locator(`[data-range-chart="${chartId}"][data-range="${range}"]`).click();
      }
      await page.waitForTimeout(100);
      timelineInteraction.ranges[range] = await page.evaluate((ids) => Object.fromEntries(ids.map((chartId) => {
        const panel = document.querySelector(`[data-chart-id="${chartId}"]`);
        return [chartId, {
          range: panel?.dataset.activeRange || null,
          visiblePoints: Number(panel?.dataset.visiblePoints || 0),
          activeButton: panel?.querySelector(".chart-ranges button.active")?.dataset.range || null
        }];
      })), chartIds);
    }

    await page.locator('[data-range-chart="aum-history"][data-range="1Y"]').click();
    for (const bucketId of ["wealthx_other", "mega30", "other_funds"]) {
      await page.locator(`[data-chart-id="aum-history"] [data-bucket-id="${bucketId}"]`).click();
      await page.waitForTimeout(75);
      timelineInteraction.buckets[bucketId] = await page.locator('[data-chart-id="aum-history"]').evaluate((panel) => ({
        activeBucket: panel.querySelector(".chart-bucket-tabs button.active")?.dataset.bucketId || null,
        visiblePoints: Number(panel.dataset.visiblePoints || 0)
      }));
    }

    for (const chartId of chartIds) {
      await page.locator(`[data-range-chart="${chartId}"][data-range="1Y"]`).click();
    }
    await page.locator('[data-chart-id="aum-history"] [data-bucket-id="wealthx_other"]').click();
    await page.waitForTimeout(200);

    const metrics = await page.evaluate(() => {
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
        rangeGroupCount: document.querySelectorAll(".chart-ranges").length,
        rangeButtonCount: document.querySelectorAll(".chart-ranges button").length,
        rangeButtonHeights: [...document.querySelectorAll(".chart-ranges button")].map((element) => Math.round(element.getBoundingClientRect().height)),
        bucketButtonCount: document.querySelectorAll('[data-chart-id="aum-history"] .chart-bucket-tabs button').length,
        bucketOrder: [...document.querySelectorAll('[data-chart-id="aum-history"] .chart-bucket-tabs button')].map((element) => element.dataset.bucketId),
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
    });

    const file = path.join(outputDir, `${item.name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    const rangeInteractionPassed = ranges.every((range) => Object.values(timelineInteraction.ranges[range])
      .every((state) => state.range === range && state.activeButton === range && state.visiblePoints > 0));
    const rangeCountsGrow = chartIds.every((chartId) => {
      const counts = ["1M", "3M", "6M", "1Y"].map((range) => timelineInteraction.ranges[range][chartId].visiblePoints);
      return counts.every((count, index) => index === 0 || count >= counts[index - 1]);
    });
    const bucketInteractionPassed = Object.entries(timelineInteraction.buckets)
      .every(([bucketId, state]) => state.activeBucket === bucketId && state.visiblePoints > 0);
    const interactionPassed = rangeInteractionPassed && rangeCountsGrow && bucketInteractionPassed;
    const ok = metrics.appId === "aum-dashboard"
      && metrics.theme === item.theme
      && !metrics.globalOverflow
      && metrics.chartCount === 4
      && metrics.rangeGroupCount === 4
      && metrics.rangeButtonCount === 16
      && metrics.rangeButtonHeights.every((height) => height >= 36)
      && metrics.bucketButtonCount === 3
      && metrics.bucketOrder.join(",") === "wealthx_other,mega30,other_funds"
      && metrics.scatterSymbolCount === 7
      && metrics.scatterBounds.every((rect) => rect.width > 0 && rect.height > 0)
      && metrics.metricCount === 5
      && metrics.hasActual
      && metrics.hasProjection
      && metrics.updateEnabled
      && interactionPassed;
    return { ...item, ok, file, metrics, timelineInteraction };
  } finally {
    await context.close();
  }
}

function resolveBrowserExecutable() {
  if (process.env.BROWSER_PATH && existsSync(process.env.BROWSER_PATH)) return process.env.BROWSER_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), "AppData", "Local", "ms-playwright");
  if (!existsSync(root)) return null;
  const folders = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const folder of folders) {
    for (const relative of [path.join("chrome-win64", "chrome.exe"), path.join("chrome-win", "chrome.exe")]) {
      const candidate = path.join(root, folder, relative);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
