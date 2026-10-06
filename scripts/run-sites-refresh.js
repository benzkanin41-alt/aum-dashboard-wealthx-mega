import { appendFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { dailyRefreshDecision } from "./scheduler-policy.js";

export async function runSitesRefresh({
  mode = process.env.REFRESH_MODE || "manual",
  base = process.env.SITES_BASE_URL || "https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site",
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleepImpl = sleep,
  deadlineMs = 12 * 60 * 1000,
  reportResult = report,
  onProgress = job => console.log(JSON.stringify({ id: job.id, status: job.status, stage: job.stage, progress: job.progress }))
} = {}) {
  if (!["daily", "manual"].includes(mode)) throw new Error("REFRESH_MODE must be daily or manual");
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new Error("Invalid scheduler deadline");
  base = base.replace(/\/$/, "");
  const runnerStartedAt = new Date(now()).toISOString();
  const deadline = now() + deadlineMs;
  let nextRequestAt = 0;
  let participated = false;

  function remaining() {
    const value = deadline - now();
    if (!Number.isFinite(value) || value <= 0) throw new Error("Scheduler deadline exceeded; canonical refresh is incomplete");
    return value;
  }
  async function wait(ms) {
    await sleepImpl(Math.min(ms, remaining()));
    remaining();
  }
  async function emit(result) {
    remaining();
    await reportResult(result);
    return result;
  }
  const version = async () => (await requestJson("/api/dashboard/version")).body;

  // Re-read the canonical guard after every cooldown and every completed job.
  while (true) {
    remaining();
    let decision = { skip: false, reason: "manual", targetAt: null };
    let job;
    if (mode === "daily") {
      const metadata = await version();
      decision = dailyRefreshDecision(metadata, new Date(now()));
      if (decision.skip) {
        if (decision.reason === "before-0900-bangkok" || !participated) {
          return emit({ ok: true, skipped: true, mode, ...decision, runnerStartedAt, runnerCompletedAt: new Date(now()).toISOString(),
            jobId: metadata.job?.id, dataVersion: metadata.dataVersion, startedAt: metadata.job?.startedAt, completedAt: metadata.job?.completedAt });
        }
        const dashboard = (await requestJson("/api/dashboard")).body;
        validateDashboard(dashboard);
        const confirmed = await version();
        const confirmedDecision = dailyRefreshDecision(confirmed, new Date(now()));
        if (confirmedDecision.reason === "already-refreshed-after-0900" && confirmed.dataVersion === dashboard.dataVersion) {
          return emit(success(dashboard, confirmed.job, confirmedDecision.targetAt));
        }
        await wait(1200);
        continue;
      }
      if (metadata.job?.status === "running" && metadata.job.id) job = metadata.job;
      else if (now() < nextRequestAt) {
        await wait(Math.min(30000, nextRequestAt - now()));
        continue;
      }
    }

    if (!job) {
      const started = await requestJson("/api/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, [202, 429]);
      if (!started.body.job?.id) throw new Error("Refresh did not return a job");
      job = started.body.job;
      nextRequestAt = Math.max(nextRequestAt, now() + retryAfterMs(started.response, now()));
      const retrySeconds = Number(started.body.retryAfterSeconds);
      if (Number.isFinite(retrySeconds) && retrySeconds > 0) nextRequestAt = Math.max(nextRequestAt, now() + retrySeconds * 1000);
      if (started.response.status === 429 && nextRequestAt <= now()) {
        const requested = Date.parse(job.requestedAt || job.startedAt);
        nextRequestAt = Math.max(now() + 1200, Number.isFinite(requested) ? requested + 5 * 60 * 1000 : now() + 5 * 60 * 1000);
      }
      if (started.response.status === 202) participated = true;
    }
    if (!job.id) throw new Error("Refresh did not return a job");
    while (!["complete", "failed"].includes(job.status)) {
      participated = true;
      await wait(1200);
      job = (await requestJson(`/api/refresh/status?job=${encodeURIComponent(job.id)}&advance=1`)).body.job;
      if (!job?.id) throw new Error("Refresh job disappeared");
      onProgress(job);
    }
    if (job.status !== "complete") throw new Error("Canonical refresh job failed");
    if (mode === "manual") {
      const dashboard = (await requestJson("/api/dashboard")).body;
      validateDashboard(dashboard);
      return emit(success(dashboard, job, null));
    }
    const requested = Date.parse(job.requestedAt || job.startedAt);
    nextRequestAt = Math.max(nextRequestAt, now() + 1200, Number.isFinite(requested) ? requested + 5 * 60 * 1000 : 0);
  }

  function success(dashboard, job, targetAt) {
    return { ok: true, skipped: false, mode, targetAt, runnerStartedAt, runnerCompletedAt: new Date(now()).toISOString(),
      jobId: job.id, startedAt: job.startedAt, completedAt: job.completedAt,
      delaySeconds: targetAt ? Math.max(0, Math.round((Date.parse(job.startedAt) - Date.parse(targetAt)) / 1000)) : null,
      dataVersion: dashboard.dataVersion, modelVersion: dashboard.model.id, generatedAt: dashboard.generatedAt };
  }

  async function requestJson(resource, options = {}, accepted = [200]) {
    const method = options.method || "GET";
    const attempts = method === "GET" ? 4 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response;
      let text;
      try {
        response = await fetchImpl(`${base}${resource}`, { ...options, signal: AbortSignal.timeout(Math.max(1, Math.min(60000, remaining()))) });
        text = await response.text();
      } catch {
        remaining();
        if (attempt + 1 === attempts) throw new Error(method === "POST" ? "Refresh request outcome is unknown; inspect the canonical job before retrying" : "Canonical GET failed after bounded retries");
        await wait(1000 * 2 ** attempt);
        continue;
      }
      remaining();
      if (!accepted.includes(response.status)) {
        if (method === "GET" && [408, 429, 500, 502, 503, 504].includes(response.status) && attempt + 1 < attempts) {
          await wait(Math.max(1000 * 2 ** attempt, retryAfterMs(response, now())));
          continue;
        }
        throw new Error(`Canonical ${method} returned HTTP ${response.status}`);
      }
      let body;
      try { body = JSON.parse(text); } catch { throw new Error(`Canonical ${method} returned non-JSON`); }
      return { response, body };
    }
  }
}

async function report(result) {
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Canonical Sites refresh\n\nDaily target: 09:00 Asia/Bangkok. Timestamps below are UTC.\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`);
  }
}

function retryAfterMs(response, now) {
  const value = response.headers.get("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

function validateDashboard(dashboard) {
  if (dashboard?.appId !== "aum-dashboard" || !dashboard.dataVersion || !dashboard.model?.id) throw new Error("Invalid canonical dashboard after refresh");
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await runSitesRefresh(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
