import type { Env, RefreshJobRow } from "./types.ts";

export function nowIso() {
  return new Date().toISOString();
}

export async function getMetadata(env: Env, key: string) {
  const row = await env.DB.prepare("SELECT value FROM metadata WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMetadata(env: Env, key: string, value: string) {
  const now = nowIso();
  await env.DB.prepare(
    "INSERT INTO metadata (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at"
  ).bind(key, value, now).run();
}

export async function latestRefreshJob(env: Env) {
  return env.DB.prepare("SELECT * FROM refresh_jobs ORDER BY requested_at DESC LIMIT 1").first<RefreshJobRow>();
}

export async function currentRefreshJob(env: Env) {
  const jobId = await getMetadata(env, "refresh_lock");
  if (!jobId) return null;
  const job = await env.DB.prepare("SELECT * FROM refresh_jobs WHERE id = ?").bind(jobId).first<RefreshJobRow>();
  if (!job || ["complete", "failed"].includes(job.status)) {
    await env.DB.prepare("DELETE FROM metadata WHERE key = 'refresh_lock'").run();
    return null;
  }
  return job;
}

export async function updateSourceStatus(env: Env, input: {
  id: string;
  name: string;
  status: "ok" | "incomplete" | "failed";
  url: string;
  message?: string | null;
}) {
  const now = nowIso();
  await env.DB.prepare(`
    INSERT INTO source_status (source_id, source_name, status, checked_at, last_success_at, message, url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      source_name=excluded.source_name,
      status=excluded.status,
      checked_at=excluded.checked_at,
      last_success_at=CASE WHEN excluded.status='ok' THEN excluded.checked_at ELSE source_status.last_success_at END,
      message=excluded.message,
      url=excluded.url
  `).bind(input.id, input.name, input.status, now, input.status === "ok" ? now : null, input.message || null, input.url).run();
}

export async function audit(env: Env, entityType: string, entityId: string, action: string, before: unknown, after: unknown, actor = "system") {
  await env.DB.prepare(`
    INSERT INTO audit_log (occurred_at, entity_type, entity_id, action, before_json, after_json, actor)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(nowIso(), entityType, entityId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, actor).run();
}

export function randomId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}
