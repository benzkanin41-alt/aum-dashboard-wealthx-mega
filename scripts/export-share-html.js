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
    * {
      box-sizing: border-box;
      min-width: 0;
    }
    html {
      width: 100%;
      max-width: 100%;
      overflow-x: hidden;
    }
    body {
      margin: 0;
      font-family: Inter, "Segoe UI", Tahoma, Arial, sans-serif;
      background: var(--bg);
      color: var(--ink);
      overflow-x: hidden;
    }
    .shell {
      width: min(1280px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 44px;
    }
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
      min-width: 0;
    }
    .card:nth-child(2) { border-left-color: var(--green); }
    .card-top { display: flex; justify-content: space-between; gap: 14px; align-items: flex-start; }
    .label { font-weight: 800; font-size: 20px; }
    .desc {
      color: var(--muted);
      margin-top: 5px;
      font-size: 13px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
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
      min-width: 0;
      line-height: 1.15;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    button.active { background: var(--ink); border-color: var(--ink); color: #fff; }
    .workbench {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      margin-top: 14px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid rgba(19, 35, 58, 0.08);
      border-radius: 8px;
      padding: 16px;
      box-shadow: var(--shadow);
      min-width: 0;
      overflow: hidden;
    }
    .panel-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; }
    h2 { margin: 0; font-size: 20px; letter-spacing: 0; }
    canvas { width: 100%; height: 330px; display: block; }
    .meta { color: var(--muted); font-size: 13px; margin-top: 8px; }
    .meta,
    .table-summary,
    .footer-note,
    h1,
    h2,
    .label {
      overflow-wrap: anywhere;
    }
    .fund-table-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 10px;
    }
    .table-summary {
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      margin-top: 4px;
    }
    .small-button { min-height: 34px; padding: 0 11px; }
    .table-controls {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }
    .table-controls label {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
    }
    .table-controls input,
    .table-controls select {
      width: 100%;
      min-height: 38px;
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      color: var(--ink);
      background: #fff;
      font: inherit;
      font-size: 13px;
    }
    .table-wrap {
      max-height: 520px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      width: 100%;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
    }
    table {
      width: 100%;
      min-width: 940px;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      padding: 10px 8px;
      border-bottom: 1px solid #edf0f5;
      text-align: right;
      vertical-align: top;
      white-space: normal;
    }
    th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
    th {
      position: sticky;
      top: 0;
      z-index: 2;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .02em;
      background: #f8fafc;
    }
    .code { font-weight: 800; white-space: nowrap; }
    .id-pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 4px 9px;
      background: #f1f5f9;
      color: #24405f;
      white-space: nowrap;
      max-width: min(230px, 100%);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .fund-tags {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .fund-group-row td {
      position: sticky;
      top: 39px;
      z-index: 1;
      padding: 9px 10px;
      color: var(--ink);
      background: #eef3f8;
      border-bottom-color: #d6dde7;
      text-align: left;
    }
    .fund-group-row td {
      display: flex;
      justify-content: space-between;
      gap: 14px;
    }
    .empty-row {
      height: 86px;
      color: var(--muted);
      font-weight: 800;
      text-align: center !important;
    }
    .footer-note {
      margin-top: 16px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    #bucketDetails {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    #bucketDetails > div {
      border: 1px solid #edf0f5;
      border-radius: 8px;
      padding: 12px;
      background: #fbfcff;
    }
    @media (max-width: 860px) {
      header, .workbench, .cards { grid-template-columns: 1fr; }
      .stamp { text-align: left; }
      .panel-head { align-items: flex-start; flex-direction: column; }
      .fund-table-head { align-items: stretch; }
      canvas { height: 280px; }
    }
    @media (max-width: 700px) {
      body { background: #f7f9fc; }
      .shell {
        width: 100%;
        padding: 16px 10px 28px;
      }
      header {
        grid-template-columns: 1fr;
        gap: 8px;
        margin-bottom: 14px;
      }
      h1 { font-size: clamp(25px, 7.2vw, 38px); }
      .sub { font-size: 13px; }
      .cards { grid-template-columns: 1fr; gap: 10px; }
      .card { padding: 14px; }
      .card-top { flex-direction: column; gap: 8px; }
      .value { font-size: clamp(30px, 11vw, 42px); }
      .panel { padding: 12px; border-radius: 8px; }
      .tabs,
      .ranges {
        display: grid;
        width: 100%;
      }
      .tabs { grid-template-columns: 1fr; }
      .ranges { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .tabs button,
      .ranges button {
        width: 100%;
        padding: 0 10px;
      }
      canvas { height: 240px; }
      .fund-table-head {
        flex-direction: column;
        gap: 10px;
      }
      .small-button { width: 100%; }
      .table-controls { grid-template-columns: 1fr; }
      .table-wrap {
        max-height: none;
        overflow: visible;
        border: 0;
      }
      table,
      tbody,
      tr,
      td {
        display: block;
        width: 100%;
      }
      table { min-width: 0; }
      thead { display: none; }
      tbody tr {
        margin-bottom: 10px;
        padding: 10px;
        border: 1px solid #e5eaf2;
        border-radius: 8px;
        background: #fff;
      }
      td {
        display: block;
        padding: 7px 0;
        border-bottom: 1px solid #f0f3f8;
        text-align: left;
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
      }
      td:last-child { border-bottom: 0; }
      td::before {
        content: attr(data-label);
        display: block;
        margin-bottom: 3px;
        color: var(--muted);
        font-weight: 800;
        text-align: left;
      }
      td > * {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      td:first-child,
      td:nth-child(2) {
        text-align: left;
      }
      .code { white-space: normal; }
      .id-pill {
        justify-content: flex-end;
        white-space: normal;
        text-align: left;
      }
      .fund-tags { margin-top: 4px; }
      .fund-group-row {
        padding: 0;
        border: 0;
        background: transparent;
      }
      .fund-group-row td {
        position: static;
        display: flex;
        border: 1px solid #d8dee9;
        border-radius: 8px;
        padding: 10px;
        background: #eef3f8;
      }
      .fund-group-row td::before { content: none; }
      .empty-row {
        display: block;
        text-align: center !important;
      }
      .empty-row::before { content: none; }
      #bucketDetails { grid-template-columns: 1fr; }
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
        <div class="fund-table-head">
          <div>
            <h2 id="tableTitle">รายการกองทุน</h2>
            <div id="fundTableSummary" class="table-summary">-</div>
          </div>
          <button id="resetTableBtn" class="small-button">Reset</button>
        </div>
        <div class="table-controls" aria-label="Fund table controls">
          <label>
            <span>ค้นหา</span>
            <input id="fundSearch" type="search" placeholder="ชื่อกองทุน">
          </label>
          <label>
            <span>เรียงลำดับ</span>
            <select id="sortSelect">
              <option value="aum_desc">AUM มากไปน้อย</option>
              <option value="aum_asc">AUM น้อยไปมาก</option>
              <option value="change_desc">Change มากไปน้อย</option>
              <option value="change_asc">Change น้อยไปมาก</option>
              <option value="change_pct_desc">% Change มากไปน้อย</option>
              <option value="date_desc">วันที่ล่าสุดก่อน</option>
              <option value="fund_asc">ชื่อกอง A-Z</option>
              <option value="group_asc">กลุ่ม A-Z</option>
            </select>
          </label>
          <label>
            <span>ประเทศ/ธีม</span>
            <select id="themeFilter"></select>
          </label>
          <label>
            <span>ประเภท</span>
            <select id="typeFilter"></select>
          </label>
          <label>
            <span>ค่าย</span>
            <select id="providerFilter"></select>
          </label>
          <label>
            <span>จัดกลุ่ม</span>
            <select id="groupBySelect">
              <option value="none">ไม่จัดกลุ่ม</option>
              <option value="theme">ตามประเทศ/ธีม</option>
              <option value="type">ตาม RMF/SSF/ทั่วไป</option>
              <option value="provider">ตาม TL/MEGA</option>
              <option value="group">ตามกลุ่มเดิม</option>
            </select>
          </label>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>กองทุน</th><th>กลุ่ม</th><th>Project ID / Class</th><th>AUM ลบ.</th><th>Change</th><th>NAV</th><th>วันที่</th></tr>
            </thead>
            <tbody id="fundRows"></tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>สรุป Bucket</h2></div>
        <div id="bucketDetails"></div>
        <p class="footer-note">หน้า GitHub Pages เป็น static dashboard ที่ workflow จะ rebuild พร้อม refresh AUM history ทุกวันเวลา 09:00 Asia/Bangkok เมื่อ GitHub runner เริ่มทำงาน ส่วนปุ่ม timeline/sort/filter/group ใช้งานได้ทันทีบนข้อมูลล่าสุดที่ deploy แล้ว</p>
      </section>
    </section>
  </main>

  <script>
    const DATA = ${encoded};
    let activeBucketId = DATA.buckets[0]?.id || "";
    let activeDays = 365;
    let fundSort = "aum_desc";
    let groupBy = "none";
    let tableControlsReady = false;
    let tableFilters = {
      search: "",
      theme: "all",
      type: "all",
      provider: "all"
    };
    const rangeLabels = { 365: "1Y", 183: "6M", 92: "3M", 31: "1M" };

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

    function signedDeltaText(value, pct) {
      if (value === null || value === undefined) return "-";
      const sign = value >= 0 ? "+" : "-";
      const pctText = pct === null || pct === undefined ? "" : " (" + sign + fmt.format(Math.abs(pct)) + "%)";
      return sign + fmt.format(Math.abs(value)) + " ลบ." + pctText;
    }

    function activeBucket() {
      return DATA.buckets.find((bucket) => bucket.id === activeBucketId) || DATA.buckets[0];
    }

    function activeRangeLabel() {
      return rangeLabels[activeDays] || activeDays + "D";
    }

    function filteredSeries(bucket) {
      if (!bucket?.series?.length) {
        return { points: [], coverageLabel: "ยังไม่มีข้อมูลจริง" };
      }
      const latestDate = new Date(bucket.series.at(-1).date + "T00:00:00");
      const cutoff = new Date(latestDate);
      cutoff.setDate(cutoff.getDate() - activeDays);
      const points = bucket.series.filter((point) => new Date(point.date + "T00:00:00") >= cutoff);
      const visible = points.length ? points : [bucket.series.at(-1)];
      return {
        points: visible,
        coverageLabel: visible[0].date + " ถึง " + visible.at(-1).date,
        requestedStart: cutoff.toISOString().slice(0, 10)
      };
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

      bindTableControls();
      renderChart(activeBucket());
      renderFunds(activeBucket());
      renderBucketDetails();
    }

    function renderFunds(bucket) {
      document.getElementById("tableTitle").textContent = "รายการกองทุน - " + bucket.name;
      renderFundControls(bucket);
      const funds = filteredFunds(bucket).sort(compareFunds);
      const totalAum = funds.reduce((sum, fund) => sum + (fund.latestAum || 0), 0);
      document.getElementById("fundTableSummary").textContent = "แสดง " + funds.length + "/" + bucket.funds.length + " กอง | รวม " + fmt.format(totalAum) + " ลบ. | " + groupByLabel(groupBy);

      if (!funds.length) {
        document.getElementById("fundRows").innerHTML = '<tr><td colspan="7" class="empty-row">ไม่พบกองทุนตามเงื่อนไขที่เลือก</td></tr>';
        return;
      }

      if (groupBy === "none") {
        document.getElementById("fundRows").innerHTML = funds.map(renderFundRow).join("");
        return;
      }

      document.getElementById("fundRows").innerHTML = groupFunds(funds, groupBy).map((group) => {
        return '<tr class="fund-group-row"><td colspan="7"><span>' + escapeHtml(group.label) + '</span><strong>' +
          group.funds.length + ' กอง | ' + fmt.format(group.totalAum) + ' ลบ.</strong></td></tr>' +
          group.funds.map(renderFundRow).join("");
      }).join("");
    }

    function bindTableControls() {
      if (tableControlsReady) return;
      tableControlsReady = true;
      document.getElementById("fundSearch").addEventListener("input", (event) => {
        tableFilters.search = event.target.value.trim();
        renderFunds(activeBucket());
      });
      document.getElementById("sortSelect").addEventListener("change", (event) => {
        fundSort = event.target.value;
        renderFunds(activeBucket());
      });
      document.getElementById("themeFilter").addEventListener("change", (event) => {
        tableFilters.theme = event.target.value;
        renderFunds(activeBucket());
      });
      document.getElementById("typeFilter").addEventListener("change", (event) => {
        tableFilters.type = event.target.value;
        renderFunds(activeBucket());
      });
      document.getElementById("providerFilter").addEventListener("change", (event) => {
        tableFilters.provider = event.target.value;
        renderFunds(activeBucket());
      });
      document.getElementById("groupBySelect").addEventListener("change", (event) => {
        groupBy = event.target.value;
        renderFunds(activeBucket());
      });
      document.getElementById("resetTableBtn").addEventListener("click", () => {
        fundSort = "aum_desc";
        groupBy = "none";
        tableFilters = { search: "", theme: "all", type: "all", provider: "all" };
        renderFunds(activeBucket());
      });
    }

    function renderFundControls(bucket) {
      const funds = bucket.funds.map(annotateFund);
      const themes = uniqueSorted(funds.map((fund) => fund.theme));
      const types = uniqueSorted(funds.map((fund) => fund.type));
      const providers = uniqueSorted(funds.map((fund) => fund.provider));

      tableFilters.theme = valueOrAll(tableFilters.theme, themes);
      tableFilters.type = valueOrAll(tableFilters.type, types);
      tableFilters.provider = valueOrAll(tableFilters.provider, providers);

      document.getElementById("fundSearch").value = tableFilters.search;
      document.getElementById("sortSelect").value = fundSort;
      document.getElementById("groupBySelect").value = groupBy;
      setOptions(document.getElementById("themeFilter"), [{ value: "all", label: "ทั้งหมด" }].concat(themes.map((value) => ({ value, label: value }))), tableFilters.theme);
      setOptions(document.getElementById("typeFilter"), [{ value: "all", label: "ทั้งหมด" }].concat(types.map((value) => ({ value, label: value }))), tableFilters.type);
      setOptions(document.getElementById("providerFilter"), [{ value: "all", label: "ทั้งหมด" }].concat(providers.map((value) => ({ value, label: value }))), tableFilters.provider);
    }

    function filteredFunds(bucket) {
      const search = tableFilters.search.toLowerCase();
      return bucket.funds.map(annotateFund).filter((fund) => {
        const matchesSearch = !search || [fund.code, fund.group, fund.identifier, fund.theme, fund.type, fund.provider]
          .some((value) => String(value || "").toLowerCase().includes(search));
        return matchesSearch &&
          matchesFilter(fund.theme, tableFilters.theme) &&
          matchesFilter(fund.type, tableFilters.type) &&
          matchesFilter(fund.provider, tableFilters.provider);
      });
    }

    function renderFundRow(fund) {
      const latest = fund.latest || {};
      return '<tr><td class="code" data-label="กองทุน">' + escapeHtml(fund.code) + '</td><td data-label="กลุ่ม">' +
        escapeHtml(fund.group || "-") + '<span class="fund-tags">' + escapeHtml(fund.theme) + ' | ' + escapeHtml(fund.type) + ' | ' + escapeHtml(fund.provider) + '</span></td><td data-label="Project ID / Class"><span class="id-pill">' +
        escapeHtml(fund.identifierType) + ': ' + escapeHtml(fund.identifier) + '</span></td><td data-label="AUM ลบ.">' +
        (latest.aumMillionBaht === undefined ? "-" : fmt.format(latest.aumMillionBaht)) + '</td><td data-label="Change" class="delta ' +
        deltaClass(fund.changeMillionBaht) + '">' + signedDeltaText(fund.changeMillionBaht, fund.changePct) + '</td><td data-label="NAV">' +
        (latest.nav === undefined ? "-" : fmt.format(latest.nav)) + '</td><td data-label="วันที่">' + escapeHtml(latest.navDate || "-") + '</td></tr>';
    }

    function annotateFund(fund) {
      return Object.assign({}, fund, {
        latestAum: fund.latest?.aumMillionBaht ?? null,
        latestDate: fund.latest?.navDate ?? "",
        theme: detectTheme(fund),
        type: detectFundType(fund),
        provider: detectProvider(fund)
      });
    }

    function compareFunds(a, b) {
      switch (fundSort) {
        case "aum_asc":
          return compareNullableNumber(a.latestAum, b.latestAum, "asc") || a.code.localeCompare(b.code);
        case "change_desc":
          return compareNullableNumber(a.changeMillionBaht, b.changeMillionBaht, "desc") || a.code.localeCompare(b.code);
        case "change_asc":
          return compareNullableNumber(a.changeMillionBaht, b.changeMillionBaht, "asc") || a.code.localeCompare(b.code);
        case "change_pct_desc":
          return compareNullableNumber(a.changePct, b.changePct, "desc") || a.code.localeCompare(b.code);
        case "date_desc":
          return String(b.latestDate).localeCompare(String(a.latestDate)) || compareNullableNumber(a.latestAum, b.latestAum, "desc");
        case "fund_asc":
          return a.code.localeCompare(b.code);
        case "group_asc":
          return a.group.localeCompare(b.group) || a.code.localeCompare(b.code);
        case "aum_desc":
        default:
          return compareNullableNumber(a.latestAum, b.latestAum, "desc") || a.code.localeCompare(b.code);
      }
    }

    function groupFunds(funds, selectedGroupBy) {
      const keyFor = (fund) => {
        if (selectedGroupBy === "theme") return fund.theme;
        if (selectedGroupBy === "type") return fund.type;
        if (selectedGroupBy === "provider") return fund.provider;
        return fund.group;
      };
      const groups = new Map();
      for (const fund of funds) {
        const key = keyFor(fund) || "-";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(fund);
      }
      return Array.from(groups.entries()).map(([label, groupFunds]) => ({
        label,
        funds: groupFunds,
        totalAum: groupFunds.reduce((sum, fund) => sum + (fund.latestAum || 0), 0)
      })).sort((a, b) => b.totalAum - a.totalAum || a.label.localeCompare(b.label));
    }

    function detectTheme(fund) {
      const code = fund.code.toUpperCase();
      const group = String(fund.group || "").toUpperCase();
      if (group.includes("CHINA") || code.includes("CHINA")) return "China";
      if (group.includes("EURO") || code.includes("EURO")) return "Euro";
      if (group.includes("THAILAND") || code.includes("THAI") || code.includes("TX8020")) return "Thailand";
      if (group.includes("TLUSHD") || code.includes("USHD")) return "US High Dividend";
      if (group.includes("YIELDTECH") || code.includes("INCOME")) return "Income / High Dividend";
      if (group.includes("WORLD") || code.includes("WORLD")) return "World";
      if (group.includes("US") || code.includes("US") || code.includes("NDQ") || code.includes("10-A") || code.includes("10AI")) return "US";
      return fund.group || "Other";
    }

    function detectFundType(fund) {
      const code = fund.code.toUpperCase();
      if (code.includes("RMF")) return "RMF";
      if (code.includes("SSF")) return "SSF";
      if (code.includes("ESG")) return "Thai ESG";
      return "กองปกติ";
    }

    function detectProvider(fund) {
      const code = fund.code.toUpperCase();
      if (code.startsWith("TL")) return "TL / Talis";
      if (code.startsWith("MEGA")) return "MEGA";
      return fund.source || "Other";
    }

    function compareNullableNumber(a, b, direction) {
      const aMissing = a === null || a === undefined || Number.isNaN(Number(a));
      const bMissing = b === null || b === undefined || Number.isNaN(Number(b));
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      return direction === "asc" ? Number(a) - Number(b) : Number(b) - Number(a);
    }

    function uniqueSorted(values) {
      return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
    }

    function setOptions(select, options, selected) {
      select.innerHTML = options.map((option) => '<option value="' + escapeHtml(option.value) + '"' +
        (option.value === selected ? ' selected' : '') + '>' + escapeHtml(option.label) + '</option>').join("");
    }

    function valueOrAll(value, available) {
      return value === "all" || available.includes(value) ? value : "all";
    }

    function matchesFilter(value, filter) {
      return filter === "all" || value === filter;
    }

    function groupByLabel(value) {
      const labels = {
        none: "ไม่จัดกลุ่ม",
        theme: "จัดกลุ่มตามประเทศ/ธีม",
        type: "จัดกลุ่มตาม RMF/SSF/ทั่วไป",
        provider: "จัดกลุ่มตาม TL/MEGA",
        group: "จัดกลุ่มตามกลุ่มเดิม"
      };
      return labels[value] || labels.none;
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function renderBucketDetails() {
      document.getElementById("bucketDetails").innerHTML = DATA.buckets.map((bucket) => {
        const latest = bucket.series.at(-1);
        return '<div>' +
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
      const range = filteredSeries(bucket);
      const points = range.points;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      if (!points.length) {
        document.getElementById("chartMeta").textContent = bucket.name + " | " + range.coverageLabel;
        return;
      }

      if (points.length === 1) {
        const point = points[0];
        const cx = width / 2;
        const cy = height / 2;
        ctx.strokeStyle = "#e5e9f2";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left, cy);
        ctx.lineTo(width - pad.right, cy);
        ctx.stroke();
        ctx.fillStyle = bucket.color || "#1f5fbf";
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#13233a";
        ctx.font = "700 18px Segoe UI, Tahoma, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(fmt.format(point.totalMillionBaht) + " ล้านบาท", cx, cy - 22);
        ctx.fillStyle = "#667085";
        ctx.font = "13px Segoe UI, Tahoma, sans-serif";
        ctx.fillText("ข้อมูลจริงที่มีตอนนี้ 1 จุด: " + point.date, cx, cy + 34);
        ctx.textAlign = "left";
        document.getElementById("chartMeta").textContent = bucket.name + " | Timeline " + activeRangeLabel() + " | Actual coverage " + range.coverageLabel + " | 1 จุดข้อมูลจริง";
        return;
      }

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
      document.getElementById("chartMeta").textContent = bucket.name + " | Timeline " + activeRangeLabel() + " | Actual coverage " + range.coverageLabel + " | " + points.length + " จุดข้อมูล";
    }

    render();
  </script>
</body>
</html>`;
}
