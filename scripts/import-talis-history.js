import fs from "node:fs/promises";
import path from "node:path";
import { fetchTalisFundHistory, fetchTalisPublicNav, mergeTalisRowsIntoHistory, purgeEstimatedHistory } from "../server-lib/talis-public.js";

const ROOT = process.cwd();
const configPath = path.join(ROOT, "config", "funds.json");
const historyPath = path.join(ROOT, "data", "nav-history.json");
const days = Number(process.argv.find((arg) => arg.startsWith("--days="))?.split("=")[1] || 365);

const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const funds = flattenFunds(config);
let history = {};
try {
  history = JSON.parse(await fs.readFile(historyPath, "utf8"));
} catch {
  history = {};
}

const latestRows = await fetchTalisPublicNav();
const latestByCode = new Map(latestRows.map((row) => [row.code, row]));
const cutoff = cutoffDate(latestRows, days);
const removedEstimatedRows = purgeEstimatedHistory(history);
const latestImport = mergeTalisRowsIntoHistory({ config, history, rows: latestRows });

const summary = {
  days,
  cutoff,
  latestRows: latestRows.length,
  removedEstimatedRows,
  latestImported: latestImport.imported,
  importedHistoryRows: 0,
  funds: []
};

for (const fund of funds) {
  const latest = latestByCode.get(fund.code);
  if (!latest?.talisFundCode) {
    summary.funds.push({ code: fund.code, status: "missing_talis_fund_code" });
    continue;
  }

  const rows = await fetchTalisFundHistory(latest.talisFundCode);
  const selected = rows.filter((row) => row.navDate >= cutoff);
  history[fund.code] ||= {};

  for (const row of selected) {
    history[fund.code][row.navDate] = {
      code: fund.code,
      group: fund.group,
      projId: fund.identifierType === "proj_id" ? fund.identifier : null,
      navDate: row.navDate,
      aumMillionBaht: row.aumMillionBaht,
      nav: row.nav,
      raw: {
        fundName: latest.fundName,
        netAsset: row.netAsset,
        source: row.source,
        talisFundCode: latest.talisFundCode
      }
    };
    summary.importedHistoryRows += 1;
  }

  summary.funds.push({
    code: fund.code,
    talisFundCode: latest.talisFundCode,
    rows: selected.length,
    first: selected[0]?.navDate || null,
    last: selected.at(-1)?.navDate || null
  });
}

history = pruneHistory(history, new Set(funds.map((fund) => fund.code)), cutoff);
await fs.mkdir(path.dirname(historyPath), { recursive: true });
await fs.writeFile(historyPath, `${JSON.stringify(sortHistory(history), null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));

function flattenFunds(config) {
  return config.buckets.flatMap((bucket) => bucket.funds.map((fund) => ({ ...fund, bucketId: bucket.id })));
}

function cutoffDate(rows, days) {
  const latestDate = rows
    .map((row) => row.navDate)
    .filter(Boolean)
    .sort()
    .at(-1);
  const end = latestDate ? new Date(`${latestDate}T00:00:00Z`) : new Date();
  end.setUTCDate(end.getUTCDate() - days);
  return end.toISOString().slice(0, 10);
}

function sortHistory(history) {
  const output = {};
  for (const code of Object.keys(history).sort()) {
    output[code] = {};
    for (const date of Object.keys(history[code] || {}).sort()) {
      output[code][date] = history[code][date];
    }
  }
  return output;
}

function pruneHistory(history, trackedCodes, cutoff) {
  const output = {};
  for (const [code, fundHistory] of Object.entries(history || {})) {
    if (!trackedCodes.has(code)) continue;
    output[code] = {};
    for (const [date, point] of Object.entries(fundHistory || {})) {
      if (date >= cutoff && point?.navDate >= cutoff) output[code][date] = point;
    }
    if (!Object.keys(output[code]).length) delete output[code];
  }
  return output;
}
