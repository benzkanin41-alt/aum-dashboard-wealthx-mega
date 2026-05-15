const TALIS_NAV_URL = "https://nav.talisam.co.th/index_NAV_Sum.jsp?p_lang=EN";

export async function fetchTalisPublicNav() {
  const response = await fetch(TALIS_NAV_URL, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 AUM dashboard"
    }
  });
  if (!response.ok) throw new Error(`Talis NAV ${response.status}: ${response.statusText}`);
  const html = await response.text();
  return parseTalisNavRows(html);
}

export function parseTalisNavRows(html) {
  const rows = [];
  const trMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const tr of trMatches) {
    const cells = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => cleanCell(match[1]));
    if (cells.length < 8) continue;

    const codeIndex = cells.findIndex((cell) => /^[A-Z0-9-]+$/.test(cell) && /[A-Z]/.test(cell));
    if (codeIndex < 1) continue;

    const code = cells[codeIndex].trim();
    const nav = toNumber(cells[codeIndex + 1]);
    const netAsset = toNumber(cells[codeIndex + 2]);
    const change = toNumber(cells[codeIndex + 5]);
    const changePct = toNumber(cells[codeIndex + 6]);
    const navDate = toIsoDate(cells[codeIndex + 7]);

    if (!code || nav === null || netAsset === null || !navDate) continue;
    rows.push({
      code,
      fundName: cells[codeIndex - 1],
      nav,
      netAsset,
      aumMillionBaht: round2(netAsset / 1_000_000),
      change,
      changePct,
      navDate,
      source: TALIS_NAV_URL
    });
  }
  return rows;
}

export function mergeTalisRowsIntoHistory({ config, history, rows }) {
  const byCode = new Map(rows.map((row) => [row.code, row]));
  let imported = 0;

  for (const bucket of config.buckets || []) {
    for (const fund of bucket.funds || []) {
      const row = byCode.get(fund.code);
      if (!row) continue;
      history[fund.code] ||= {};
      history[fund.code][row.navDate] = {
        code: fund.code,
        group: fund.group,
        projId: fund.identifierType === "proj_id" ? fund.identifier : null,
        navDate: row.navDate,
        aumMillionBaht: row.aumMillionBaht,
        nav: row.nav,
        raw: {
          fundName: row.fundName,
          netAsset: row.netAsset,
          change: row.change,
          changePct: row.changePct,
          source: row.source
        }
      };
      imported += 1;
    }
  }

  return { imported, availableRows: rows.length };
}

export function purgeEstimatedHistory(history) {
  let removed = 0;
  for (const [code, fundHistory] of Object.entries(history || {})) {
    for (const [date, point] of Object.entries(fundHistory || {})) {
      if (point?.raw?.estimated) {
        delete history[code][date];
        removed += 1;
      }
    }
    if (Object.keys(history[code] || {}).length === 0) delete history[code];
  }
  return removed;
}

function cleanCell(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value) {
  if (!value) return null;
  const match = String(value).replace(/,/g, "").match(/[+-]?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function toIsoDate(value) {
  const match = String(value || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function round2(number) {
  return Math.round(Number(number) * 100) / 100;
}
