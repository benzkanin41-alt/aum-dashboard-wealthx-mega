import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { DATA_ROOT } from "../server-lib/local-paths.js";
import { fetchTalisPublicNav } from "../server-lib/talis-public.js";

const output = path.join(DATA_ROOT, "tests", "fund-upgrade-20261003");
const before = JSON.parse(await fs.readFile(path.join(output, "before.json"), "utf8"));
const bases = ["http://127.0.0.1:12014", "https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site", "https://benzkanin41-alt.github.io/aum-dashboard-wealthx-mega/"];
const names = ["local", "sites", "github-pages"];
const code = "TLCHINASTAR50-X";
const report = { startedAt: new Date().toISOString(), signedOut: true, errors: [], progress: [] };
const get = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200, `HTTP ${response.status}: ${url}`);
  return response.json();
};
const browser = await chromium.launch({ headless: true });
try {
  report.preflight = await get(`${bases[1]}/api/dashboard/version`);
  assert.notEqual(report.preflight.job?.status, "running", "Wait for the existing job before the simultaneous-button test");
  const contexts = await Promise.all(bases.map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map(async (context, index) => {
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push({ surface: names[index], error: error.message }));
    await page.goto(bases[index], { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator(".kpi-grid").waitFor({ timeout: 60000 });
    return page;
  }));
  const responses = pages.map(page => page.waitForResponse(response => response.url().endsWith("/api/refresh") && response.request().method() === "POST", { timeout: 60000 }));
  await Promise.all(pages.map(page => page.locator('[data-testid="refresh-button"]').click()));
  report.starts = await Promise.all(responses.map(async pending => {
    const response = await pending;
    return { status: response.status(), body: await response.json() };
  }));
  assert(report.starts.every(start => [202, 429].includes(start.status)));
  const jobId = report.starts[0].body.job.id;
  assert(report.starts.every(start => start.body.job.id === jobId), "All three buttons must share one job");
  console.log(JSON.stringify({ sharedJob: jobId, surfaces: names }));
  await pages[0].locator('[data-range-chart="aum-history"][data-range="3M"]').click();
  await pages[0].locator('[data-chart-id="aum-history"]').scrollIntoViewIfNeeded();
  const scrollBefore = await pages[0].evaluate(() => scrollY);
  let job;
  for (let attempt = 0; attempt < 90; attempt++) {
    job = (await get(`${bases[1]}/api/refresh/status?job=${encodeURIComponent(jobId)}`)).job;
    const state = { status: job.status, stage: job.stage, cursor: job.cursor, at: new Date().toISOString() };
    report.progress.push(state);
    console.log(JSON.stringify(state));
    if (["complete", "failed"].includes(job.status)) break;
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  assert.equal(job.status, "complete", job.error || "Refresh did not complete");
  report.completedJob = job;
  const [local, online] = await Promise.all(bases.slice(0, 2).map(base => get(`${base}/api/dashboard`)));
  const cache = JSON.parse(await fs.readFile(path.join(DATA_ROOT, "cache", "dashboard-cache.json"), "utf8"));
  assert.equal(local.dataVersion, online.dataVersion);
  assert.equal(cache.dataVersion, online.dataVersion);
  assert(!local.cacheWarning, local.cacheWarning);
  for (const page of pages) await page.getByText(online.dataVersion, { exact: true }).waitFor({ timeout: 60000 });
  assert.equal(await pages[0].locator('[data-chart-id="aum-history"]').getAttribute("data-active-range"), "3M");
  const scrollAfter = await pages[0].evaluate(() => scrollY);
  assert(Math.abs(scrollAfter - scrollBefore) < 100, "Sync changed scroll position");
  const series = online.buckets.find(bucket => bucket.id === "wealthx_other");
  assert.equal(series.fundCount, 27);
  assert.equal(online.funds.length, before.snapshot.funds.length + 1);
  const fund = online.funds.find(fund => fund.code === code);
  assert(fund && fund.bucketId === "wealthx_other");
  assert.equal(fund.inceptionDate, "2026-09-24");
  assert(fund.aumMillionBaht > 0 && fund.latestDate >= fund.inceptionDate, "New fund must have real post-inception NAV");
  const detail = await get(`${bases[1]}/api/funds/${code}`);
  const official = (await fetchTalisPublicNav()).find(row => row.code === code);
  assert(official, "The new fund must exist in the official Talis feed");
  assert.equal(detail.identifier, code);
  assert.equal(detail.dataSource, "talis");
  assert.equal(detail.inceptionDate, "2026-09-24");
  assert.equal(detail.history.length, 1, "Initial import must not fabricate a historical backfill");
  const point = detail.history[0];
  assert.equal(point.date, official.navDate);
  assert.equal(point.aumMillionBaht, official.aumMillionBaht);
  assert.equal(point.navPerUnit, official.nav);
  assert.equal(point.sourceUrl, official.source);
  report.newFundOfficialSource = { detail, official };
  const actualKey = row => JSON.stringify([row.id, row.referenceDate, row.amountMillionBaht, row.announcedAt]);
  const actuals = new Set(online.officialAua.map(actualKey));
  assert(before.snapshot.officialAua.every(row => actuals.has(actualKey(row))), "Official AUA history lost");
  assert.deepEqual(online.model, before.snapshot.model, "Unchanged training data must retain the model");
  const currentByCode = new Map(online.funds.map(fund => [fund.code, fund]));
  const histories = {};
  const queue = [...before.snapshot.funds];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const oldFund = queue.shift();
      assert.equal(currentByCode.get(oldFund.code)?.bucketId, oldFund.bucketId);
      const detail = await get(`${bases[1]}/api/funds/${encodeURIComponent(oldFund.code)}`);
      histories[oldFund.code] = detail;
      const points = new Map(detail.history.map(point => [point.date, point]));
      for (const oldPoint of before.histories[oldFund.code].history) {
        const current = points.get(oldPoint.date);
        assert(current, `${oldFund.code}: missing ${oldPoint.date}`);
        assert.equal(current.aumMillionBaht, oldPoint.aumMillionBaht, `${oldFund.code}: changed AUM ${oldPoint.date}`);
        assert.equal(current.navPerUnit, oldPoint.navPerUnit, `${oldFund.code}: changed NAV ${oldPoint.date}`);
      }
    }
  }));
  const protectedFiles = [];
  for (const [file, hash] of Object.entries(before.protectedFiles)) {
    const actual = createHash("sha256").update(await fs.readFile(file)).digest("hex");
    assert.equal(actual, hash, `${file}: protected file changed`);
    protectedFiles.push({ file, sha256: actual, unchanged: true });
  }
  const baselineApp = await fs.readFile(path.join(output, "App.before.tsx"), "utf8");
  const currentApp = (await fs.readFile("src/App.tsx", "utf8")).replace(/import \{ fetchApi \} from "\.\/api";\r?\n/, "").replaceAll("fetchApi(", "fetch(");
  assert.equal(currentApp.replaceAll("\r\n", "\n"), baselineApp.replaceAll("\r\n", "\n"));
  const anchor = online.charts.comparison.find(pair => pair.referenceDate === online.latestActual.referenceDate);
  const expected = online.latestActual.amountMillionBaht + online.model.slope * (series.totalMillionBaht - anchor.seriesxAum);
  assert(Math.abs(expected - online.projection.value) <= 0.015, "Anchored formula differs from independent calculation");
  assert(online.projection.lower <= online.projection.value && online.projection.value <= online.projection.upper);
  report.surfaces = [];
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const versionResponse = await page.waitForResponse(response => response.url().endsWith("/api/dashboard/version"), { timeout: 30000 });
    assert.equal(versionResponse.status(), 200, "Background version polling must work");
    const version = await versionResponse.json();
    assert.equal(version.appId, "aum-dashboard");
    assert.equal(version.dataVersion, online.dataVersion);
    assert.equal(await page.locator(".system-banner.error").count(), 0, "A caught API error is visible in the UI");
    await page.getByPlaceholder("ค้นหาชื่อกองทุน").fill(code);
    await page.getByLabel(`รายละเอียด ${code}`, { exact: true }).click();
    await page.locator(".fund-detail .mini-chart .recharts-wrapper").waitFor({ timeout: 30000 });
    const row = await page.locator(".fund-row").innerText();
    assert(row.includes(code) && !row.includes("รอข้อมูล"));
    await page.getByPlaceholder("ค้นหาชื่อกองทุน").fill("");
    await page.locator('[data-testid="refresh-button"]').waitFor({ state: "visible" });
    assert(await page.locator('[data-testid="refresh-button"]').isEnabled());
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, `${names[index]}-final.png`) });
    report.surfaces.push({ name: names[index], url: bases[index], dataVersion: online.dataVersion, newFundRow: row, updateEnabled: true, backgroundVersionUrl: versionResponse.url(), backgroundSyncHealthy: true });
  }
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  report.after = { dataVersion: online.dataVersion, modelVersion: online.model.id, fundCount: online.funds.length, seriesFundCount: series.fundCount, seriesAum: series.totalMillionBaht, newFund: fund, projection: online.projection, expectedProjection: expected, scrollBefore, scrollAfter };
  report.protectedFiles = protectedFiles;
  report.oldHistoriesRetained = Object.keys(histories).length;
  report.uiSourceUnchangedApartFromApiRouting = true;
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, "live-report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ ok: report.ok, failure: report.failure, after: report.after, report: path.join(output, "live-report.json") }));
}
