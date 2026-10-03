import { parseTalisHistoryRows } from "../server-lib/talis-public.js";
import { getMetadata, nowIso, updateSourceStatus } from "./db.ts";
import type { Env, FundRow } from "./types.ts";

const REPAIRS = [{
  id: "tlchinastar50-inception-20260924-v1",
  code: "TLCHINASTAR50-X",
  talisFundCode: "40081",
  inceptionDate: "2026-09-24",
  through: "2026-09-29",
  publishedDates: ["2026-09-24", "2026-09-28", "2026-09-29"]
}];

export async function backfillTalisHistory(env: Env, latestRows: Array<{ code: string; talisFundCode: string | null }>) {
  const results = [];
  for (const repair of REPAIRS) {
    const key = `talis_history_backfill:${repair.id}`;
    if (await getMetadata(env, key)) {
      results.push({ id: repair.id, code: repair.code, imported: 0, reused: true });
      continue;
    }
    const fund = await env.DB.prepare("SELECT * FROM funds WHERE code=? AND active=1 AND data_source='talis'").bind(repair.code).first<FundRow>();
    if (!fund) continue;
    const url = `https://nav.talisam.co.th/index_NAV_Sum_Table.jsp?p_fund_code=${repair.talisFundCode}&p_lang=EN&year1=year1`;
    try {
      if (fund.inception_date !== repair.inceptionDate || latestRows.find(row => row.code === fund.code)?.talisFundCode !== repair.talisFundCode) {
        throw new Error("Talis history identity or inception date requires verification");
      }
      const response = await fetch(url, {
        headers: { accept: "text/html", "user-agent": "LTMH-WealthX-AUM-AUA-Dashboard/2.0" },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error(`Talis history ${response.status}`);
      const html = await response.text();
      const rows = parseTalisHistoryRows(html, url).filter(row => row.navDate >= repair.inceptionDate && row.navDate <= repair.through);
      // A truncated/changed response must not seal a partially applied repair.
      if (rows.length !== repair.publishedDates.length || repair.publishedDates.some(date => !rows.some(row => row.navDate === date)) ||
        rows.some(row => !Number.isFinite(row.nav) || row.nav <= 0 || !Number.isFinite(row.netAsset) || row.netAsset < 0)) {
        throw new Error("Talis history coverage requires verification; no points inserted");
      }
      const now = nowIso();
      const sourceHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html))))
        .map(byte => byte.toString(16).padStart(2, "0")).join("");
      const before = await env.DB.prepare("SELECT * FROM aum_points WHERE fund_id=? ORDER BY as_of_date").bind(fund.id).all();
      if (rows.some(row => before.results.some(point => point.as_of_date === row.navDate &&
        (point.aum_million_baht !== row.aumMillionBaht || point.nav_per_unit !== row.nav)))) {
        throw new Error("Existing Talis history conflicts with source; manual verification required");
      }
      const prefix = `backups/talis-history/${repair.id}/${sourceHash}`;
      await env.FILES.put(`${prefix}/before.json`, JSON.stringify({ code: fund.code, observedAt: now, points: before.results }), { httpMetadata: { contentType: "application/json" } });
      await env.FILES.put(`${prefix}/source.html`, html, { httpMetadata: { contentType: "text/html" }, customMetadata: { sourceUrl: url, sha256: sourceHash } });
      const statements: D1PreparedStatement[] = [];
      for (const row of rows) {
        const entityId = `${fund.id}:${row.navDate}`;
        // Audit and insert use the same atomic batch, without revising an existing row.
        statements.push(env.DB.prepare(`
          INSERT INTO audit_log (occurred_at,entity_type,entity_id,action,before_json,after_json,actor)
          SELECT ?,'aum_point',?,'history_backfill',NULL,?,'system'
          WHERE NOT EXISTS (SELECT 1 FROM aum_points WHERE fund_id=? AND as_of_date=?)
        `).bind(now, entityId, JSON.stringify({ ...row, repairId: repair.id, sourceHash }), fund.id, row.navDate));
        statements.push(env.DB.prepare(`
          INSERT INTO aum_points (fund_id,as_of_date,aum_million_baht,nav_per_unit,source_url,source_observed_at,content_hash,inserted_at,revised_at)
          VALUES (?,?,?,?,?,?,?,?,NULL) ON CONFLICT(fund_id,as_of_date) DO NOTHING
        `).bind(fund.id, row.navDate, row.aumMillionBaht, row.nav, url, now, sourceHash, now));
      }
      statements.push(env.DB.prepare("INSERT INTO metadata (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO NOTHING")
        .bind(key, JSON.stringify({ code: fund.code, publishedDates: repair.publishedDates, sourceUrl: url, sourceHash, backupPrefix: prefix, completedAt: now }), now));
      const applied = await env.DB.batch(statements);
      const imported = applied.slice(0, -1).reduce((sum, result, index) => sum + (index % 2 === 1 ? result.meta.changes || 0 : 0), 0);
      await updateSourceStatus(env, { id: `talis-history:${fund.code}`, name: `Talis history ${fund.code}`, status: "ok", url, message: `${repair.inceptionDate} - ${repair.through}; ${imported} missing published point(s) added` });
      results.push({ id: repair.id, code: fund.code, imported, sourceHash, backupPrefix: prefix });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateSourceStatus(env, { id: `talis-history:${fund.code}`, name: `Talis history ${fund.code}`, status: "incomplete", url, message });
      results.push({ id: repair.id, code: fund.code, imported: 0, error: message });
    }
  }
  return results;
}
