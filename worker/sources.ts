import { extractText } from "unpdf";
import { parseTalisNavRows } from "../server-lib/talis-public.js";
import { audit, nowIso, updateSourceStatus } from "./db.ts";
import type { Env, FundRow } from "./types.ts";

export const SET_NEWS_URL = "https://www.set.or.th/th/market/product/stock/quote/LTMH/news";
export const LTMH_IR_URL = "https://www.ltmh.com/en/investor";
const TALIS_NAV_URL = "https://nav.talisam.co.th/index_NAV_Sum.jsp?p_lang=EN";
const SETTRADE_URL = "https://www.settrade.com/th/mutualfund/quote";

export async function refreshTalis(env: Env) {
  const response = await fetch(TALIS_NAV_URL, { headers: sourceHeaders(), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Talis NAV ${response.status}`);
  const rows = parseTalisNavRows(await response.text());
  const fundRows = await env.DB.prepare("SELECT * FROM funds WHERE data_source = 'talis' AND active = 1").all<FundRow>();
  const configured = new Map(fundRows.results.map((fund) => [fund.code, fund]));
  const dates = [...new Set(rows.filter(row => configured.has(row.code)).map(row => row.navDate))];
  const previous = dates.length ? await env.DB.prepare(`SELECT * FROM aum_points WHERE as_of_date IN (${dates.map(() => "?").join(",")})`).bind(...dates).all<any>() : { results: [] };
  const previousByKey = new Map(previous.results.map(row => [`${row.fund_id}:${row.as_of_date}`, row]));
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  for (const row of rows) {
    const fund = configured.get(row.code);
    if (!fund || (fund.inception_date && row.navDate < fund.inception_date)) continue;
    const before = previousByKey.get(`${fund.id}:${row.navDate}`);
    if (before && (before.aum_million_baht !== row.aumMillionBaht || before.nav_per_unit !== row.nav)) await audit(env, "aum_point", `${fund.id}:${row.navDate}`, "revise", before, row);
    statements.push(upsertAumStatement(env, fund, row.navDate, row.aumMillionBaht, row.nav, row.source, now));
  }
  if (statements.length) await env.DB.batch(statements);
  await updateSourceStatus(env, { id: "talis", name: "Talis Asset Management NAV", status: "ok", url: TALIS_NAV_URL, message: `${statements.length} กอง` });
  return { source: "talis", imported: statements.length, available: rows.length };
}

export async function refreshSettradeFund(env: Env, fund: FundRow) {
  const result = await fetchSettradeFundLatest(fund.code);
  const now = nowIso();
  let imported = 0;
  if (result.latest && !isSeedPlaceholder(result.latest) && (!fund.inception_date || result.latest.navDate >= fund.inception_date)) {
    const before = await env.DB.prepare("SELECT aum_million_baht FROM aum_points WHERE fund_id=? AND as_of_date=?")
      .bind(fund.id, result.latest.navDate).first<{ aum_million_baht: number }>();
    await upsertAumStatement(env, fund, result.latest.navDate, result.latest.aumMillionBaht, result.latest.nav, result.latest.source, now).run();
    imported = 1;
    if (before && before.aum_million_baht !== result.latest.aumMillionBaht) {
      await audit(env, "aum_point", `${fund.id}:${result.latest.navDate}`, "revise", before, result.latest);
    }
  }
  await updateSourceStatus(env, {
    id: `settrade:${fund.code}`,
    name: `Settrade ${fund.code}`,
    status: imported ? "ok" : "incomplete",
    url: result.url,
    message: imported ? result.latest?.navDate : `รอ NAV ตั้งแต่วันเริ่มกอง ${fund.inception_date || "ที่ตรวจสอบได้"}; ไม่รวมข้อมูลก่อนเริ่มกอง`
  });
  return { source: "settrade", code: fund.code, imported, date: result.latest?.navDate || null };
}

export async function fetchSettradeFundLatest(symbol: string) {
  const url = `${SETTRADE_URL}/${encodeURIComponent(symbol)}/overview`;
  const response = await fetch(url, { headers: sourceHeaders(), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Settrade ${symbol} ${response.status}`);
  const rows = parseSettradeNuxtRows(await response.text(), symbol, url).filter((row) => !isSeedPlaceholder(row));
  rows.sort((a, b) => a.navDate.localeCompare(b.navDate));
  return { url, latest: rows.at(-1) || null, rows };
}

export function parseSettradeNuxtRows(html: string, symbol: string, source: string) {
  const script = html.match(/<script>window\.__NUXT__=([\s\S]*?)<\/script>/)?.[1]?.trim().replace(/;$/, "");
  if (!script) throw new Error("Settrade Nuxt state not found");
  const parameterList = script.match(/^\(function\(([^)]*)\)\{/)?.[1];
  const argumentList = script.match(/\}\(([\s\S]*)\)\)$/)?.[1];
  const marker = "quotationChart:{quotations:";
  const markerIndex = script.indexOf(marker);
  const arrayStart = markerIndex < 0 ? -1 : script.indexOf("[", markerIndex + marker.length);
  const quotations = arrayStart < 0 ? null : extractBalanced(script, arrayStart, "[", "]");
  if (!parameterList || argumentList === undefined || !quotations) throw new Error("Settrade quotation state format changed");
  const names = splitTopLevel(parameterList).map((value) => value.trim());
  const values = splitTopLevel(argumentList).map(parsePrimitive);
  const aliases = new Map(names.map((name, index) => [name, values[index]]));
  const rows = [];
  for (const match of quotations.matchAll(/\{([^{}]*)\}/g)) {
    const body = match[1];
    const date = resolveJsValue(fieldValue(body, "date"), aliases);
    const nav = numberFrom(resolveJsValue(fieldValue(body, "navPerUnit"), aliases));
    const netAsset = numberFrom(resolveJsValue(fieldValue(body, "nav"), aliases));
    const navDate = toDateOnly(date);
    if (!navDate || nav === null || netAsset === null) continue;
    rows.push({ code: symbol, navDate, nav, netAsset, aumMillionBaht: round2(netAsset / 1_000_000), source });
  }
  return rows;
}

