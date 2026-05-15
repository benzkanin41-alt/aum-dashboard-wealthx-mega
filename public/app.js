let state = { data: null, activeBucket: "wealthx_other", days: 365 };
const ranges = { 365: "1Y", 183: "6M", 92: "3M", 31: "1M" };

const $ = (id) => document.getElementById(id);

init();

async function init() {
  $("refreshBtn").addEventListener("click", () => refresh(false));
  $("fullRefreshBtn").addEventListener("click", () => refresh(true));
  $("rangeButtons").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-days]");
    if (!button) return;
    state.days = Number(button.dataset.days);
    render();
  });
  await loadData();
  setInterval(loadStatus, 15000);
  setInterval(loadData, 300000);
}

async function loadData() {
  const response = await fetch("/api/dashboard");
  state.data = await response.json();
  render();
  await loadStatus();
}

async function loadStatus() {
  const response = await fetch("/api/refresh/status");
  const status = await response.json();
  const progress = status.progress?.total ? ` ${status.progress.done}/${status.progress.total}` : "";
  $("statusText").textContent = `${status.message || "idle"}${progress}`;
  $("lastUpdate").textContent = status.finishedAt ? formatDateTime(status.finishedAt) : "-";
  if (status.errors?.length) showToast(status.errors[0], 6000);
}

async function refresh(full) {
  showToast(full ? "Starting full 1Y refresh" : "Starting daily refresh");
  await fetch(`/api/refresh${full ? "?full=1" : ""}`, { method: "POST" });
  await loadStatus();
}

function render() {
  if (!state.data) return;
  renderCards();
  renderTabs();
  renderBucket();
}

function renderCards() {
  $("summaryCards").innerHTML = state.data.buckets.map((bucket) => {
    const baseline = state.data.baseline?.buckets?.[bucket.id];
    const value = bucket.latestTotal ?? baseline?.aumMillionBaht ?? null;
    const delta = bucket.changeMillionBaht ?? baseline?.changeMillionBaht ?? null;
    const pct = bucket.changePct ?? baseline?.changePct ?? null;
    const source = bucket.latestTotal === null && baseline ? `manual baseline | ${bucket.funds.length} funds` : `${bucket.funds.length} funds`;
    return `
      <article class="summary-card" style="--accent:${bucket.color}">
        <div class="title">${bucket.name}</div>
        <div class="value">${value === null ? "-" : money(value)}</div>
        <div class="${deltaClass(delta)} delta">${formatDelta(delta, pct)}</div>
          <span class="label">${source}${bucket.latestTotal === null ? " | waiting for live AUM" : ""}</span>
      </article>
    `;
  }).join("");
}

function renderTabs() {
  $("bucketTabs").innerHTML = state.data.buckets.map((bucket) => `
    <button class="${bucket.id === state.activeBucket ? "active" : ""}" data-bucket="${bucket.id}">${bucket.name}</button>
  `).join("");
  $("bucketTabs").onclick = (event) => {
    const button = event.target.closest("button[data-bucket]");
    if (!button) return;
    state.activeBucket = button.dataset.bucket;
    render();
  };
}

function renderBucket() {
  const bucket = activeBucket();
  if (!bucket) return;
  $("bucketTitle").textContent = bucket.name;
  $("bucketDesc").textContent = bucket.description;
  document.querySelectorAll("#rangeButtons button").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.days) === state.days);
  });
  renderChart(bucket);
  renderMix(bucket);
  renderTable(bucket);
}

