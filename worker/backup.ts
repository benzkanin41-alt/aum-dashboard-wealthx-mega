import { getMetadata, nowIso, setMetadata } from "./db.ts";
import type { Env, RefreshJobRow } from "./types.ts";

const UPGRADE = "2026-09-17-interval-v1";
const TABLES = ["funds", "aum_points", "aua_sources", "aua_observations", "aua_observation_sources", "model_versions", "projections", "dashboard_snapshots", "source_status", "audit_log", "metadata", "refresh_jobs"];

export async function advanceUpgradeBackup(env: Env, job: RefreshJobRow) {
  if (await getMetadata(env, "upgrade_backup_version") === UPGRADE) return true;
  const state = JSON.parse(job.result_json || "{}");
  const backup = state.backup || { table: 0, offset: 0, files: [], prefix: `backups/${UPGRADE}/${job.id}` };
  const table = TABLES[backup.table];
  if (!table) {
    await env.FILES.put(`${backup.prefix}/manifest.json`, JSON.stringify({ ...backup, completedAt: nowIso() }), { httpMetadata: { contentType: "application/json" } });
    await setMetadata(env, "upgrade_backup_prefix", backup.prefix);
    await setMetadata(env, "upgrade_backup_version", UPGRADE);
    return true;
  }
  const size = table === "dashboard_snapshots" ? 10 : 1000;
  const rows = await env.DB.prepare(`SELECT * FROM ${table} LIMIT ? OFFSET ?`).bind(size, backup.offset).all();
  const key = `${backup.prefix}/${table}-${backup.offset}.json`;
  const bytes = new TextEncoder().encode(JSON.stringify(rows.results));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(b=>b.toString(16).padStart(2,"0")).join("");
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: "application/json" } });
  backup.files.push({ key, rows: rows.results.length, sha256: hash });
  if (rows.results.length < size) { backup.table++; backup.offset = 0; } else backup.offset += size;
  state.backup = backup;
  await env.DB.prepare("UPDATE refresh_jobs SET cursor=cursor+1,total=?,result_json=?,updated_at=? WHERE id=?")
    .bind(job.cursor + 2 + TABLES.length - backup.table, JSON.stringify(state), nowIso(), job.id).run();
  return false;
}
