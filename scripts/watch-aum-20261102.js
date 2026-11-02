import { appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runSitesRefresh } from "./run-sites-refresh.js";

export const TARGET_DATE = "2026-11-02";
export const SITE = "https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site";
export const REPOSITORY = "benzkanin41-alt/aum-dashboard-wealthx-mega";
export const ISSUE_TITLE = "AUM 2026-11-02 completeness and AUA Projection";
export const MARKER = "<!-- aum-watch-2026-11-02:v1 -->";
export const COMPLETE = "<!-- aum-watch-2026-11-02:complete -->";
export const UNIVERSE = {
  wealthx_other: ["KT-BAI","LHGRID","LHPHOTONICS","M-ASIASEMI","ONE-GOLD-X-UH","ONE-HUMANOID-X-UH","PRINCIPAL VNEI-EX","TLCHINASTAR50-X","TLCNTECH100-X","TLCOREWEALTH-H-X","TLCOREWEALTH-UH-X","TLCOREWEALTHRMF","TLNDQINCOME-H-X","TLNDQINCOME-UH-X","TLSPACE-X","TLUS500-UH-X","TLUS500RMF","TLUSGOVRMF","TLUSHG-H-X","TLUSHG-UH-X","TLUSHGRMF","TLUSNDQ-UH-X","TLUSNDQRMF","TLWORLD-X","TLWORLDBOND-H-X","TLWORLDBOND-UH-X","TLWORLDBONDRMF","TLWORLDRMF","TLWORLDXUS-X","TLWORLDXUSRMF"],
  mega30: ["MEGA10-A","MEGA10-SSF","MEGA10AI-A","MEGA10AI-SSF","MEGA10AICHINA-A","MEGA10AICHINARMF","MEGA10AIRMF","MEGA10CHINA-A","MEGA10CHINA-SSF","MEGA10CHINAPOP-A","MEGA10CHINAPOPRMF","MEGA10CHINARMF","MEGA10CHINATECH-A","MEGA10CHINATECHRMF","MEGA10CYBER-A","MEGA10CYBERRMF","MEGA10EURO-A","MEGA10EURO-SSF","MEGA10EURORMF","MEGA10HEALTH-A","MEGA10HEALTHRMF","MEGA10RMF","MEGA20THAIESG","MEGATX8020C-L","MEGATX8020C-N","MEGATX8020U-L","MEGATX8020U-N","MEGAWORLD30-A","MEGAWORLD30-SSF","MEGAWORLD30RMF","TLUSHD-H","TLUSHD-UH","TLUSHDRMF"],
  other_funds: ["DAOL-GAS","DAOL-HYDROGEN","ES-GRID","ES-GTECH","KT-GOLDUH-A","LHDRAM","MATECH-A","MATECH-D","TLGOLDPLUS"]
};
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function eligibleFunds(snapshot) {
  if (snapshot?.appId !== "aum-dashboard" || !snapshot.dataVersion) throw new Error("Invalid canonical snapshot");
  const funds = snapshot.funds.filter(f => f.launchStatus !== "pending" && (!f.inceptionDate || f.inceptionDate <= TARGET_DATE));
  for (const [bucket, codes] of Object.entries(UNIVERSE)) {
    const actual = funds.filter(f => f.bucketId === bucket).map(f => f.code).sort();
    if (JSON.stringify(actual) !== JSON.stringify(codes)) throw new Error("Target-date fund universe changed; manual review required");
  }
  if (funds.length !== 72 || new Set(funds.map(f => f.code)).size !== 72) throw new Error("Unexpected target-date fund coverage");
  return funds;
}

export function verifyProjection(snapshot, exactPoints) {
  const seriesCodes = UNIVERSE.wealthx_other;
  const total = round2(seriesCodes.reduce((s, code) => s + exactPoints.get(code).aumMillionBaht, 0));
  const pair = snapshot.charts?.comparison?.find(p => p.referenceDate === TARGET_DATE);
  if (!pair || pair.aumDate !== TARGET_DATE || Math.abs(pair.seriesxAum - total) > 0.001) throw new Error("Model has not used the complete target-date SeriesX AUM");
  if (!snapshot.officialAua.some(a => a.status === "verified" && a.referenceDate === TARGET_DATE && a.amountMillionBaht === 8000)) throw new Error("Verified target-date AUA is absent");
  const p = snapshot.projection;
  if (snapshot.model.algorithmVersion !== "anchored-bootstrap-v1" || snapshot.model.pairCount < 8 ||
      p.algorithmVersion !== "anchored-bootstrap-v1" || p.intervalMethod !== "parametric-anchored-error-bootstrap-10000" || p.intervalLevel !== 0.95 ||
      ![p.lower, p.value, p.upper, snapshot.model.slope].every(Number.isFinite) || p.lower < 0 || p.lower > p.value || p.value > p.upper ||
      p.aumDate < p.anchorReferenceDate || p.anchorAumDate > p.anchorReferenceDate || p.anchorReferenceDate !== snapshot.latestActual.referenceDate) throw new Error("Projection is not verified for completion");
  const expected = round2(p.anchorAuaMillionBaht + snapshot.model.slope * (p.aumMillionBaht - p.anchorAumMillionBaht));
  if (expected !== p.value || !p.inputFingerprint) throw new Error("Anchored projection or input fingerprint mismatch");
  return { seriesxTargetAum: total, value: p.value, lower: p.lower, upper: p.upper, aumDate: p.aumDate, modelVersion: snapshot.model.id, dataVersion: snapshot.dataVersion };
}

