import { audit, currentRefreshJob, getMetadata, latestRefreshJob, nowIso, randomId, setMetadata, updateSourceStatus } from "./db.ts";
import { rebuildModelAndSnapshot } from "./snapshot.ts";
import { refreshSettradeFund, refreshTalis } from "./sources.ts";
import { advanceOfficialScan, newOfficialScan } from "./official.ts";
import type { Env, FundRow, RefreshJobRow } from "./types.ts";
import { syncFundCatalog } from "./catalog.ts";
import { advanceUpgradeBackup } from "./backup.ts";

const MIN_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const STALE_STEP_MS = 2 * 60 * 1000;

export async function startOrReuseRefresh(env: Env, requestedBy: string) {
  const active = await currentRefreshJob(env);
  if (active) return { job: active, reused: true, rateLimited: false };
  const latest = await latestRefreshJob(env);
  if (latest && Date.now() - Date.parse(latest.requested_at) < MIN_REFRESH_INTERVAL_MS) {
    return {
      job: latest,
      reused: true,
      rateLimited: true,
      retryAfterSeconds: Math.ceil((MIN_REFRESH_INTERVAL_MS - (Date.now() - Date.parse(latest.requested_at))) / 1000)
    };
  }
  const now = nowIso();
  const jobId = randomId("refresh");
  await env.DB.prepare(`
    INSERT INTO refresh_jobs (id, requested_at, started_at, completed_at, updated_at, status, stage, cursor, total, requested_by, error, result_json)
    VALUES (?, ?, ?, NULL, ?, 'running', 'backup', 0, 0, ?, NULL, '{}')
  `).bind(jobId, now, now, now, requestedBy).run();
  const lock = await env.DB.prepare("INSERT OR IGNORE INTO metadata (key, value, updated_at) VALUES ('refresh_lock', ?, ?)")
    .bind(jobId, now).run();
  if ((lock.meta.changes || 0) === 0) {
    const activeId = await getMetadata(env, "refresh_lock");
    await env.DB.prepare("DELETE FROM refresh_jobs WHERE id=?").bind(jobId).run();
    const existing = activeId ? await env.DB.prepare("SELECT * FROM refresh_jobs WHERE id=?").bind(activeId).first<RefreshJobRow>() : null;
    if (existing) return { job: existing, reused: true, rateLimited: false };
    if (activeId) await env.DB.prepare("DELETE FROM metadata WHERE key='refresh_lock' AND value=?").bind(activeId).run();
    return startOrReuseRefresh(env, requestedBy);
  }
  await audit(env, "refresh_job", jobId, "create", null, { requestedBy }, requestedBy);
  const job = await env.DB.prepare("SELECT * FROM refresh_jobs WHERE id=?").bind(jobId).first<RefreshJobRow>();
  return { job, reused: false, rateLimited: false };
}

export async function advanceRefresh(env: Env, jobId?: string | null) {
  const job = jobId
    ? await env.DB.prepare("SELECT * FROM refresh_jobs WHERE id=?").bind(jobId).first<RefreshJobRow>()
    : await currentRefreshJob(env);
  if (!job) return null;
  if (["complete", "failed"].includes(job.status)) return job;

  const lockOwner = await getMetadata(env, "refresh_lock");
  if (lockOwner !== job.id) return job;
  const stepKey = `refresh_step:${job.id}:${job.stage}:${job.cursor}`;
  if (!(await acquireStep(env, stepKey))) return readJob(env, job.id);

  try {
    if (job.stage === "backup") {
      if (await advanceUpgradeBackup(env, job)) await env.DB.prepare("UPDATE refresh_jobs SET stage='aum',cursor=0,total=0,updated_at=? WHERE id=?").bind(nowIso(),job.id).run();
    }
    else if (job.stage === "aum") await advanceAum(env, job);
    else if (job.stage === "aua") await advanceAua(env, job);
    else if (job.stage === "model") await finishModel(env, job);
    else throw new Error(`Unknown refresh stage: ${job.stage}`);
  } catch (error) {
    const message = errorMessage(error);
    await env.DB.prepare("UPDATE refresh_jobs SET status='failed', error=?, updated_at=?, completed_at=? WHERE id=?")
      .bind(message, nowIso(), nowIso(), job.id).run();
    await env.DB.prepare("DELETE FROM metadata WHERE key='refresh_lock' AND value=?").bind(job.id).run();
    await env.DB.prepare("DELETE FROM metadata WHERE key=?").bind(stepKey).run();
    await audit(env, "refresh_job", job.id, "fail", job, { error: message });
  }
  return readJob(env, job.id);
}

export async function refreshStatus(env: Env, jobId?: string | null) {
  const job = jobId ? await readJob(env, jobId) : (await currentRefreshJob(env)) || (await latestRefreshJob(env));
  if (!job) return null;
  return presentJob(job);
}

export function presentJob(job: RefreshJobRow) {
  const stageProgress = job.total > 0 ? job.cursor / job.total : 0;
  const weights: Record<string, number> = { backup: 0, aum: 0.1, aua: 0.5, model: 0.9, complete: 1 };
  const spans: Record<string, number> = { backup: 0.1, aum: 0.4, aua: 0.4, model: 0.1, complete: 0 };
  const base = weights[job.stage] ?? 0;
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    stageLabel: stageLabel(job.stage),
    cursor: job.cursor,
    total: job.total,
    progress: job.status === "complete" ? 1 : Math.min(0.99, base + (spans[job.stage] || 0) * stageProgress),
    requestedAt: job.requested_at,
    startedAt: job.started_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at,
    requestedBy: job.requested_by,
    error: job.error,
    result: parseJson(job.result_json)
  };
}

