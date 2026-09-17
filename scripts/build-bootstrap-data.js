import { readFile, writeFile } from "node:fs/promises";
import { flattenFunds } from "../shared/model.js";
import { dataPath } from "../server-lib/local-paths.js";

const config = JSON.parse(await readFile(new URL("../config/funds.json", import.meta.url), "utf8"));
const history = JSON.parse(await readFile(dataPath("nav-history.json"), "utf8"));
const aua = JSON.parse(await readFile(dataPath("official-aua.json"), "utf8"));
const now = new Date().toISOString();
const funds = flattenFunds(config).map((fund) => {
  const dates = Object.keys(history[fund.code] || {}).sort();
  return {
    id: fund.code,
    code: fund.code,
    bucketId: fund.bucketId,
    bucketName: fund.bucketName,
    groupName: fund.group || null,
    identifierType: fund.identifierType || null,
    identifier: fund.identifier || null,
    dataSource: fund.dataSource,
    sourceLabel: fund.source || null,
    inceptionDate: dates[0] || null
  };
});
const aumPoints = [];
for (const fund of funds) {
  for (const point of Object.values(history[fund.code] || {})) {
    aumPoints.push({
      fundId: fund.code,
      asOfDate: point.navDate,
      aumMillionBaht: Number(point.aumMillionBaht),
      navPerUnit: Number.isFinite(Number(point.nav)) ? Number(point.nav) : null,
      sourceUrl: point.raw?.source || null
    });
  }
}
aumPoints.sort((a, b) => a.fundId.localeCompare(b.fundId) || a.asOfDate.localeCompare(b.asOfDate));

const payload = { version: 1, builtAt: now, funds, aumPoints, aua };
await writeFile(dataPath("bootstrap-data.json"), `${JSON.stringify(payload)}\n`, "utf8");
console.log(JSON.stringify({ funds: funds.length, aumPoints: aumPoints.length, aua: aua.length }));
