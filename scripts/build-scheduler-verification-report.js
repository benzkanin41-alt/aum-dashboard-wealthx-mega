import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { DATA_ROOT } from "../server-lib/local-paths.js";

const root = path.join(DATA_ROOT, "tests", "scheduler-20260918");
const read = async file => JSON.parse(await fs.readFile(file, "utf8"));
const before = await read(path.join(root, "before.json"));
const baseline = await read(path.join(root, "snapshot-before.json"));
const live = await read(path.join(root, "live-refresh.json"));
const provider = await read(path.join(DATA_ROOT, "scheduler", "cron-job-verification.json"));
const delivery = await read(path.join(DATA_ROOT, "scheduler", "cron-delivery-verification.json"));
const token = await read(path.join(DATA_ROOT, "scheduler", "token-metadata.json"));
const shortcut = await read(path.join(root, "shortcut-final.json"));
const fallback = await read(path.join(root, "fallback-after-cron.json"));
const storage = await read(path.join(DATA_ROOT, "tests", "storage-final.json"));
const onlineUrl = "https://ltmh-wealthx-aum-aua.benzkanin41.chatgpt.site";
const localUrl = "http://127.0.0.1:12014";
async function snapshot(base) {
  const response = await fetch(`${base}/api/dashboard`, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Dashboard HTTP ${response.status}`);
  return response.json();
}
const online = await snapshot(onlineUrl);
const local = await snapshot(localUrl);
const cache = await read(path.join(DATA_ROOT, "cache", "dashboard-cache.json"));
const protectedFiles = [];
for (const [file, oldHash] of Object.entries(before.protectedFiles)) {
  const hash = createHash("sha256").update(await fs.readFile(file)).digest("hex");
  protectedFiles.push({ file, unchanged: hash === oldHash, sha256: hash });
}
const actualKey = row => JSON.stringify([row.id, row.referenceDate, row.amountMillionBaht, row.announcedAt]);
const actuals = new Set(online.officialAua.map(actualKey));
const allPreviousActualsRetained = baseline.officialAua.every(row => actuals.has(actualKey(row)));
const funds = new Set(online.funds.map(row => `${row.code}|${row.bucketId}`));
const allPreviousFundsRetained = baseline.funds.every(row => funds.has(`${row.code}|${row.bucketId}`));
const tap = await fs.readFile(path.join(root, "unit-tests.tap"), "utf8");
const tests = { pass: Number(tap.match(/^# pass (\d+)$/m)?.[1]), fail: Number(tap.match(/^# fail (\d+)$/m)?.[1]) };
const checks = [
  ["Cron-job.org: enabled, daily 09:00 Asia/Bangkok", provider.enabled && provider.nextExecutionBangkok === "09:00"],
  ["Real cron-job.org -> GitHub -> canonical Sites refresh", delivery.ok && delivery.github?.conclusion === "success"],
  ["Temporary delivery-test job removed", delivery.testJobRemoved === true],
  ["Daily fallback skips the completed cron refresh without changing data", fallback.result.ok && fallback.result.skipped && fallback.canonicalJobUnchanged && fallback.canonicalVersionUnchanged],
  ["Both signed-out Update buttons share one completed job", live.syncOk && live.starts[0].body.job.id === live.starts[1].body.job.id && live.completedJob.status === "complete"],
  ["Local, Online and offline cache have the same data version", online.dataVersion === local.dataVersion && online.dataVersion === cache.dataVersion && !local.cacheWarning],
  ["Existing shortcut cold-starts the correct app and URL", shortcut.ok === true && shortcut.appId === "aum-dashboard"],
  ["Formula, UI, API, cache and launcher source hashes unchanged", protectedFiles.every(file => file.unchanged)],
  ["Previous official AUA points retained", allPreviousActualsRetained],
  ["Previous funds and bucket assignments retained", allPreviousFundsRetained],
  ["Existing projection model unchanged", JSON.stringify(online.model) === JSON.stringify(baseline.model)],
  ["Offline copy works and missing E: does not create a C: fallback", storage.ok && storage.offline.ok && storage.missingDriveFailsWithoutFallback],
  ["Unit and regression tests", tests.pass >= 28 && tests.fail === 0]
].map(([name, passed]) => ({ name, passed: Boolean(passed) }));
const report = { checkedAt: new Date().toISOString(), ok: checks.every(check => check.passed), checks,
  onlineUrl, localUrl, provider, delivery, token, shortcut, fallback, storage, tests, protectedFiles,
  dataVersion: online.dataVersion, modelVersion: online.model.id, modelUnchanged: JSON.stringify(online.model) === JSON.stringify(baseline.model),
  currentFundCount: online.funds.length, officialAuaCount: online.officialAua.length, sourceStatus: online.sourceStatus,
  scheduled0900RunObserved: false, dashboardDeploymentChanged: false, githubPagesDeployed: false };
await fs.writeFile(path.join(root, "final.json"), JSON.stringify(report, null, 2));
const esc = value => String(value ?? "-").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const thaiTime = value => value ? new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "medium" }).format(new Date(value)) : "-";
const html = `<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LTMH Scheduler Verification</title>
<style>body{font:16px/1.65 Tahoma,Arial,sans-serif;color:#202428;background:#f6f7f8;margin:0}main{max-width:1000px;margin:auto;padding:28px 22px}h1{font-size:26px}h2{font-size:20px;margin-top:30px}table{border-collapse:collapse;width:100%;background:#fff}th,td{text-align:left;border-bottom:1px solid #d6dce0;padding:10px;overflow-wrap:anywhere}th{background:#edf0f2}a{color:#075ba4}code{overflow-wrap:anywhere}.pass{color:#087251}.fail{color:#b52c36}.note{border-left:4px solid #b08018;padding:8px 16px;background:#fff}small{color:#566069}@media(max-width:600px){main{padding:18px 12px}h1{font-size:23px}th,td{padding:8px;font-size:14px}}@media print{body{background:white}main{max-width:none}}</style>
<main><h1>ผลตรวจระบบอัปเดต LTMH Dashboard</h1><p>ตรวจเมื่อ ${esc(thaiTime(report.checkedAt))} ประเทศไทย</p>
<p><strong>${report.ok ? "ผ่านการทดสอบในขอบเขตงาน" : "ยังมีรายการที่ต้องตรวจ"}</strong> ใช้ cron-job.org ฟรีเรียก GitHub Actions แล้วอัปเดตฐานกลาง Sites เดิม คง GitHub schedule เดิมเป็นสำรอง และมีตัวกันรอบซ้ำ</p>
<p><a href="${onlineUrl}">Online dashboard เดิม</a> | <a href="${localUrl}">Local dashboard เดิม</a></p>
<h2>ตั้งเวลาและการทดสอบจริง</h2><table><tbody>
<tr><th>งานหลัก</th><td>${esc(provider.title)} (ID ${esc(provider.jobId)})</td></tr>
<tr><th>เวลาเป้าหมาย</th><td>ทุกวัน 09:00 น. Asia/Bangkok</td></tr>
<tr><th>รอบถัดไปที่ provider ยืนยัน</th><td>${esc(thaiTime(provider.nextExecution))}</td></tr>
<tr><th>รอบทดสอบ: เวลานัด / ส่งจริง</th><td>${esc(thaiTime(delivery.cron?.plannedAt))} / ${esc(thaiTime(delivery.cron?.actualAt))}</td></tr>
<tr><th>คำขอจาก cron-job.org</th><td>HTTP ${esc(delivery.cron?.httpStatus)}; ช้ากว่าเวลานัด ${esc((delivery.cron?.jitterMs / 1000).toFixed(3))} วินาที</td></tr>
<tr><th>งานกลางเริ่ม / เสร็จ</th><td>${esc(thaiTime(delivery.canonical?.startedAt))} / ${esc(thaiTime(delivery.canonical?.completedAt))}</td></tr>
<tr><th>หลักฐาน GitHub</th><td><a href="${esc(delivery.runUrl)}">รอบที่ cron-job.org เรียกจริง</a> | <a href="${esc(fallback.url)}">รอบทดสอบกันการอัปเดตซ้ำหลัง cron</a></td></tr>
</tbody></table>
<p class="note">09:00 น. เป็นเวลาเริ่มเรียกงาน ไม่ใช่เวลาที่ข้อมูลจะเสร็จทั้งหมด ยังขึ้นกับคิว GitHub และเว็บต้นทาง รอบ 09:00 น. ถัดไปยังไม่เกิดขึ้น จึงยังไม่อ้างว่าผ่านการทดสอบแล้ว รอบที่พิสูจน์แล้วเป็นงานทดสอบเฉพาะกิจขณะ Local ปิดอยู่</p>
<h2>ผลตรวจ</h2><table><thead><tr><th>รายการ</th><th>ผล</th></tr></thead><tbody>${checks.map(row => `<tr><td>${esc(row.name)}</td><td class="${row.passed ? "pass" : "fail"}">${row.passed ? "ผ่าน" : "ไม่ผ่าน"}</td></tr>`).join("")}</tbody></table>
<p>Tests: ${tests.pass} ผ่าน / ${tests.fail} ไม่ผ่าน | รุ่นข้อมูล: <code>${esc(online.dataVersion)}</code><br>รุ่นโมเดล: <code>${esc(online.model.id)}</code> | กองทุน ${online.funds.length} รายการ | AUA ทางการ ${online.officialAua.length} จุด</p>
<p>ไม่ได้ deploy หน้า dashboard ใหม่ ไม่เปลี่ยน schema หรือสูตร ไม่เผยแพร่ GitHub Pages ไม่เปลี่ยน URL หรือ shortcut และไม่เปลี่ยนสิทธิ์ Windows ของไฟล์หรือโฟลเดอร์อื่น</p>
<h2>ข้อควรทราบ</h2><p>GitHub token หมดอายุ ${esc(thaiTime(token.tokenExpiration?.replace(" UTC", "Z").replace(" ", "T")))} ต้องต่ออายุก่อนถึงเวลานั้น ไม่ได้บันทึกค่าคีย์ในรายงานหรือ Git</p>
<p>Local ที่เปิดพร้อมอินเทอร์เน็ตดึงข้อมูลกลางและเก็บ cache บน E: หากออฟไลน์ใช้สำเนาล่าสุด การตรวจแหล่งข้อมูลอาจไม่ครบแม้งานอัปเดตจบ ต้องดูสถานะรายแหล่งตามเดิม</p>
<table><thead><tr><th>แหล่งข้อมูลที่ยังไม่ครบ</th><th>สถานะ</th></tr></thead><tbody>${online.sourceStatus.filter(source => source.status !== "ok").map(source => `<tr><td>${esc(source.name)}</td><td>${esc(source.status)}: ${esc(source.message)}</td></tr>`).join("") || "<tr><td colspan=\"2\">ไม่พบสถานะผิดปกติ</td></tr>"}</tbody></table>
<h2>หลักฐานไฟล์ที่รักษาเดิม</h2><table><thead><tr><th>ไฟล์</th><th>SHA-256</th></tr></thead><tbody>${protectedFiles.map(file => `<tr><td>${esc(file.file)}</td><td><code>${esc(file.sha256)}</code></td></tr>`).join("")}</tbody></table>
<h2>เอกสารอ้างอิง</h2><p>ตรวจ 18 ก.ย. 2569: <a href="https://cron-job.org/en/faq/">cron-job.org: บริการฟรีและขีดจำกัดคำขอ</a>, <a href="https://docs.cron-job.org/rest-api.html">cron-job.org API</a>, <a href="https://docs.github.com/en/actions/how-tos/troubleshoot-workflows">GitHub: schedule อาจล่าช้า</a>, <a href="https://docs.github.com/en/billing/concepts/product-billing/github-actions">GitHub: standard runner ของ public repository</a></p>
<p><small>ใช้ Sites Hosting skill, เอกสารและ API ทางการ, GitHub CLI, Node.js tests และ Playwright ไม่ใช้ Subagent ข้อเสนอปรับปรุงต่อไป: แจ้งเตือนเมื่ออัปเดตไม่สำเร็จและเตือนก่อน token หมดอายุ</small></p></main></html>`;
const output = path.join(DATA_ROOT, "scheduler-verification-2026-09-18.html");
await fs.writeFile(output, html);
console.log(JSON.stringify({ ok: report.ok, output, dataVersion: online.dataVersion, failedChecks: checks.filter(check => !check.passed) }));
if (!report.ok) process.exitCode = 1;
