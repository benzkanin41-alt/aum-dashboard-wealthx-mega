import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { DATA_ROOT } from "../server-lib/local-paths.js";

const online = "https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site";
const local = "http://127.0.0.1:12014";
const output = path.join(DATA_ROOT, "tests", "live-refresh");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = { startedAt: new Date().toISOString(), signedOut: true, progress: [], errors: [] };
const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
let pages;
async function request(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200, `${url}: HTTP ${response.status}`);
  return response.json();
}
async function openPages() {
  return Promise.all(contexts.map(async (context, index) => {
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    await page.goto([local, online][index], { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator('[data-testid="refresh-button"]').waitFor();
    await page.locator(".kpi-grid").waitFor({ timeout: 60000 });
    return page;
  }));
}
try {
  pages = await openPages();
  report.before = await request(`${online}/api/dashboard/version`);
  const responses = pages.map(page => page.waitForResponse(response => response.url().endsWith("/api/refresh") && response.request().method() === "POST", { timeout: 60000 }));
  await Promise.all(pages.map(page => page.locator('[data-testid="refresh-button"]').click()));
  const starts = await Promise.all(responses.map(async responsePromise => {
    const response = await responsePromise;
    return { status: response.status(), body: await response.json() };
  }));
  assert(starts.every(start => [202, 429].includes(start.status)));
  report.starts = starts;
  assert.equal(starts[0].body.job.id, starts[1].body.job.id, "Both buttons must share one job");
  const jobId = starts[0].body.job.id;
  console.log(JSON.stringify({ sharedJob: jobId }));
  await new Promise(resolve => setTimeout(resolve, 15000));
  await Promise.all(pages.map(page => page.close()));
  const paused = await request(`${online}/api/refresh/status?job=${encodeURIComponent(jobId)}`);
  report.interrupted = { jobId: paused.job.id, stage: paused.job.stage, status: paused.job.status };
  await new Promise(resolve => setTimeout(resolve, 3000));
  pages = await openPages();
  await pages[0].locator('[data-range-chart="aum-history"][data-range="3M"]').click();
  await pages[0].locator('[data-chart-id="aum-history"]').scrollIntoViewIfNeeded();
  const scrollBefore = await pages[0].evaluate(() => scrollY);
  let job;
  for (let attempt = 0; attempt < 100; attempt++) {
    job = (await request(`${online}/api/refresh/status?job=${encodeURIComponent(jobId)}`)).job;
    const state = { id: job.id, status: job.status, stage: job.stage, cursor: job.cursor, total: job.total, at: new Date().toISOString() };
    report.progress.push(state);
    console.log(JSON.stringify(state));
    if (["complete", "failed"].includes(job.status)) break;
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  report.completedJob = job;
  assert.equal(job.status, "complete", job.error || "Refresh did not complete");
  const snapshots = await Promise.all([local, online].map(base => request(`${base}/api/dashboard`)));
  assert.equal(snapshots[0].dataVersion, snapshots[1].dataVersion);
  assert.equal(snapshots[0].model.id, snapshots[1].model.id);
  for (const page of pages) await page.getByText(snapshots[1].dataVersion, { exact: true }).waitFor({ timeout: 60000 });
  assert.equal(await pages[0].locator('[data-chart-id="aum-history"]').getAttribute("data-active-range"), "3M");
  const scrollAfter = await pages[0].evaluate(() => scrollY);
  assert(Math.abs(scrollAfter - scrollBefore) < 100, "Sync changed scroll position");
  report.after = { dataVersion: snapshots[1].dataVersion, modelVersion: snapshots[1].model.id, schemaVersion: snapshots[1].schemaVersion, fundCount: snapshots[1].funds.length, sourceStatus: snapshots[1].sourceStatus, currentProjection: snapshots[1].projection, scrollBefore, scrollAfter };
  report.cache = JSON.parse(await fs.readFile(path.join(DATA_ROOT, "cache", "dashboard-cache.json"), "utf8")).dataVersion;
  assert.equal(report.cache, snapshots[1].dataVersion);
  for (let i = 0; i < pages.length; i++) {
    await pages[i].evaluate(() => scrollTo(0,0));
    await pages[i].screenshot({ path: path.join(output, `${["local", "online"][i]}.png`) });
  }
  report.ok = report.errors.length === 0;
  assert(report.ok, report.errors.join("; "));
} catch (error) {
  report.ok = false;
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ ok: report.ok, failure: report.failure, after: report.after, report: path.join(output, "report.json") }));
}
