import fs from "node:fs/promises";
import path from "node:path";
import { loadDashboardData } from "../server-lib/sec-refresh.js";

const ROOT = process.cwd();
const OUTPUT_PATH = path.resolve(ROOT, process.env.SHARE_HTML_OUTPUT || path.join("outputs", "aum_dashboard_share.html"));

const dashboard = await loadDashboardData();
const snapshot = {
  generatedAt: dashboard.generatedAt,
  buckets: dashboard.buckets.map((bucket) => ({
    id: bucket.id,
    name: bucket.name,
    description: bucket.description,
    color: bucket.color,
    latestTotal: bucket.latestTotal,
    previousTotal: bucket.previousTotal,
    changeMillionBaht: bucket.changeMillionBaht,
    changePct: bucket.changePct,
    series: bucket.series,
    funds: bucket.funds.map((fund) => ({
      code: fund.code,
      group: fund.group,
      source: fund.source || "",
      identifierType: fund.identifierType,
      identifier: fund.identifier,
      latest: fund.latest,
      previous: fund.previous,
      changeMillionBaht: fund.changeMillionBaht,
      changePct: fund.changePct
    }))
  }))
};

await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await fs.writeFile(OUTPUT_PATH, buildHtml(snapshot), "utf8");
console.log(OUTPUT_PATH);

