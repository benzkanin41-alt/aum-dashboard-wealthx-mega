import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { DATA_ROOT } from "../server-lib/local-paths.js";
import { fetchTalisFundHistory } from "../server-lib/talis-public.js";

const output = path.join(DATA_ROOT, "tests", "history-gap-20261003");
const before = JSON.parse(await fs.readFile(path.join(output, "before.json"), "utf8"));
const site = "https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site";
const bases = ["http://127.0.0.1:12014", site, "https://benzkanin41-alt.github.io/aum-dashboard-wealthx-mega/"];
const names = ["local", "sites", "github-pages"];
const affected = ["2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29"];
const code = "TLCHINASTAR50-X";
const report = { startedAt: new Date().toISOString(), errors: [], progress: [], signedOut: true };
const get = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200, url);
  return response.json();
};
const browser = await chromium.launch({ headless: true });
try {
  const preflight = await get(`${site}/api/dashboard/version`);
  assert.notEqual(preflight.job?.status, "running");
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
    return { surface: names[responses.indexOf(pending)], status: response.status(), body: await response.json() };
  }));
  assert(report.starts.every(start => [202, 429].includes(start.status)));
  const jobId = report.starts[0].body.job.id;
  assert(report.starts.every(start => start.body.job.id === jobId), "Update buttons did not reuse the same canonical job");
  console.log(JSON.stringify({ sharedJob: jobId, surfaces: names }));
  await pages[1].close();
  report.closedOnlineTabDuringJob = true;
  await pages[0].locator('[data-range-chart="aum-history"][data-range="3M"]').click();
  await pages[0].locator('[data-chart-id="aum-history"]').scrollIntoViewIfNeeded();
  const scrollBefore = await pages[0].evaluate(() => scrollY);
  let job;
  for (let attempt = 0; attempt < 110; attempt++) {
    job = (await get(`${site}/api/refresh/status?job=${encodeURIComponent(jobId)}&advance=1`)).job;
    report.progress.push({ status: job.status, stage: job.stage, cursor: job.cursor, at: new Date().toISOString() });
    console.log(JSON.stringify(report.progress.at(-1)));
    if (["complete", "failed"].includes(job.status)) break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert.equal(job.status, "complete", job.error || "Job not complete");
  report.completedJob = job;
  const repair = job.result.talis.historyBackfill.find(item => item.code === code);
  assert.equal(repair.imported, 3, JSON.stringify(repair));
  assert(!repair.error);
  report.repair = repair;
  pages[1] = await contexts[1].newPage();
  pages[1].on("pageerror", error => report.errors.push({ surface: "sites", error: error.message }));
  await pages[1].goto(site, { waitUntil: "domcontentloaded" });
  const online = await get(`${site}/api/dashboard`);
  const local = await get(`${bases[0]}/api/dashboard`);
  const cache = JSON.parse(await fs.readFile(path.join(DATA_ROOT, "cache", "dashboard-cache.json"), "utf8"));
  assert.equal(local.dataVersion, online.dataVersion);
  assert.equal(cache.dataVersion, online.dataVersion);
  assert(!local.cacheWarning, local.cacheWarning);
  assert.deepEqual(online.model, before.snapshot.model, "The training model was changed");
  assert.deepEqual(online.projection, before.snapshot.projection, "Latest projection changed unexpectedly");
  assert.deepEqual(online.officialAua, before.snapshot.officialAua, "Official AUA was changed");
  assert.equal(online.funds.length, before.snapshot.funds.length);
  assert.deepEqual(online.buckets.map(bucket => [bucket.id, bucket.fundCount]), before.snapshot.buckets.map(bucket => [bucket.id, bucket.fundCount]));
  const histories = {};
  const queue = [...online.funds];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const fund = queue.shift();
      const detail = await get(`${site}/api/funds/${encodeURIComponent(fund.code)}`);
      histories[fund.code] = detail;
      assert.equal(detail.inceptionDate, before.histories[fund.code].inceptionDate);
      assert.equal(detail.bucketId, before.histories[fund.code].bucketId);
      const points = new Map(detail.history.map(point => [point.date, point]));
      for (const previous of before.histories[fund.code].history) {
        const current = points.get(previous.date);
        assert(current, `${fund.code}: lost ${previous.date}`);
        assert.equal(current.aumMillionBaht, previous.aumMillionBaht, `${fund.code}: changed AUM ${previous.date}`);
        assert.equal(current.navPerUnit, previous.navPerUnit, `${fund.code}: changed NAV ${previous.date}`);
        assert.equal(current.sourceUrl, previous.sourceUrl, `${fund.code}: changed provenance ${previous.date}`);
        assert.equal(current.revisedAt, previous.revisedAt, `${fund.code}: unexpected revision ${previous.date}`);
      }
      if (fund.code !== code) assert.equal(detail.history.length, before.histories[fund.code].history.length);
    }
  }));
  const fund = histories[code];
  const official = (await fetchTalisFundHistory("40081")).filter(point => point.navDate >= "2026-09-24" && point.navDate <= "2026-09-29");
  assert.equal(fund.history.length, before.histories[code].history.length + 3);
  for (const source of official) {
    const point = fund.history.find(point => point.date === source.navDate);
    assert.equal(point.aumMillionBaht, source.aumMillionBaht);
    assert.equal(point.navPerUnit, source.nav);
    assert.equal(point.sourceUrl, source.source);
  }
  assert(!fund.history.some(point => ["2026-09-25", "2026-09-26", "2026-09-27"].includes(point.date)), "Unpublished NAV dates were invented");
  report.officialHistory = official;
  const timeline = new Map(online.charts.timeline.map(row => [row.date, row]));
  for (const old of before.snapshot.charts.timeline) if (!affected.includes(old.date)) assert.deepEqual(timeline.get(old.date), old, `Unaffected timeline changed: ${old.date}`);
  report.restored = affected.map(date => {
    const row = timeline.get(date);
    let total = 0;
    const components = [];
    for (const member of online.funds.filter(fund => fund.bucketId === "wealthx_other" && (!fund.inceptionDate || fund.inceptionDate <= date))) {
      const point = histories[member.code].history.filter(point => point.date <= date).at(-1);
      assert(point && (Date.parse(date) - Date.parse(point.date)) / 86400000 <= 7, `${member.code} incomplete on ${date}`);
      total += point.aumMillionBaht;
      components.push({ code: member.code, sourceDate: point.date, aum: point.aumMillionBaht });
    }
    const expectedAum = Math.round((total + Number.EPSILON) * 100) / 100;
    const expectedAua = online.projection.anchorAuaMillionBaht + online.model.slope * (expectedAum - online.projection.anchorAumMillionBaht);
    assert.equal(row.seriesxAum, expectedAum);
    assert(Math.abs(row.projectedAua - expectedAua) <= 0.01);
    assert(row.lower != null && row.lower <= row.projectedAua && row.projectedAua <= row.upper);
    return { ...row, expectedAum, expectedAua, components };
  });
  report.protectedFiles = [];
  for (const [file, sha256] of Object.entries(before.protectedFiles)) {
    assert.equal(createHash("sha256").update(await fs.readFile(file)).digest("hex"), sha256, `Protected file changed: ${file}`);
    report.protectedFiles.push({ file, sha256, unchanged: true });
  }
  for (const page of pages) await page.getByText(online.dataVersion, { exact: true }).waitFor({ timeout: 60000 });
  assert.equal(await pages[0].locator('[data-chart-id="aum-history"]').getAttribute("data-active-range"), "3M");
  const scrollAfter = await pages[0].evaluate(() => scrollY);
  assert(Math.abs(scrollAfter - scrollBefore) < 100, "Sync moved the active view");
  report.preservedView = { range: "3M", scrollBefore, scrollAfter };
  report.surfaces = [];
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const poll = await page.waitForResponse(response => response.url().endsWith("/api/dashboard/version"), { timeout: 30000 });
    assert.equal(poll.status(), 200);
    assert.equal((await poll.json()).dataVersion, online.dataVersion);
    assert.equal(await page.locator(".system-banner.error").count(), 0);
    assert(await page.locator('[data-testid="refresh-button"]').isEnabled());
    await page.locator('[data-range-chart="aua-aum-projection"][data-range="1M"]').click();
    const chart = page.locator('[data-chart-id="aua-aum-projection"]');
    await chart.scrollIntoViewIfNeeded();
    await chart.screenshot({ path: path.join(output, `${names[index]}-repaired-1m.png`) });
    report.surfaces.push({ name: names[index], url: bases[index], dataVersion: online.dataVersion, updateEnabled: true, pollingHealthy: true });
  }
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  report.retainedPoints = Object.values(before.histories).reduce((sum, fund) => sum + fund.history.length, 0);
  report.afterPointCount = Object.values(histories).reduce((sum, fund) => sum + fund.history.length, 0);
  report.after = { dataVersion: online.dataVersion, generatedAt: online.generatedAt, model: online.model, fundCount: online.funds.length, latestProjection: online.projection, sourceStatus: online.sourceStatus };
  report.ok = true;
  await fs.writeFile(path.join(output, "after.json"), JSON.stringify({ capturedAt: new Date().toISOString(), snapshot: online, histories }, null, 2));
} catch (error) {
  report.ok = false;
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, "live-report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ ok: report.ok, failure: report.failure, restored: report.restored?.map(({ date, seriesxAum, projectedAua }) => ({ date, seriesxAum, projectedAua })), report: path.join(output, "live-report.json") }));
}