function renderChart(bucket) {
  const svg = $("aumChart");
  const points = filterRange(bucket.series, state.days);
  const width = svg.clientWidth || 900;
  const height = svg.clientHeight || 360;
  const pad = { top: 28, right: 24, bottom: 48, left: 74 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  if (points.length < 2) {
    svg.innerHTML = `
      <text x="50%" y="46%" text-anchor="middle" fill="#17202a" font-size="15" font-weight="700">${bucket.funds.length} configured funds</text>
      <text x="50%" y="54%" text-anchor="middle" fill="#687382">No live AUM history yet. SEC API currently returns 401 authorization error.</text>
    `;
    return;
  }

  const values = points.map((point) => point.totalMillionBaht);
  const min = Math.min(...values) * 0.98;
  const max = Math.max(...values) * 1.02;
  const x = (i) => pad.left + (i / Math.max(1, points.length - 1)) * innerW;
  const y = (value) => pad.top + (1 - ((value - min) / (max - min || 1))) * innerH;
  const line = points.map((point, i) => `${x(i)},${y(point.totalMillionBaht)}`).join(" ");
  const area = `${pad.left},${pad.top + innerH} ${line} ${pad.left + innerW},${pad.top + innerH}`;
  const ticks = [0, .25, .5, .75, 1].map((ratio) => {
    const value = min + (max - min) * (1 - ratio);
    const yy = pad.top + innerH * ratio;
    return `
      <line x1="${pad.left}" x2="${pad.left + innerW}" y1="${yy}" y2="${yy}" stroke="#e5e7eb"/>
      <text x="${pad.left - 10}" y="${yy + 4}" text-anchor="end" fill="#687382" font-size="12">${shortMoney(value)}</text>
    `;
  }).join("");

  const start = points[0];
  const mid = points[Math.floor(points.length / 2)];
  const end = points.at(-1);
  svg.innerHTML = `
    <defs>
      <linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="${bucket.color}" stop-opacity=".22"/>
        <stop offset="100%" stop-color="${bucket.color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${ticks}
    <polyline points="${area}" fill="url(#areaGradient)"/>
    <polyline points="${line}" fill="none" stroke="${bucket.color}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${x(points.length - 1)}" cy="${y(end.totalMillionBaht)}" r="5" fill="${bucket.color}"/>
    <text x="${pad.left}" y="${height - 18}" fill="#687382" font-size="12">${start.date}</text>
    <text x="${pad.left + innerW / 2}" y="${height - 18}" text-anchor="middle" fill="#687382" font-size="12">${mid.date}</text>
    <text x="${pad.left + innerW}" y="${height - 18}" text-anchor="end" fill="#687382" font-size="12">${end.date}</text>
    <text x="${pad.left}" y="22" fill="#17202a" font-size="13" font-weight="700">${ranges[state.days]} AUM history: ${money(end.totalMillionBaht)} ล้านบาท</text>
    <text x="${pad.left + innerW}" y="22" text-anchor="end" fill="#687382" font-size="12">${points.length} points</text>
  `;
}

function renderMix(bucket) {
  const byGroup = new Map();
  for (const fund of bucket.funds) {
    const aum = fund.latest?.aumMillionBaht || 0;
    byGroup.set(fund.group, (byGroup.get(fund.group) || 0) + aum);
  }
  const total = [...byGroup.values()].reduce((sum, value) => sum + value, 0);
  const rows = [...byGroup.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([group, value]) => {
      const pct = total ? (value / total) * 100 : 0;
      return `
        <div class="mix-row">
          <header><span>${group}</span><span>${money(value)} ลบ.</span></header>
          <div class="bar"><span style="--w:${pct}%;--accent:${bucket.color}"></span></div>
        </div>
      `;
    }).join("");
  $("groupMix").innerHTML = rows || `<span class="muted">No live group data yet.</span>`;
}

function renderTable(bucket) {
  $("fundRows").innerHTML = bucket.funds
    .slice()
    .sort((a, b) => (b.latest?.aumMillionBaht || 0) - (a.latest?.aumMillionBaht || 0))
    .map((fund) => `
      <tr>
        <td><strong>${fund.code}</strong></td>
        <td>${fund.group}</td>
        <td><span class="id-pill">${fund.identifierType}: ${fund.identifier}</span></td>
        <td>${fund.latest?.aumMillionBaht === null || fund.latest?.aumMillionBaht === undefined ? "-" : money(fund.latest.aumMillionBaht)}</td>
        <td class="${deltaClass(fund.changeMillionBaht)}">${formatDelta(fund.changeMillionBaht, fund.changePct)}</td>
        <td>${fund.latest?.nav ?? "-"}</td>
        <td>${fund.latest?.navDate ?? "-"}</td>
        <td>${fund.source || "user list"}</td>
      </tr>
    `).join("");
}

function activeBucket() {
  return state.data.buckets.find((bucket) => bucket.id === state.activeBucket) || state.data.buckets[0];
}

function filterRange(series, days) {
  if (!series.length) return [];
  const end = new Date(series.at(-1).date);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return series.filter((point) => new Date(point.date) >= start);
}

function money(value) {
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortMoney(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toFixed(0);
}

function formatDelta(delta, pct) {
  if (delta === null || delta === undefined) return "-";
  const sign = delta > 0 ? "+" : "";
  const pctText = pct === null || pct === undefined ? "" : ` (${sign}${pct.toFixed(2)}%)`;
  return `${sign}${money(delta)} ลบ.${pctText}`;
}

function deltaClass(delta) {
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(new Date(value));
}

function showToast(message, ms = 3500) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), ms);
}
