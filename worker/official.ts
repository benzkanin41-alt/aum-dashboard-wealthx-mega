import { extractIrPdfUrls, inspectOfficialPdf, LTMH_IR_URL, SET_NEWS_URL } from "./sources.ts";
import { nowIso, updateSourceStatus } from "./db.ts";
import type { Env } from "./types.ts";

export type DocumentTask = { url: string; publisher: string; announcedAt: string | null; title?: string; kind: "pdf" | "news" };
export type OfficialScan = { queue: DocumentTask[]; seen: string[]; setPage: number; setDone: boolean; irDone: boolean; setError?: string; irError?: string; failures: number; checked: number; inserted: number; pending: number };
export const newOfficialScan = (): OfficialScan => ({ queue: [], seen: [], setPage: 0, setDone: false, irDone: false, failures: 0, checked: 0, inserted: 0, pending: 0 });
const headers = { accept: "application/json,text/html,application/pdf", "x-channel": "WEB_SET", referer: SET_NEWS_URL, "user-agent": "LTMH-WealthX-Dashboard/3.0" };

export async function advanceOfficialScan(env: Env, state: OfficialScan) {
  if (!state.setDone) {
    try {
      const now = new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Bangkok" });
      const params = new URLSearchParams({ symbol: "LTMH", sourceId: "company", securityType: "S", fromDate: "01/01/2025", toDate: now, lang: "en", page: String(state.setPage + 1), perPage: "100" });
      const response = await fetch(`https://www.set.or.th/api/set/news/search?${params}`, { headers, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`SET news API HTTP ${response.status}`);
      const data: any = await response.json();
      if (!Array.isArray(data.newsInfoList) || !Number.isFinite(Number(data.totalCount))) throw new Error("SET ไม่คืนรายการข่าวที่ตรวจสอบได้");
      if (!data.newsInfoList.length && state.setPage * 100 < Number(data.totalCount)) throw new Error("SET pagination ไม่ครบ");
      for (const row of data.newsInfoList) {
        if (row.symbol && row.symbol !== "LTMH") continue;
        const url = row.url || `https://www.set.or.th/en/market/news-and-alert/newsdetails?id=${encodeURIComponent(row.id)}`;
        enqueue(state, { url, publisher: "SET", announcedAt: validAnnouncementDate(row.datetime), title: row.headline, kind: "news" });
      }
      state.setPage++;
      state.setDone = state.setPage * 100 >= Number(data.totalCount);
    } catch (error) { state.setDone = true; state.setError = message(error); }
    await updateSourceStatus(env, { id: "set-ltmh-news", name: "SET LTMH News", status: "incomplete", url: SET_NEWS_URL,
      message: state.setError || `อ่านรายการข่าว ${state.setPage} หน้า; กำลังตรวจเอกสาร` });
    return false;
  }
  if (!state.irDone) {
    try {
      const response = await fetch(LTMH_IR_URL, { headers, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`LTMH IR HTTP ${response.status}`);
      const urls = extractIrPdfUrls(await response.text()).filter(isTrustedOfficialUrl);
      if (!urls.length) throw new Error("ไม่พบรายการเอกสารบริษัท");
      for (const url of urls) enqueue(state, { url, publisher: "LTMH", announcedAt: null, kind: "pdf" });
    } catch (error) { state.irError = message(error); }
    state.irDone = true;
    await updateSourceStatus(env, { id: "ltmh-investor-relations", name: "LTMH Investor Relations", status: "incomplete", url: LTMH_IR_URL,
      message: state.irError || `กำลังตรวจเอกสารทั้งหมด ${state.queue.length} รายการ` });
    return false;
  }
  const task = state.queue.shift();
  if (task) {
    try {
      if (task.kind === "news") {
        const response = await fetch(task.url, { headers, signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`SET document HTTP ${response.status}`);
        const html = await response.text();
        if (!/LTMH/i.test(html) || /Incapsula|Request unsuccessful/i.test(html)) throw new Error("SET news detail ไม่พร้อมใช้งาน");
        const pdfs = extractIrPdfUrls(html).filter(isTrustedOfficialUrl);
        if (!pdfs.length) throw new Error(`ข่าวยังไม่มีเอกสาร PDF ที่ตรวจได้: ${task.title || task.url}`);
        for (const url of pdfs) enqueue(state, { ...task, url, kind: "pdf" });
      } else {
        const result = await inspectOfficialPdf(env, task.url, task);
        state.inserted += result.inserted;
        state.pending += result.pending;
      }
    } catch (error) {
      state.failures++;
      if (task.publisher === "SET") state.setError = message(error); else state.irError = message(error);
      await env.DB.prepare("INSERT OR IGNORE INTO aua_sources (id,publisher,source_kind,title,url,announced_at,discovered_at,verification_status,completeness_status,notes,last_checked_at) VALUES (?,?,'discovery',?,?,?,?,'pending_review','incomplete',?,?)")
        .bind(`pending-${await digest(task.url)}`, task.publisher, task.title || task.url, task.url, task.announcedAt, nowIso(), message(error), nowIso()).run();
    }
    state.checked++;
    return false;
  }
  for (const [id, name, url, error] of [
    ["set-ltmh-news", "SET LTMH News", SET_NEWS_URL, state.setError],
    ["ltmh-investor-relations", "LTMH Investor Relations", LTMH_IR_URL, state.irError]
  ]) await updateSourceStatus(env, { id: id!, name: name!, url: url!, status: error ? "incomplete" : "ok",
    message: error || `ตรวจ ${state.checked} รายการ; AUA ใหม่ ${state.inserted}; รอตรวจสอบ ${state.pending}` });
  return true;
}

function enqueue(state: OfficialScan, task: DocumentTask) {
  if (!isTrustedOfficialUrl(task.url) || state.seen.includes(task.url)) return;
  state.seen.push(task.url);
  state.queue.push(task);
}
export function isTrustedOfficialUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && ["www.set.or.th", "weblink.set.or.th", "t0.ltmh.com", "www.ltmh.com"].includes(url.hostname); } catch { return false; }
}
export function validAnnouncementDate(value: unknown) {
  const match = String(value || "").match(/^(20\d{2}-\d{2}-\d{2})(?:T|$)/);
  return match && Number.isFinite(Date.parse(match[1])) ? match[1] : null;
}
async function digest(text: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2,"0")).join("").slice(0,20); }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
