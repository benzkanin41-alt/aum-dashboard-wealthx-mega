import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildCronJob, verifyJob, REPOSITORY } from "./configure-cron-job.js";

const args = process.argv.slice(2);
const credentialFile = args[args.indexOf("--credentials") + 1];
if (!args.includes("--credentials") || !credentialFile) throw new Error("Supply --credentials <private JSON file>");
const credentials = JSON.parse((await fs.readFile(credentialFile, "utf8")).replace(/^\uFEFF/, ""));
const job = buildCronJob(credentials.githubActionsToken?.trim());
const apiKey = credentials.cronJobApiKey?.trim();
if (!apiKey) throw new Error("Missing cron-job.org API key");
const record = { startedAt: new Date().toISOString(), purpose: "one-off manual refresh through cron-job.org", primaryScheduleChanged: false };
const planned = new Date(Math.ceil((Date.now() + 120000) / 60000) * 60000);
const expires = new Date(planned.getTime() + 10 * 60000);
job.title = `LTMH delivery verification ${randomUUID()}`;
job.saveResponses = true;
job.extendedData.body = JSON.stringify({ ref: "main", inputs: { mode: "manual" } });
job.schedule = { timezone: "UTC", hours: [planned.getUTCHours()], minutes: [planned.getUTCMinutes()], mdays: [planned.getUTCDate()],
  months: [planned.getUTCMonth() + 1], wdays: [-1], expiresAt: Number(expires.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)) };
let jobId;

async function api(host, resource, method = "GET", body) {
  const token = host === "api.cron-job.org" ? apiKey : credentials.githubActionsToken.trim();
  if (!["api.cron-job.org", "api.github.com"].includes(host)) throw new Error("Unapproved API destination");
  const response = await fetch(`https://${host}${resource}`, { method, redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(`${host} HTTP ${response.status}; response body not logged`);
  return response.status === 204 ? {} : response.json();
}
const cron = (resource, method, body) => api("api.cron-job.org", resource, method, body);
const github = (resource) => api("api.github.com", `/repos/${REPOSITORY}${resource}`);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

try {
  jobId = (await cron("/jobs", "PUT", { job })).jobId;
  if (!Number.isSafeInteger(jobId)) throw new Error("One-off job ID unavailable; inspect the provider before retrying");
  verifyJob((await cron(`/jobs/${jobId}`)).jobDetails, job);
  record.testJobId = jobId;
  record.plannedAt = planned.toISOString();
  console.log(JSON.stringify({ testJobId: jobId, plannedAt: record.plannedAt, primaryScheduleChanged: false }));
  await sleep(Math.max(1000, planned.getTime() - Date.now() + 10000));
  let history;
  for (let attempt = 0; attempt < 10; attempt++) {
    history = (await cron(`/jobs/${jobId}/history`)).history?.[0];
    if (history) break;
    await sleep(15000);
  }
  if (!history) throw new Error("No provider execution history within the test window");
  record.cron = { status: history.status, httpStatus: history.httpStatus, plannedAt: new Date(history.datePlanned * 1000).toISOString(),
    actualAt: new Date(history.date * 1000).toISOString(), jitterMs: history.jitter, durationMs: history.duration };
  if (history.status !== 1 || ![200, 204].includes(history.httpStatus)) throw new Error(`Provider delivery failed: status ${history.status}, HTTP ${history.httpStatus}`);
  const detail = (await cron(`/jobs/${jobId}/history/${encodeURIComponent(history.identifier)}`)).jobHistoryDetails;
  let dispatch;
  try { dispatch = JSON.parse(detail.body); } catch { throw new Error("GitHub dispatch did not return a verifiable run ID"); }
  const runId = dispatch.workflow_run_id;
  if (!Number.isSafeInteger(runId)) throw new Error("GitHub dispatch returned no run ID");
  record.runId = runId;
  record.runUrl = `https://github.com/${REPOSITORY}/actions/runs/${runId}`;
  console.log(JSON.stringify({ cron: record.cron, runId, runUrl: record.runUrl }));

  let run;
  for (let attempt = 0; attempt < 40; attempt++) {
    run = await github(`/actions/runs/${runId}`);
    console.log(JSON.stringify({ runId, status: run.status, conclusion: run.conclusion }));
    if (run.status === "completed") break;
    await sleep(20000);
  }
  record.github = { status: run?.status, conclusion: run?.conclusion, createdAt: run?.created_at, startedAt: run?.run_started_at, updatedAt: run?.updated_at, headSha: run?.head_sha };
  if (run?.conclusion !== "success") throw new Error("The dispatched GitHub refresh did not finish successfully");
  const base = "https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site";
  const response = await fetch(`${base}/api/dashboard/version`, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error("Canonical status unavailable");
  const metadata = await response.json();
  if (metadata.appId !== "aum-dashboard" || metadata.job?.status !== "complete"
    || metadata.job.result?.dataVersion !== metadata.dataVersion || Date.parse(metadata.job.startedAt) < history.datePlanned * 1000) {
    throw new Error("A newly completed canonical refresh could not be verified");
  }
  record.canonical = { jobId: metadata.job.id, dataVersion: metadata.dataVersion, modelVersion: metadata.job.result.modelVersion,
    startedAt: metadata.job.startedAt, completedAt: metadata.job.completedAt };
  record.ok = true;
} catch (error) {
  record.ok = false;
  record.error = error.message;
  process.exitCode = 1;
} finally {
  if (jobId) {
    try {
      const owned = (await cron(`/jobs/${jobId}`)).jobDetails;
      if (owned?.title !== job.title || owned.url !== job.url) throw new Error("Test job identity changed; cleanup refused");
      await cron(`/jobs/${jobId}`, "DELETE");
      record.testJobRemoved = true;
    } catch (error) { record.cleanupError = error.message; process.exitCode = 1; }
  }
  record.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(path.dirname(path.resolve(credentialFile)), "cron-delivery-verification.json"), JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record));
}
