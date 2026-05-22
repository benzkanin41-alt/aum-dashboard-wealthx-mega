let state = {
  data: null,
  activeBucket: "wealthx_other",
  days: 365,
  fundSort: "aum_desc",
  groupBy: "none",
  tableFilters: {
    search: "",
    theme: "all",
    type: "all",
    provider: "all"
  }
};
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
  $("fundSearch").addEventListener("input", (event) => {
    state.tableFilters.search = event.target.value.trim();
    renderBucket();
  });
  $("sortSelect").addEventListener("change", (event) => {
    state.fundSort = event.target.value;
    renderBucket();
  });
  $("themeFilter").addEventListener("change", (event) => {
    state.tableFilters.theme = event.target.value;
    renderBucket();
  });
  $("typeFilter").addEventListener("change", (event) => {
    state.tableFilters.type = event.target.value;
    renderBucket();
  });
  $("providerFilter").addEventListener("change", (event) => {
    state.tableFilters.provider = event.target.value;
    renderBucket();
  });
  $("groupBySelect").addEventListener("change", (event) => {
    state.groupBy = event.target.value;
    renderBucket();
  });
  $("resetTableBtn").addEventListener("click", () => {
    state.fundSort = "aum_desc";
    state.groupBy = "none";
    state.tableFilters = { search: "", theme: "all", type: "all", provider: "all" };
    renderBucket();
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
  renderFundControls(bucket);
  renderTable(bucket);
}

function renderChart(bucket) {
  const svg = $("aumChart");
  const range = filterRange(bucket.series, state.days);
  const points = range.points;
  const width = svg.clientWidth || 900;
  const height = svg.clientHeight || 360;
  const pad = { top: 28, right: 24, bottom: 48, left: 74 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  renderChartMeta(bucket, range);

  if (!points.length) {
    svg.innerHTML = `
      <text x="50%" y="46%" text-anchor="middle" fill="#17202a" font-size="15" font-weight="700">${bucket.funds.length} configured funds</text>
      <text x="50%" y="54%" text-anchor="middle" fill="#687382">ยังไม่มีข้อมูลจริงสะสมสำหรับกราฟ</text>
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
  if (points.length === 1) {
    const cx = pad.left + innerW / 2;
    const cy = pad.top + innerH / 2;
    svg.innerHTML = `
      <line x1="${pad.left}" x2="${pad.left + innerW}" y1="${cy}" y2="${cy}" stroke="#e5e7eb"/>
      <circle cx="${cx}" cy="${cy}" r="7" fill="${bucket.color}"/>
      <text x="${cx}" y="${cy - 18}" text-anchor="middle" fill="#17202a" font-size="15" font-weight="800">${money(end.totalMillionBaht)} ล้านบาท</text>
      <text x="${cx}" y="${cy + 30}" text-anchor="middle" fill="#687382" font-size="12">ข้อมูลจริงที่มีตอนนี้ 1 จุด: ${end.date}</text>
      <text x="${pad.left}" y="22" fill="#17202a" font-size="13" font-weight="700">${ranges[state.days]} actual AUM history</text>
      <text x="${pad.left + innerW}" y="22" text-anchor="end" fill="#687382" font-size="12">${range.coverageLabel}</text>
    `;
    return;
  }

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
    <text x="${pad.left}" y="22" fill="#17202a" font-size="13" font-weight="700">${ranges[state.days]} actual AUM history: ${money(end.totalMillionBaht)} ล้านบาท</text>
    <text x="${pad.left + innerW}" y="22" text-anchor="end" fill="#687382" font-size="12">${points.length} points | ${range.coverageLabel}</text>
  `;
}

function renderChartMeta(bucket, range) {
  const selected = ranges[state.days] || `${state.days}D`;
  const all = bucket.series || [];
  const hasMoreThanRange = range.points.length < all.length;
  const mode = hasMoreThanRange
    ? `แสดงตามช่วง ${selected}`
    : `แสดงข้อมูลจริงเท่าที่มีในช่วง ${selected}`;
  $("chartMeta").innerHTML = `
    <span>Timeline: ${selected}</span>
    <span>${mode}</span>
    <span>Actual coverage: ${range.coverageLabel}</span>
    <span>${range.points.length} จุดข้อมูล</span>
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
  const funds = filteredFunds(bucket).sort(compareFunds);
  const totalAum = funds.reduce((sum, fund) => sum + (fund.latestAum || 0), 0);
  $("fundTableSummary").textContent = `แสดง ${funds.length}/${bucket.funds.length} กอง | รวม ${money(totalAum)} ลบ. | ${groupByLabel(state.groupBy)}`;

  if (!funds.length) {
    $("fundRows").innerHTML = `
      <tr>
        <td colspan="8" class="empty-row">ไม่พบกองทุนตามเงื่อนไขที่เลือก</td>
      </tr>
    `;
    return;
  }

  if (state.groupBy === "none") {
    $("fundRows").innerHTML = funds.map(renderFundRow).join("");
    return;
  }

  $("fundRows").innerHTML = groupFunds(funds, state.groupBy)
    .map((group) => `
      <tr class="fund-group-row">
        <td colspan="8">
          <span>${escapeHtml(group.label)}</span>
          <strong>${group.funds.length} กอง | ${money(group.totalAum)} ลบ.</strong>
        </td>
      </tr>
      ${group.funds.map(renderFundRow).join("")}
    `).join("");
}

function renderFundControls(bucket) {
  const funds = bucket.funds.map(annotateFund);
  const themes = uniqueSorted(funds.map((fund) => fund.theme));
  const types = uniqueSorted(funds.map((fund) => fund.type));
  const providers = uniqueSorted(funds.map((fund) => fund.provider));

  state.tableFilters.theme = valueOrAll(state.tableFilters.theme, themes);
  state.tableFilters.type = valueOrAll(state.tableFilters.type, types);
  state.tableFilters.provider = valueOrAll(state.tableFilters.provider, providers);

  $("fundSearch").value = state.tableFilters.search;
  $("sortSelect").value = state.fundSort;
  $("groupBySelect").value = state.groupBy;
  setOptions($("themeFilter"), [{ value: "all", label: "ทั้งหมด" }, ...themes.map((value) => ({ value, label: value }))], state.tableFilters.theme);
  setOptions($("typeFilter"), [{ value: "all", label: "ทั้งหมด" }, ...types.map((value) => ({ value, label: value }))], state.tableFilters.type);
  setOptions($("providerFilter"), [{ value: "all", label: "ทั้งหมด" }, ...providers.map((value) => ({ value, label: value }))], state.tableFilters.provider);
}

function filteredFunds(bucket) {
  const search = state.tableFilters.search.toLowerCase();
  return bucket.funds
    .map(annotateFund)
    .filter((fund) => {
      const matchesSearch = !search || [fund.code, fund.group, fund.identifier, fund.theme, fund.type, fund.provider]
        .some((value) => String(value || "").toLowerCase().includes(search));
      return matchesSearch
        && matchesFilter(fund.theme, state.tableFilters.theme)
        && matchesFilter(fund.type, state.tableFilters.type)
        && matchesFilter(fund.provider, state.tableFilters.provider);
    });
}

function renderFundRow(fund) {
  return `
    <tr>
      <td><strong>${escapeHtml(fund.code)}</strong></td>
      <td>
        <span>${escapeHtml(fund.group)}</span>
        <span class="fund-tags">${escapeHtml(fund.theme)} | ${escapeHtml(fund.type)} | ${escapeHtml(fund.provider)}</span>
      </td>
      <td><span class="id-pill">${escapeHtml(fund.identifierType)}: ${escapeHtml(fund.identifier)}</span></td>
      <td>${fund.latestAum === null || fund.latestAum === undefined ? "-" : money(fund.latestAum)}</td>
      <td class="${deltaClass(fund.changeMillionBaht)}">${formatDelta(fund.changeMillionBaht, fund.changePct)}</td>
      <td>${fund.latest?.nav ?? "-"}</td>
      <td>${fund.latest?.navDate ?? "-"}</td>
      <td>${escapeHtml(fund.source || "user list")}</td>
    </tr>
  `;
}

function annotateFund(fund) {
  return {
    ...fund,
    latestAum: fund.latest?.aumMillionBaht ?? null,
    latestDate: fund.latest?.navDate ?? "",
    theme: detectTheme(fund),
    type: detectFundType(fund),
    provider: detectProvider(fund)
  };
}

function compareFunds(a, b) {
  switch (state.fundSort) {
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

function groupFunds(funds, groupBy) {
  const keyFor = (fund) => {
    if (groupBy === "theme") return fund.theme;
    if (groupBy === "type") return fund.type;
    if (groupBy === "provider") return fund.provider;
    return fund.group;
  };
  const groups = new Map();
  for (const fund of funds) {
    const key = keyFor(fund) || "-";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fund);
  }
  return [...groups.entries()]
    .map(([label, groupFunds]) => ({
      label,
      funds: groupFunds,
      totalAum: groupFunds.reduce((sum, fund) => sum + (fund.latestAum || 0), 0)
    }))
    .sort((a, b) => b.totalAum - a.totalAum || a.label.localeCompare(b.label));
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
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function setOptions(select, options, selected) {
  select.innerHTML = options.map((option) => `
    <option value="${escapeHtml(option.value)}"${option.value === selected ? " selected" : ""}>${escapeHtml(option.label)}</option>
  `).join("");
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

function activeBucket() {
  return state.data.buckets.find((bucket) => bucket.id === state.activeBucket) || state.data.buckets[0];
}

function filterRange(series, days) {
  if (!series.length) {
    return {
      points: [],
      coverageLabel: "ยังไม่มีข้อมูลจริง",
      requestedStart: null
    };
  }
  const end = new Date(series.at(-1).date);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  const points = series.filter((point) => new Date(point.date) >= start);
  const visible = points.length ? points : [series.at(-1)];
  return {
    points: visible,
    coverageLabel: `${visible[0].date} ถึง ${visible.at(-1).date}`,
    requestedStart: start.toISOString().slice(0, 10)
  };
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