function extractBalanced(value: string, start: number, open: string, close: string) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return null;
}

export function extractIrPdfUrls(html: string) {
  const normalized = html.replaceAll("\\u0026", "&").replaceAll("\\/", "/");
  const urls = [...normalized.matchAll(/https?:[^"'<>\s]+?\.pdf(?:\?[^"'<>\s]*)?/gi)].map((match) => match[0]);
  return [...new Set(urls.map((url) => decodeURIComponentSafe(url)))];
}

export function extractAuaActuals(text: string) {
  const normalized = text.replace(/\s+/g, " ");
  const results: Array<{ referenceDate: string; amountMillionBaht: number; evidence: string; confidence: "exact" }> = [];
  const patterns = [
    { regex: /(?:as of|on|at)\s+([A-Za-z]+\s+\d{1,2},\s*20\d{2}|\d{1,2}\s+[A-Za-z]+\s+20\d{2})[^.]{0,260}?(?:Assets Under (?:Administration|Advice)\s*\(AUA\)|AUA)[^.]{0,140}?(?:amounted to|reached|stood at|was|of)?\s*(?:Baht|THB)?\s*([\d,]+(?:\.\d+)?)\s*(million|mn|billion|bn)(?:\s+Baht)?/gi, dateGroup: 1, amountGroup: 2, unitGroup: 3 },
    { regex: /([A-Za-z]+\s+\d{1,2},\s*20\d{2}|\d{1,2}\s+[A-Za-z]+\s+20\d{2})\s*:\s*AUA\s+(?:of\s+)?(?:Baht|THB)?\s*([\d,]+(?:\.\d+)?)\s*(million|mn|billion|bn)(?:\s+Baht)?/gi, dateGroup: 1, amountGroup: 2, unitGroup: 3 },
    { regex: /AUA(?:\s+of\s+WealthX)?[^.]{0,180}?(?:reached|stood at|was|amounted to)[^.]{0,100}?(?:Baht|THB)?\s*([\d,]+(?:\.\d+)?)\s*(million|mn|billion|bn)[^.]{0,180}?(?:on|as of|at)\s+([A-Za-z]+\s+\d{1,2},\s*20\d{2}|\d{1,2}\s+[A-Za-z]+\s+20\d{2})/gi, dateGroup: 3, amountGroup: 1, unitGroup: 2 }
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern.regex)) {
      const rawDate = match[pattern.dateGroup];
      const rawAmount = match[pattern.amountGroup];
      const referenceDate = parseEnglishDate(rawDate);
      if (!referenceDate) continue;
      const scale = /billion|bn/i.test(match[pattern.unitGroup]) ? 1000 : 1;
      const amountMillionBaht = Number(rawAmount.replaceAll(",", "")) * scale;
      const start = Math.max(0, (match.index || 0) - 120);
      const context = normalized.slice(start, (match.index || 0) + match[0].length + 40);
      if (!Number.isFinite(amountMillionBaht) || /(target|aim|expect|forecast|project)/i.test(context)) continue;
      results.push({ referenceDate, amountMillionBaht, evidence: context.slice(0, 500), confidence: "exact" });
    }
  }
  const unique = new Map(results.map((item) => [`${item.referenceDate}:${item.amountMillionBaht}`, item]));
  return [...unique.values()].sort((a, b) => a.referenceDate.localeCompare(b.referenceDate));
}

export async function inspectOfficialPdf(env: Env, url: string, context: { publisher?: string; announcedAt?: string | null; title?: string } = {}) {
  const known = await env.DB.prepare("SELECT id, document_hash, announced_at, notes, verification_status FROM aua_sources WHERE url = ?").bind(url).first<{ id: string; document_hash: string | null; announced_at: string | null; notes: string | null; verification_status: string }>();
  const sourceId = known?.id || `doc-${(await sha256Text(url)).slice(0, 20)}`;
  const response = await fetch(url, { headers: sourceHeaders(), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Official PDF ${response.status}`);
  if (Number(response.headers.get("content-length") || 0) > 25000000) throw new Error("เอกสารเกินขนาดที่ประมวลผลได้: รอตรวจสอบ");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 25000000 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("เอกสารไม่ใช่ PDF ที่ใช้ได้หรือใหญ่เกินขอบเขต");
  const documentHash = await sha256Bytes(bytes);
  if (known?.document_hash === documentHash && known.notes?.includes("parser-v3") && (!context.announcedAt || known.announced_at === context.announcedAt)) {
    await env.DB.prepare("UPDATE aua_sources SET last_checked_at=? WHERE id=?").bind(nowIso(), known.id).run();
    return { inserted: 0, pending: known.verification_status === "pending_review" ? 1 : 0, duplicate: true };
  }
  const r2Key = `official-aua/${documentHash}.pdf`;
  await env.FILES.put(r2Key, bytes, { httpMetadata: { contentType: "application/pdf" }, customMetadata: { sourceUrl: url } });
  const extracted = await extractText(bytes, { mergePages: true });
  const text = Array.isArray(extracted.text) ? extracted.text.join(" ") : String(extracted.text || "");
  const actuals = extractAuaActuals(text);
  const announcedAt = context.announcedAt || extractDocumentDate(text);
  const hasAua = /\bAUA\b|assets under (?:advice|administration)/i.test(text);
  const pendingDocument = hasAua && (!actuals.length || !announcedAt);
  const now = nowIso();
  const title = context.title || titleFromUrl(url);
  await env.DB.prepare(`
    INSERT INTO aua_sources (id, publisher, source_kind, title, url, announced_at, discovered_at, verification_status,
      completeness_status, document_hash, r2_key, notes, last_checked_at)
    VALUES (?, ?, 'company_document', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET document_hash=excluded.document_hash, r2_key=excluded.r2_key,
      verification_status=excluded.verification_status, completeness_status=excluded.completeness_status,
      announced_at=COALESCE(excluded.announced_at,aua_sources.announced_at), notes=excluded.notes, last_checked_at=excluded.last_checked_at
  `).bind(sourceId, context.publisher || "LTMH", title, url, announcedAt, now, pendingDocument ? "pending_review" : "verified", pendingDocument ? "incomplete" : "complete",
    documentHash, r2Key, `parser-v3; ${actuals.length} exact actual(s); ${pendingDocument ? "AUA/date requires manual verification" : hasAua ? "AUA checked" : "No AUA in document"}`, now).run();
  if (known?.document_hash && known.document_hash !== documentHash) await audit(env, "aua_source", sourceId, "document_revision", known, { documentHash, r2Key, announcedAt });

  let inserted = 0;
  let pending = pendingDocument ? 1 : 0;
  for (const actual of actuals) {
    const existingSameDate = await env.DB.prepare("SELECT id, amount_million_baht FROM aua_observations WHERE reference_date=? AND status='verified' ORDER BY revision DESC LIMIT 1")
      .bind(actual.referenceDate).first<{ id: string; amount_million_baht: number }>();
    const key = `${actual.referenceDate}:${actual.amountMillionBaht}`;
    let observationId = `aua-${actual.referenceDate}-${actual.amountMillionBaht}`;
    let status = announcedAt && actual.referenceDate <= announcedAt ? "verified" : "pending_review";
    if (existingSameDate && existingSameDate.amount_million_baht !== actual.amountMillionBaht) {
      status = "pending_review";
      pending += 1;
    }
    const before = await env.DB.prepare("SELECT id FROM aua_observations WHERE observation_key=? ORDER BY CASE WHEN status='verified' THEN 0 ELSE 1 END, revision DESC LIMIT 1").bind(key).first();
    if (status === "pending_review") observationId = `${observationId}-pending-${documentHash.slice(0, 8)}`;
    if (!before) {
      await env.DB.prepare(`
        INSERT INTO aua_observations (id, reference_date, amount_million_baht, announced_at, discovered_at, status, label,
          observation_key, revision, supersedes_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)
      `).bind(observationId, actual.referenceDate, actual.amountMillionBaht, announcedAt, now, status, `AUA ${actual.amountMillionBaht.toLocaleString("en-US")} ล้านบาท`, key, now, now).run();
      if (status === "verified") inserted += 1;
      await audit(env, "aua_observation", observationId, status === "verified" ? "discover" : "flag_conflict", null, actual);
    } else {
      observationId = (before as { id: string }).id;
    }
    await env.DB.prepare("INSERT OR IGNORE INTO aua_observation_sources (observation_id, source_id, evidence_text) VALUES (?, ?, ?)")
      .bind(observationId, sourceId, actual.evidence).run();
  }
  return { inserted, pending, duplicate: false };
}

export function extractDocumentDate(text: string) {
  const heading = text.slice(0, 1800).split(/Subject\s*:/i)[0];
  const dates = [...heading.matchAll(/(?:^|\n)\s*([A-Za-z]+\s+\d{1,2},\s*20\d{2}|\d{1,2}\s+[A-Za-z]+\s+20\d{2})\s*(?:\n|$)/g)].map(m => parseEnglishDate(m[1])).filter(Boolean);
  return dates.length === 1 ? dates[0] : null;
}

function upsertAumStatement(env: Env, fund: FundRow, date: string, aum: number, nav: number | null, source: string, now: string) {
  return env.DB.prepare(`
    INSERT INTO aum_points (fund_id, as_of_date, aum_million_baht, nav_per_unit, source_url, source_observed_at, content_hash, inserted_at, revised_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL)
    ON CONFLICT(fund_id, as_of_date) DO UPDATE SET aum_million_baht=excluded.aum_million_baht,
      nav_per_unit=excluded.nav_per_unit, source_url=excluded.source_url, source_observed_at=excluded.source_observed_at,
      revised_at=CASE WHEN aum_points.aum_million_baht <> excluded.aum_million_baht THEN excluded.inserted_at ELSE aum_points.revised_at END
  `).bind(fund.id, date, aum, nav, source, now, now);
}

function splitTopLevel(value: string) {
  const parts = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  let depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if ("([{".includes(char)) depth += 1;
    else if (")] }".replace(" ", "").includes(char)) depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function parsePrimitive(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try { return JSON.parse(trimmed.startsWith("'") ? `"${trimmed.slice(1, -1).replaceAll('"', '\\"')}"` : trimmed); } catch { return trimmed.slice(1, -1); }
  }
  return trimmed;
}

function fieldValue(body: string, name: string) {
  return body.match(new RegExp(`(?:^|,)${name}:([^,}]+)`))?.[1]?.trim() || null;
}

function resolveJsValue(value: string | null, aliases: Map<string, unknown>) {
  if (value === null) return null;
  return aliases.has(value) ? aliases.get(value) : parsePrimitive(value);
}

function isSeedPlaceholder(row: { netAsset: number; nav: number }) {
  return row.nav === 10 && row.netAsset >= 1_000_000_000 && row.netAsset % 1_000_000_000 === 0;
}

function sourceHeaders() {
  return { accept: "text/html,application/xhtml+xml,application/pdf", "user-agent": "LTMH-WealthX-AUM-AUA-Dashboard/2.0" };
}

function numberFrom(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateOnly(value: unknown) {
  const match = String(value || "").match(/^(20\d{2}-\d{2}-\d{2})/);
  return match?.[1] || null;
}

function parseEnglishDate(value: string) {
  const parsed = Date.parse(`${value} UTC`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function titleFromUrl(url: string) {
  return decodeURIComponentSafe(url.split("/").at(-1) || "LTMH official document").replace(/[_-]+/g, " ").replace(/\.pdf.*$/i, "").slice(0, 240);
}

function decodeURIComponentSafe(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

async function sha256Bytes(bytes: Uint8Array) {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Text(value: string) {
  return sha256Bytes(new TextEncoder().encode(value));
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