function buildHtml(data) {
  const encoded = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AUM Dashboard Snapshot</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --ink: #13233a;
      --muted: #667085;
      --line: #d8dee9;
      --panel: #ffffff;
      --blue: #1f5fbf;
      --green: #0f766e;
      --red: #c2413a;
      --shadow: 0 14px 38px rgba(19, 35, 58, 0.10);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, "Segoe UI", Tahoma, Arial, sans-serif;
      background: var(--bg);
      color: var(--ink);
    }
    .shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 44px; }
    header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 18px;
      align-items: end;
      margin-bottom: 22px;
    }
    h1 { margin: 0; font-size: clamp(28px, 4vw, 48px); line-height: 1.05; letter-spacing: 0; }
    .sub { color: var(--muted); margin: 10px 0 0; font-size: 15px; }
    .stamp { text-align: right; color: var(--muted); font-size: 13px; }
    .cards {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin: 18px 0;
    }
    .card {
      background: var(--panel);
      border: 1px solid rgba(19, 35, 58, 0.08);
      border-left: 6px solid var(--blue);
      border-radius: 8px;
      padding: 18px 18px 16px;
      box-shadow: var(--shadow);
    }
    .card:nth-child(2) { border-left-color: var(--green); }
    .card-top { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
    .label { font-weight: 800; font-size: 20px; }
    .desc { color: var(--muted); margin-top: 5px; font-size: 13px; line-height: 1.45; }
    .value { font-size: clamp(34px, 5vw, 52px); font-weight: 850; margin: 16px 0 4px; }
    .unit { color: var(--muted); font-size: 16px; font-weight: 650; }
    .delta { font-weight: 750; font-size: 15px; }
    .delta.up { color: #14804a; }
    .delta.down { color: var(--red); }
    .tabs, .ranges { display: flex; flex-wrap: wrap; gap: 8px; }
    button {
      border: 1px solid var(--line);
      background: #fff;
      color: var(--ink);
      border-radius: 8px;
      min-height: 40px;
      padding: 0 14px;
      font: inherit;
      font-weight: 750;
      cursor: pointer;
    }
    button.active { background: var(--ink); border-color: var(--ink); color: #fff; }
    .workbench {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(340px, 0.8fr);
      gap: 16px;
      margin-top: 14px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid rgba(19, 35, 58, 0.08);
      border-radius: 8px;
      padding: 16px;
      box-shadow: var(--shadow);
    }
    .panel-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; }
    h2 { margin: 0; font-size: 20px; letter-spacing: 0; }
    canvas { width: 100%; height: 330px; display: block; }
    .meta { color: var(--muted); font-size: 13px; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #edf0f5; text-align: right; vertical-align: top; }
    th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .02em; }
    .code { font-weight: 800; white-space: nowrap; }
    .footer-note {
      margin-top: 16px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    @media (max-width: 860px) {
      header, .workbench, .cards { grid-template-columns: 1fr; }
      .stamp { text-align: left; }
      .panel-head { align-items: flex-start; flex-direction: column; }
      canvas { height: 280px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <div>
        <h1>WealthX SeriesX และ MEGA30+TLUSHD</h1>
        <p class="sub">Snapshot dashboard สำหรับดูยอด AUM แยกตาม bucket ล่าสุด</p>
      </div>
      <div class="stamp" id="stamp"></div>
    </header>

    <section class="cards" id="cards"></section>

    <section class="panel">
      <div class="panel-head">
        <div class="tabs" id="tabs"></div>
        <div class="ranges" id="ranges">
          <button data-days="365" class="active">1Y</button>
          <button data-days="183">6M</button>
          <button data-days="92">3M</button>
          <button data-days="31">1M</button>
        </div>
      </div>
      <canvas id="chart" width="1000" height="360" aria-label="AUM chart"></canvas>
      <div class="meta" id="chartMeta"></div>
    </section>

    <section class="workbench">
      <section class="panel">
        <div class="panel-head"><h2 id="tableTitle">รายการกองทุน</h2></div>
        <div style="overflow:auto">
          <table>
            <thead>
              <tr><th>กองทุน</th><th>กลุ่ม</th><th>AUM ลบ.</th><th>NAV</th><th>วันที่</th></tr>
            </thead>
            <tbody id="fundRows"></tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>สรุป Bucket</h2></div>
        <div id="bucketDetails"></div>
        <p class="footer-note">ไฟล์นี้เป็น static snapshot สำหรับส่งต่อ จึงไม่มีการ refresh ข้อมูลจาก API อัตโนมัติ ตัวเลขสร้างจากข้อมูล dashboard ในเครื่อง ณ เวลาที่ export</p>
      </section>
    </section>
  </main>

  <script>
    const DATA = ${encoded};
    let activeBucketId = DATA.buckets[0]?.id || "";
    let activeDays = 365;

    const fmt = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    const fmt0 = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });

    function formatDate(value) {
      if (!value) return "-";
      return new Intl.DateTimeFormat("th-TH", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
    }

    function deltaClass(value) {
      return Number(value || 0) >= 0 ? "up" : "down";
    }

    function deltaText(value, pct) {
      if (value === null || value === undefined) return "-";
      const arrow = value >= 0 ? "▲" : "▼";
      const pctText = pct === null || pct === undefined ? "" : " (" + fmt.format(Math.abs(pct)) + "%)";
      return arrow + " " + fmt.format(Math.abs(value)) + " ลบ." + pctText;
    }

    function activeBucket() {
      return DATA.buckets.find((bucket) => bucket.id === activeBucketId) || DATA.buckets[0];
    }

    function filteredSeries(bucket) {
      if (!bucket?.series?.length) return [];
      const latestDate = new Date(bucket.series.at(-1).date + "T00:00:00");
      const cutoff = new Date(latestDate);
      cutoff.setDate(cutoff.getDate() - activeDays);
      return bucket.series.filter((point) => new Date(point.date + "T00:00:00") >= cutoff);
    }

    function render() {
      document.getElementById("stamp").innerHTML = "สร้างเมื่อ<br><strong>" + formatDate(DATA.generatedAt) + "</strong>";
      document.getElementById("cards").innerHTML = DATA.buckets.map((bucket) => {
        return '<article class="card">' +
          '<div class="card-top"><div><div class="label">' + bucket.name + '</div><div class="desc">' + bucket.description + '</div></div>' +
          '<div class="delta ' + deltaClass(bucket.changeMillionBaht) + '">' + deltaText(bucket.changeMillionBaht, bucket.changePct) + '</div></div>' +
          '<div class="value">' + fmt.format(bucket.latestTotal || 0) + ' <span class="unit">ลบ.</span></div>' +
          '<div class="meta">' + bucket.funds.filter((fund) => fund.latest).length + '/' + bucket.funds.length + ' กอง | ล่าสุด ' + formatDate(bucket.series.at(-1)?.date) + '</div>' +
        '</article>';
      }).join("");

      document.getElementById("tabs").innerHTML = DATA.buckets.map((bucket) =>
        '<button data-bucket="' + bucket.id + '" class="' + (bucket.id === activeBucketId ? "active" : "") + '">' + bucket.name + '</button>'
      ).join("");

      document.querySelectorAll("[data-bucket]").forEach((button) => {
        button.addEventListener("click", () => {
          activeBucketId = button.dataset.bucket;
          render();
        });
      });

      document.querySelectorAll("[data-days]").forEach((button) => {
        button.classList.toggle("active", Number(button.dataset.days) === activeDays);
        button.addEventListener("click", () => {
          activeDays = Number(button.dataset.days);
          render();
        });
      });

      renderChart(activeBucket());
      renderFunds(activeBucket());
      renderBucketDetails();
    }

    function renderFunds(bucket) {
      document.getElementById("tableTitle").textContent = "รายการกองทุน - " + bucket.name;
      document.getElementById("fundRows").innerHTML = bucket.funds.map((fund) => {
        const latest = fund.latest || {};
        return '<tr><td class="code">' + fund.code + '</td><td>' + (fund.group || "-") + '</td><td>' +
          (latest.aumMillionBaht === undefined ? "-" : fmt.format(latest.aumMillionBaht)) + '</td><td>' +
          (latest.nav === undefined ? "-" : fmt.format(latest.nav)) + '</td><td>' + (latest.navDate || "-") + '</td></tr>';
      }).join("");
    }

    function renderBucketDetails() {
      document.getElementById("bucketDetails").innerHTML = DATA.buckets.map((bucket) => {
        const latest = bucket.series.at(-1);
        return '<div style="border-bottom:1px solid #edf0f5;padding:10px 0">' +
          '<div style="font-weight:850">' + bucket.name + '</div>' +
          '<div class="value" style="font-size:28px;margin:6px 0">' + fmt.format(bucket.latestTotal || 0) + ' <span class="unit">ลบ.</span></div>' +
          '<div class="meta">' + bucket.funds.length + ' กอง | ' + (latest?.date || "-") + '</div>' +
        '</div>';
      }).join("");
    }

    function renderChart(bucket) {
      const canvas = document.getElementById("chart");
      const ctx = canvas.getContext("2d");
      const width = canvas.width;
      const height = canvas.height;
      const pad = { left: 70, right: 24, top: 28, bottom: 48 };
      const points = filteredSeries(bucket);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      if (!points.length) return;

      const values = points.map((point) => point.totalMillionBaht);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = Math.max(1, max - min);
      const niceMin = min - span * 0.08;
      const niceMax = max + span * 0.08;
      const x = (index) => pad.left + (index / Math.max(1, points.length - 1)) * (width - pad.left - pad.right);
      const y = (value) => pad.top + (1 - ((value - niceMin) / (niceMax - niceMin))) * (height - pad.top - pad.bottom);

      ctx.strokeStyle = "#e5e9f2";
      ctx.lineWidth = 1;
      ctx.fillStyle = "#667085";
      ctx.font = "13px Segoe UI, Tahoma, sans-serif";
      for (let i = 0; i <= 4; i++) {
        const value = niceMin + ((niceMax - niceMin) * i / 4);
        const gy = y(value);
        ctx.beginPath();
        ctx.moveTo(pad.left, gy);
        ctx.lineTo(width - pad.right, gy);
        ctx.stroke();
        ctx.fillText(fmt0.format(value), 12, gy + 4);
      }

      const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
      gradient.addColorStop(0, "rgba(31, 95, 191, 0.22)");
      gradient.addColorStop(1, "rgba(31, 95, 191, 0.00)");
      ctx.beginPath();
      points.forEach((point, index) => {
        const px = x(index);
        const py = y(point.totalMillionBaht);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.lineTo(x(points.length - 1), height - pad.bottom);
      ctx.lineTo(x(0), height - pad.bottom);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      points.forEach((point, index) => {
        const px = x(index);
        const py = y(point.totalMillionBaht);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = bucket.color || "#1f5fbf";
      ctx.lineWidth = 4;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();

      const first = points[0];
      const mid = points[Math.floor(points.length / 2)];
      const last = points.at(-1);
      ctx.fillStyle = "#667085";
      ctx.font = "13px Segoe UI, Tahoma, sans-serif";
      ctx.fillText(first.date, pad.left, height - 16);
      ctx.fillText(mid.date, width / 2 - 40, height - 16);
      ctx.fillText(last.date, width - pad.right - 86, height - 16);
      document.getElementById("chartMeta").textContent = bucket.name + " | " + points.length + " จุดข้อมูล | " + first.date + " ถึง " + last.date;
    }

    render();
  </script>
</body>
</html>`;
}
