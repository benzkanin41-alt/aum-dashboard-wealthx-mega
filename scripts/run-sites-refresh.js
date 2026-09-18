import { appendFile } from "node:fs/promises";
import { dailyRefreshDecision } from "./scheduler-policy.js";

const base = (process.env.SITES_BASE_URL || "https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site").replace(/\/$/, "");
await main();

async function main() {
  const mode = process.env.REFRESH_MODE || "manual";
  if (!["daily", "manual"].includes(mode)) throw new Error("REFRESH_MODE must be daily or manual");
  const runnerStartedAt = new Date().toISOString();
  let decision = { skip: false, reason: "manual", targetAt: null };
  if (mode === "daily") {
    const metadata = (await requestJson(`${base}/api/dashboard/version`, {}, [200])).body;
    decision = dailyRefreshDecision(metadata);
    if (decision.skip) {
      await report({ ok: true, skipped: true, mode, ...decision, runnerStartedAt, runnerCompletedAt: new Date().toISOString(),
        jobId: metadata.job?.id, dataVersion: metadata.dataVersion, startedAt: metadata.job?.startedAt, completedAt: metadata.job?.completedAt });
      return;
    }
  }
  const started = await requestJson(`${base}/api/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, [202, 429]);
  if (!started.body.job?.id) throw new Error(`Refresh did not return a job: ${JSON.stringify(started.body)}`);
  let job = started.body.job;
  for (let attempt = 0; attempt < 600 && !["complete", "failed"].includes(job.status); attempt += 1) {
    await sleep(1200);
    const status = await requestJson(`${base}/api/refresh/status?job=${encodeURIComponent(job.id)}&advance=1`, {}, [200]);
    job = status.body.job;
    if (!job) throw new Error("Refresh job disappeared");
    console.log(JSON.stringify({ id: job.id, status: job.status, stage: job.stage, progress: job.progress }));
  }
  if (job.status !== "complete") throw new Error(job.error || `Refresh timed out in ${job.stage}`);
  const dashboard = await requestJson(`${base}/api/dashboard`, {}, [200]);
  if (dashboard.body.appId !== "aum-dashboard" || !dashboard.body.dataVersion || !dashboard.body.model?.id) throw new Error("Invalid canonical dashboard after refresh");
  await report({ ok: true, skipped: false, mode, targetAt: decision.targetAt, runnerStartedAt, runnerCompletedAt: new Date().toISOString(),
    jobId: job.id, startedAt: job.startedAt, completedAt: job.completedAt,
    delaySeconds: decision.targetAt ? Math.max(0, Math.round((Date.parse(job.startedAt) - Date.parse(decision.targetAt)) / 1000)) : null,
    dataVersion: dashboard.body.dataVersion, modelVersion: dashboard.body.model?.id, generatedAt: dashboard.body.generatedAt });
}

async function report(result) {
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Canonical Sites refresh\n\nDaily target: 09:00 Asia/Bangkok. Timestamps below are UTC.\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`);
  }
}

async function requestJson(url, options, accepted) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${url} returned non-JSON HTTP ${response.status}`); }
  if (!accepted.includes(response.status)) throw new Error(body.error || `${url} HTTP ${response.status}`);
  return { response, body };
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
