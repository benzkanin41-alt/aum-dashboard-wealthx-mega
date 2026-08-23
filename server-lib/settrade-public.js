import vm from "node:vm";

const SETTRADE_OVERVIEW_URL = "https://www.settrade.com/th/mutualfund/quote";

export async function fetchSettradeFundHistory(symbol) {
  const url = `${SETTRADE_OVERVIEW_URL}/${encodeURIComponent(symbol)}/overview`;
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 AUM dashboard"
    }
  });
  if (!response.ok) throw new Error(`Settrade ${symbol} ${response.status}: ${response.statusText}`);

  const html = await response.text();
  const state = extractNuxtState(html);
  const overview = state?.mutualfund?.overviewInfo || {};
  const quotations = state?.mutualfund?.quotationChart?.quotations || [];
  const rows = filterSeedPlaceholderRows(quotations.map((row) => normalizeQuotation(row, symbol, url)).filter(Boolean));

  if (!rows.length) {
    const latest = normalizeOverview(overview, symbol, url);
    if (latest && !isSeedPlaceholder(latest)) rows.push(latest);
  }

  return {
    symbol,
    overview,
    rows: rows.sort((a, b) => a.navDate.localeCompare(b.navDate))
  };
}

export async function mergeSettradeHistoryRows({ config, history }) {
  let imported = 0;
  const funds = flattenFunds(config).filter((fund) => fund.dataSource === "settrade");
  const summary = [];

  for (const fund of funds) {
    try {
      const result = await fetchSettradeFundHistory(fund.code);
      history[fund.code] ||= {};
      purgeSettradeSeedPlaceholders(history[fund.code]);
      for (const row of result.rows) {
        history[fund.code][row.navDate] = {
          code: fund.code,
          group: fund.group,
          projId: fund.identifierType === "proj_id" ? fund.identifier : null,
          navDate: row.navDate,
          aumMillionBaht: row.aumMillionBaht,
          nav: row.nav,
          raw: {
            fundName: result.overview?.name || fund.code,
            netAsset: row.netAsset,
            source: row.source,
            settradeSymbol: fund.code,
            amcName: result.overview?.amcName || null,
            factsheetUrl: result.overview?.factsheetUrl || null
          }
        };
        imported += 1;
      }
      summary.push({
        code: fund.code,
        rows: result.rows.length,
        first: result.rows[0]?.navDate || null,
        last: result.rows.at(-1)?.navDate || null
      });
    } catch (error) {
      summary.push({ code: fund.code, error: error.message });
    }
  }

  return { imported, funds: summary };
}

function filterSeedPlaceholderRows(rows) {
  const sorted = rows.sort((a, b) => a.navDate.localeCompare(b.navDate));
  return sorted.filter((row) => !isSeedPlaceholder(row));
}

function purgeSettradeSeedPlaceholders(fundHistory) {
  for (const [date, point] of Object.entries(fundHistory || {})) {
    const row = { netAsset: point?.raw?.netAsset, nav: point?.nav };
    if (point?.raw?.settradeSymbol && isSeedPlaceholder(row)) delete fundHistory[date];
  }
}

function isSeedPlaceholder(row) {
  const netAsset = Number(row?.netAsset);
  const nav = Number(row?.nav);

  // Settrade can expose registered project capital as a NAV-10 row before launch.
  return nav === 10 && netAsset >= 1_000_000_000 && netAsset % 1_000_000_000 === 0;
}

function extractNuxtState(html) {
  const match = html.match(/<script>window\.__NUXT__=([\s\S]*?)<\/script>/);
  if (!match) throw new Error("Settrade Nuxt state not found");
  const context = { window: {} };
  vm.runInNewContext(`window.__NUXT__=${match[1]}`, context, { timeout: 5000 });
  return context.window.__NUXT__?.state || {};
}

function normalizeQuotation(row, symbol, source) {
  const navDate = toDateOnly(row.date);
  const netAsset = numberFrom(row.nav);
  const nav = numberFrom(row.navPerUnit);
  if (!navDate || netAsset === null || nav === null) return null;
  return {
    code: symbol,
    navDate,
    nav,
    netAsset,
    aumMillionBaht: round2(netAsset / 1_000_000),
    source
  };
}

function normalizeOverview(overview, symbol, source) {
  const navDate = toDateOnly(overview.date);
  const netAsset = numberFrom(overview.nav);
  const nav = numberFrom(overview.navPerUnit);
  if (!navDate || netAsset === null || nav === null) return null;
  return {
    code: symbol,
    navDate,
    nav,
    netAsset,
    aumMillionBaht: round2(netAsset / 1_000_000),
    source
  };
}

function flattenFunds(config) {
  return config.buckets.flatMap((bucket) => bucket.funds.map((fund) => ({ ...fund, bucketId: bucket.id })));
}

function toDateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function numberFrom(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
}

function round2(number) {
  return Math.round(Number(number) * 100) / 100;
}
