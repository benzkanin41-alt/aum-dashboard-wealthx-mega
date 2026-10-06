import { isDeepStrictEqual } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const JOB_TITLE = "LTMH WealthX daily 09:00 Bangkok";
export const REPOSITORY = "benzkanin41-alt/aum-dashboard-wealthx-mega";
export const DISPATCH_URL = `https://api.github.com/repos/${REPOSITORY}/actions/workflows/pages.yml/dispatches`;
export function buildCronJob(token) {
  if (typeof token !== "string" || !/^github_pat_[A-Za-z0-9_]+$/.test(token)) {
    throw new Error("Use a fine-grained GitHub token restricted to this repository with Actions: write");
  }
  return {
    title: JOB_TITLE, url: DISPATCH_URL, enabled: true, saveResponses: false,
    requestMethod: 1, requestTimeout: 30, redirectSuccess: false,
    auth: { enable: false },
    schedule: { timezone: "Asia/Bangkok", expiresAt: 0, hours: [9], minutes: [0], mdays: [-1], months: [-1], wdays: [-1] },
    extendedData: {
      headers: { Accept: "application/vnd.github+json", "Content-Type": "application/json",
        Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2026-03-10" },
      body: JSON.stringify({ ref: "main", inputs: { mode: "daily" } })
    }
  };
}

export function selectExistingJob(jobs) {
  const matches = jobs.filter(job => job.url === DISPATCH_URL || job.title === JOB_TITLE);
  if (matches.length > 1 || (matches[0] && (matches[0].url !== DISPATCH_URL || matches[0].title !== JOB_TITLE))) {
    throw new Error("Ambiguous existing scheduler; no jobs were changed");
  }
  return matches[0] || null;
}

export function verifyJob(actual, expected) {
  for (const key of ["title", "url", "enabled", "saveResponses", "requestMethod", "requestTimeout", "redirectSuccess", "schedule"]) {
    if (!isDeepStrictEqual(actual?.[key], expected[key])) throw new Error(`cron-job.org did not retain ${key}`);
  }
  if (actual.auth?.enable !== false) throw new Error("Unexpected HTTP basic authentication");
  // Never include saved headers or assertion diffs in an error or receipt.
  const headerEntries = Object.entries(actual.extendedData?.headers || {});
  const actualHeaders = Object.fromEntries(headerEntries.map(([key, value]) => [key.toLowerCase(), value]));
  const expectedHeaders = Object.fromEntries(Object.entries(expected.extendedData.headers).map(([key, value]) => [key.toLowerCase(), value]));
  if (Object.keys(actualHeaders).length !== headerEntries.length || !isDeepStrictEqual(actualHeaders, expectedHeaders)) throw new Error("cron-job.org dispatch headers mismatch");
  if (actual.extendedData?.body !== expected.extendedData.body) throw new Error("cron-job.org dispatch body mismatch");
}

export async function configureCronJob({
  args = process.argv.slice(2), fetchImpl = globalThis.fetch,
  readFile = fs.readFile, writeFile = fs.writeFile, now = Date.now,
  log = value => console.log(JSON.stringify(value))
} = {}) {
  const verifyOnly = args.includes("--verify");
  if (verifyOnly && args.includes("--apply")) throw new Error("--verify cannot be combined with --apply");
  const credentialIndex = args.indexOf("--credentials");
  if (credentialIndex < 0 || !args[credentialIndex + 1]) throw new Error("Supply --credentials <private JSON file outside Git>");
  const credentialFile = path.resolve(args[credentialIndex + 1]);
  let credentials;
  try { credentials = JSON.parse((await readFile(credentialFile, "utf8")).replace(/^\uFEFF/, "")); }
  catch { throw new Error("Private credential file could not be read as JSON"); }
  const job = buildCronJob(credentials.githubActionsToken?.trim());
  const apiKey = credentials.cronJobApiKey?.trim();
  if (!apiKey || /[\r\n]/.test(apiKey)) throw new Error("Missing cron-job.org API key");

  async function api(url, token, method = "GET", body) {
    if (!["api.cron-job.org", "api.github.com"].includes(new URL(url).hostname)) throw new Error("Unapproved API destination");
    if (verifyOnly && method !== "GET") throw new Error("Verification only permits GET requests");
    let response;
    try {
      response = await fetchImpl(url, {
        method, redirect: "error", signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch { throw new Error(`${new URL(url).hostname} request failed; no credential or response body was logged`); }
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}; no credential or response body was logged`);
    try { return response.status === 204 ? {} : await response.json(); }
    catch { throw new Error(`${new URL(url).hostname} returned invalid JSON; response body was not logged`); }
  }
  const github = (resource) => api(`https://api.github.com/repos/${REPOSITORY}${resource}`, credentials.githubActionsToken.trim());
  const repository = await github("");
  if (repository.full_name !== REPOSITORY || repository.private !== false) throw new Error("Expected the existing public repository for free standard runners");
  const workflow = await github("/actions/workflows/pages.yml");
  if (workflow.state !== "active") throw new Error("GitHub workflow is not active");
  const content = await github("/contents/.github/workflows/pages.yml?ref=main");
  if (!Buffer.from(content.content, "base64").toString("utf8").includes("REFRESH_MODE:")) throw new Error("Deploy the daily guard workflow before enabling cron-job.org");
  const listing = await api("https://api.cron-job.org/jobs", apiKey);
  if (listing.someFailed || !Array.isArray(listing.jobs)) throw new Error("Incomplete cron-job.org job list; no changes made");
  const existing = selectExistingJob(listing.jobs);
  if (verifyOnly) {
    if (!existing || !Number.isSafeInteger(existing.jobId) || existing.jobId <= 0) throw new Error("No uniquely matching saved cron-job.org job to verify");
    const actual = (await api(`https://api.cron-job.org/jobs/${existing.jobId}`, apiKey)).jobDetails;
    verifyJob(actual, job);
    const evidence = { ...verificationEvidence(actual, existing.jobId, now()), verified: true, readOnly: true };
    log(evidence);
    return evidence;
  }
  if (!args.includes("--apply")) {
    const evidence = { dryRun: true, action: existing ? "update" : "create", jobId: existing?.jobId || null, title: JOB_TITLE, schedule: job.schedule, credentialsValidated: true };
    log(evidence);
    return evidence;
  }

  let jobId = existing?.jobId;
  if (jobId) await api(`https://api.cron-job.org/jobs/${jobId}`, apiKey, "PATCH", { job });
  else jobId = (await api("https://api.cron-job.org/jobs", apiKey, "PUT", { job })).jobId;
  if (!Number.isSafeInteger(jobId)) throw new Error("Provider returned no job ID; inspect jobs before retrying");
  const actual = (await api(`https://api.cron-job.org/jobs/${jobId}`, apiKey)).jobDetails;
  verifyJob(actual, job);
  const evidence = verificationEvidence(actual, jobId, now());
  const evidenceFile = path.join(path.dirname(credentialFile), "cron-job-verification.json");
  await writeFile(evidenceFile, JSON.stringify(evidence, null, 2));
  log(evidence);
  return evidence;
}

function verificationEvidence(actual, jobId, now) {
  const next = new Date(actual.nextExecution * 1000);
  const bangkokDate = new Date(now + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let expectedNext = Date.parse(`${bangkokDate}T02:00:00.000Z`);
  if (expectedNext <= now) expectedNext += 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(actual.nextExecution) || next.getTime() !== expectedNext) throw new Error("Next execution was not verified as the next 09:00 Bangkok");
  const nextTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(next);
  return { checkedAt: new Date(now).toISOString(), jobId, title: actual.title, url: actual.url, enabled: actual.enabled,
    schedule: actual.schedule, nextExecution: next.toISOString(), nextExecutionBangkok: nextTime, credentials: "redacted", deliveryTested: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await configureCronJob(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