async function advanceAum(env: Env, job: RefreshJobRow) {
  if (job.cursor === 0) await syncFundCatalog(env);
  const settrade = await env.DB.prepare("SELECT * FROM funds WHERE active=1 AND data_source='settrade' ORDER BY code").all<FundRow>();
  const total = 1 + settrade.results.length;
  if (job.total !== total) {
    await env.DB.prepare("UPDATE refresh_jobs SET total=?, updated_at=? WHERE id=?").bind(total, nowIso(), job.id).run();
  }
  const results = parseJson(job.result_json) as Record<string, unknown>;
  if (job.cursor === 0) {
    try {
      results.talis = await refreshTalis(env);
    } catch (error) {
      const message = errorMessage(error);
      results.talis = { error: message };
      await updateSourceStatus(env, { id: "talis", name: "Talis Asset Management NAV", status: "failed", url: "https://nav.talisam.co.th/index_NAV_Sum.jsp?p_lang=EN", message });
    }
  } else {
    const fund = settrade.results[job.cursor - 1];
    if (fund) {
      try {
        results[fund.code] = await refreshSettradeFund(env, fund);
      } catch (error) {
        const message = errorMessage(error);
        results[fund.code] = { error: message };
        await updateSourceStatus(env, { id: `settrade:${fund.code}`, name: `Settrade ${fund.code}`, status: "failed", url: `https://www.settrade.com/th/mutualfund/quote/${encodeURIComponent(fund.code)}/overview`, message });
      }
    }
  }
  const nextCursor = job.cursor + 1;
  const nextStage = nextCursor >= total ? "aua" : "aum";
  await env.DB.prepare("UPDATE refresh_jobs SET cursor=?, total=?, stage=?, result_json=?, updated_at=? WHERE id=?")
    .bind(nextStage === "aua" ? 0 : nextCursor, nextStage === "aua" ? 2 : total, nextStage, JSON.stringify(results), nowIso(), job.id).run();
}

async function advanceAua(env: Env, job: RefreshJobRow) {
  const results = parseJson(job.result_json);
  const scan = results.auaScan || newOfficialScan();
  const done = await advanceOfficialScan(env, scan);
  results.auaScan = scan;
  await env.DB.prepare("UPDATE refresh_jobs SET cursor=?, total=?, stage=?, result_json=?, updated_at=? WHERE id=?")
    .bind(done ? 0 : job.cursor + 1, done ? 1 : job.cursor + 2 + scan.queue.length, done ? "model" : "aua", JSON.stringify(results), nowIso(), job.id).run();
}

async function finishModel(env: Env, job: RefreshJobRow) {
  const payload = await rebuildModelAndSnapshot(env, `refresh:${job.id}`);
  const now = nowIso();
  const results = parseJson(job.result_json) as Record<string, unknown>;
  results.dataVersion = payload.dataVersion;
  results.modelVersion = payload.model.id;
  results.projection = payload.projection.value;
  await env.DB.prepare("UPDATE refresh_jobs SET cursor=1, total=1, stage='complete', status='complete', result_json=?, updated_at=?, completed_at=? WHERE id=?")
    .bind(JSON.stringify(results), now, now, job.id).run();
  await env.DB.prepare("DELETE FROM metadata WHERE key='refresh_lock' AND value=?").bind(job.id).run();
  await audit(env, "refresh_job", job.id, "complete", job, results);
  // D1 limits LIKE pattern length; a lexicographic prefix range is equivalent.
  await env.DB.prepare("DELETE FROM metadata WHERE key >= ? AND key < ?")
    .bind(`refresh_step:${job.id}:`, `refresh_step:${job.id};`).run();
}

async function acquireStep(env: Env, key: string) {
  const now = nowIso();
  const inserted = await env.DB.prepare("INSERT OR IGNORE INTO metadata (key, value, updated_at) VALUES (?, 'running', ?)").bind(key, now).run();
  if ((inserted.meta.changes || 0) > 0) return true;
  const existing = await env.DB.prepare("SELECT updated_at FROM metadata WHERE key=?").bind(key).first<{ updated_at: string }>();
  if (existing && Date.now() - Date.parse(existing.updated_at) > STALE_STEP_MS) {
    const reclaimed = await env.DB.prepare("UPDATE metadata SET updated_at=? WHERE key=? AND updated_at=?").bind(now, key, existing.updated_at).run();
    return (reclaimed.meta.changes || 0) > 0;
  }
  return false;
}

async function readJob(env: Env, id: string) {
  return env.DB.prepare("SELECT * FROM refresh_jobs WHERE id=?").bind(id).first<RefreshJobRow>();
}

function stageLabel(stage: string) {
  if (stage === "backup") return "กำลังเก็บสำเนาก่อนอัปเกรด";
  if (stage === "aum") return "กำลังตรวจ AUM รายกอง";
  if (stage === "aua") return "กำลังตรวจ AUA ทางการ";
  if (stage === "model") return "กำลังคำนวณโมเดลและ snapshot";
  return "เสร็จสมบูรณ์";
}

function parseJson(value: string | null) {
  try { return value ? JSON.parse(value) : {}; } catch { return {}; }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