export async function watchAum({
  mode = "watch", token, fetchImpl = globalThis.fetch, refreshImpl = runSitesRefresh,
  notifyTest = false, now = () => new Date().toISOString(), log = x => console.log(JSON.stringify(x))
} = {}) {
  if (!["watch", "verify"].includes(mode) || !token || /[\r\n]/.test(token)) throw new Error("Invalid monitor mode or GitHub token");
  const github = async (resource, method = "GET", body) => {
    const r = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}${resource}`, { method, redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!r.ok) throw new Error(`GitHub ${method} HTTP ${r.status}; response body omitted`);
    return r.status === 204 ? null : r.json();
  };
  const canonical = async resource => {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetchImpl(`${SITE}${resource}`, { redirect: "error", headers: { accept: "application/json" }, signal: AbortSignal.timeout(45000) });
        if (!r.ok) throw new Error(`Canonical GET HTTP ${r.status}`);
        return await r.json();
      } catch (e) { if (i === 2) throw e; }
    }
  };
  const listing = [];
  for (let page = 1; page <= 10; page++) {
    const rows = await github(`/issues?state=all&creator=github-actions%5Bbot%5D&per_page=100&page=${page}`);
    listing.push(...rows);
    if (rows.length < 100) break;
    if (page === 10) throw new Error("Incomplete monitor issue discovery; no duplicate was created");
  }
  const matches = listing.filter(i => !i.pull_request && i.title === ISSUE_TITLE && i.body?.includes(MARKER));
  if (matches.length > 1) throw new Error("Duplicate monitor issues; no update started");
  let issue = matches[0];
  if (!issue) issue = await github("/issues", "POST", { title: ISSUE_TITLE, assignees: ["benzkanin41-alt"], body: `${MARKER}\nWaiting for real ${TARGET_DATE} AUM for all 72 active classes (30 SeriesX, 33 MEGA30/TLUSHD, 9 other). Pending IPO classes and carried NAV do not count.\n\nRuns on GitHub cloud hourly; existing daily 09:00 Bangkok refresh is unchanged. Only the existing canonical Sites updater may write financial data. Local synchronizes when opened/online; an offline computer cannot receive cache writes.\n\nNo completion notification is sent while data is incomplete. Formulas, UI and historical records are preserved.\n\n${SITE}` });
  const comments = await github(`/issues/${issue.number}/comments?per_page=100`);
  if (comments.length >= 100) throw new Error("Monitor comment history requires manual review");
  const trustedComments = comments.filter(c => c.user?.login === "github-actions[bot]");
  const notifyOnce = async (marker, body) => {
    if (trustedComments.some(c => c.body?.includes(marker))) return false;
    await github(`/issues/${issue.number}/comments`, "POST", { body: `${marker}\n${body}` });
    trustedComments.push({ body: `${marker}\n${body}` });
    return true;
  };
  if (issue.state === "closed" || trustedComments.some(c => c.body?.includes(COMPLETE))) {
    if (issue.state !== "closed") await github(`/issues/${issue.number}`, "PATCH", { state: "closed", state_reason: "completed" });
    const result = { status: "already_complete_or_stopped", issueUrl: issue.html_url, siteRequests: 0 }; log(result); return result;
  }
  try {
    let snapshot = await canonical("/api/dashboard");
    eligibleFunds(snapshot);
    if (mode === "watch") {
      // The central five-minute guard and cursor lock own concurrency and resume.
      await refreshImpl({ mode: "manual", base: SITE, fetchImpl, deadlineMs: 10 * 60000, onProgress: () => {}, reportResult: async () => {} });
      snapshot = await canonical("/api/dashboard");
    }
    const funds = eligibleFunds(snapshot), exactPoints = new Map(), missing = [];
    for (const fund of funds) {
      const detail = await canonical(`/api/funds/${encodeURIComponent(fund.code)}`);
      if (detail.code !== fund.code || !Array.isArray(detail.history)) throw new Error("Fund response identity mismatch");
      const points = detail.history.filter(p => p.date === TARGET_DATE);
      if (points.length > 1) throw new Error("Conflicting target-date rows require manual review");
      const point = points[0];
      const source = point?.sourceUrl ? new URL(point.sourceUrl) : null;
      if (!point || !Number.isFinite(point.aumMillionBaht) || point.aumMillionBaht < 0 || !source || source.protocol !== "https:" || !["nav.talisam.co.th", "www.settrade.com"].includes(source.hostname)) missing.push(fund.code);
      else exactPoints.set(fund.code, point);
    }
    const metadata = await canonical("/api/dashboard/version");
    if (metadata.appId !== "aum-dashboard" || metadata.dataVersion !== snapshot.dataVersion || metadata.job?.status === "running") {
      const result = { status: "waiting_for_stable_snapshot", issueUrl: issue.html_url }; log(result); return result;
    }
    if (notifyTest && mode === "verify") await notifyOnce("<!-- aum-watch-2026-11-02:notification-test -->", `@benzkanin41-alt ทดสอบช่องทางแจ้งเตือนจาก cloud runner สำเร็จ (ไม่ใช่การยืนยันว่า AUM ครบแล้ว)\n\nพบ AUM วันที่ ${TARGET_DATE} จำนวน ${exactPoints.size}/72 กอง ณ ${now()}\n\nเมื่อข้อมูลครบและ Projection ผ่านการตรวจ จะมีข้อความยืนยันอีกครั้งใน issue นี้ ไม่ส่งข้อความซ้ำทุกชั่วโมงขณะรอ\n\n${SITE}`);
    if (missing.length) { const result = { status: "waiting_for_target_date", checkedAt: now(), targetDate: TARGET_DATE, covered: exactPoints.size, expected: funds.length, missing, dataVersion: snapshot.dataVersion, issueUrl: issue.html_url }; log(result); return result; }
    const verified = verifyProjection(snapshot, exactPoints);
    if (mode === "verify") { const result = { status: "verified_ready_read_only", ...verified, issueUrl: issue.html_url }; log(result); return result; }
    await notifyOnce(COMPLETE, `@benzkanin41-alt AUM วันที่ 2 พ.ย. 2569 ครบ 72/72 กองที่เปิดใช้งานแล้ว และอัปเดต AUA Projection ผ่านระบบกลางสำเร็จ\n\n- SeriesX AUM วันที่ 2 พ.ย.: ${verified.seriesxTargetAum.toLocaleString("en-US")} ล้านบาท (30/30 กอง)\n- Projection ล่าสุด: ${verified.value.toLocaleString("en-US")} ล้านบาท ณ ${verified.aumDate}\n- ช่วง 95%: ${verified.lower.toLocaleString("en-US")} ถึง ${verified.upper.toLocaleString("en-US")} ล้านบาท ภายใต้สมมติฐานโมเดล\n- รุ่นข้อมูล: ${verified.dataVersion}\n- รุ่นโมเดล: ${verified.modelVersion}\n\n${SITE}\n\nสูตร หน้าตา และประวัติเดิมคงไว้ Local URL เดิมจะ sync snapshot นี้เมื่อเปิดหรือกลับมาออนไลน์ ไม่ต้องเปิดคอมรอ\n\nตัวติดตามนี้หยุดเรียก updater หลังสำเร็จ งานประจำวัน 09:00 ไทยยังทำงานเดิม`);
    await github(`/issues/${issue.number}`, "PATCH", { state: "closed", state_reason: "completed" });
    const result = { status: "complete", checkedAt: now(), covered: 72, ...verified, issueUrl: issue.html_url }; log(result); return result;
  } catch (error) {
    if (trustedComments.some(c => c.body?.includes(COMPLETE))) return { status: "complete_notification_recorded_cleanup_pending", issueUrl: issue.html_url };
    const message = String(error.message).replaceAll(token, "[redacted]");
    const fingerprint = createHash("sha256").update(message).digest("hex").slice(0, 16);
    await notifyOnce(`<!-- aum-watch-2026-11-02:error-${fingerprint} -->`, `@benzkanin41-alt ตัวติดตามยังยืนยันผลสำเร็จไม่ได้: ${message}\n\nไม่ถือว่าข้อมูลครบ ไม่เปลี่ยนสูตรหรือเขียนทับประวัติ ระบบจะตรวจซ้ำในรอบถัดไป\n\n${SITE}`);
    const result = { status: "needs_attention", error: message, issueUrl: issue.html_url }; log(result); return result;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await watchAum({ mode: process.env.AUM_WATCH_MODE || "watch", token: process.env.GITHUB_TOKEN, notifyTest: process.env.AUM_WATCH_NOTIFY_TEST === "true" });
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## AUM 2 November 2026 monitor\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n`);
}
