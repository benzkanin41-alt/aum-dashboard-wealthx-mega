import { readFile, writeFile } from "node:fs/promises";
import { buildAggregateHistory, fitProjectionModel, matchAuaToAum, projectAua, sha256 } from "../shared/model.js";

const config = JSON.parse(await readFile(new URL("../config/funds.json", import.meta.url), "utf8"));
const history = JSON.parse(await readFile(new URL("../data/nav-history.json", import.meta.url), "utf8"));
const official = JSON.parse(await readFile(new URL("../data/official-aua.json", import.meta.url), "utf8"));
const generatedAt = new Date().toISOString();
const bucketHistories = Object.fromEntries(config.buckets.map((bucket) => [bucket.id, buildAggregateHistory(config, history, bucket.id)]));
const pairs = matchAuaToAum(official, bucketHistories.wealthx_other);
const model = fitProjectionModel(pairs);
const latestSeries = bucketHistories.wealthx_other.at(-1);
const projection = projectAua(model, latestSeries);
const modelId = `model-seed-${model.fingerprint.slice(0, 12)}`;
const officialAua = official.map((item) => ({ ...item, discoveredAt: generatedAt, sources: item.sources.map((source) => ({ ...source, announcedAt: item.announcedAt, completenessStatus: "complete", archived: false })) }));
const buckets = config.buckets.map((bucket) => {
  const points = bucketHistories[bucket.id];
  const latest = points.at(-1);
  const previous = points.at(-2);
  return {
    id: bucket.id,
    name: bucket.name,
    description: bucket.description,
    color: bucket.color,
    fundCount: bucket.funds.length,
    coveredFundCount: latest.activeFundCount,
    latestDate: latest.date,
    totalMillionBaht: latest.aumMillionBaht,
    previousDate: previous.date,
    previousTotalMillionBaht: previous.aumMillionBaht,
    changeMillionBaht: round2(latest.aumMillionBaht - previous.aumMillionBaht),
    changePct: (latest.aumMillionBaht - previous.aumMillionBaht) / previous.aumMillionBaht,
    history: points.map((point) => ({ date: point.date, value: point.aumMillionBaht, fundCount: point.activeFundCount }))
  };
});
const funds = config.buckets.flatMap((bucket) => bucket.funds.map((fund) => {
  const points = Object.values(history[fund.code] || {}).sort((a, b) => a.navDate.localeCompare(b.navDate));
  const latest = points.at(-1);
  const previous = points.at(-2);
  return {
    code: fund.code,
    bucketId: bucket.id,
    bucketName: bucket.name,
    group: fund.group,
    dataSource: fund.dataSource || "talis",
    inceptionDate: points[0]?.navDate || null,
    latestDate: latest?.navDate || null,
    aumMillionBaht: latest?.aumMillionBaht ?? null,
    previousAumMillionBaht: previous?.aumMillionBaht ?? null,
    changeMillionBaht: latest && previous ? round2(latest.aumMillionBaht - previous.aumMillionBaht) : null,
    sourceUrl: latest?.raw?.source || null,
    sparkline: points.slice(-24).map((point) => ({ date: point.navDate, value: point.aumMillionBaht }))
  };
}));
const actualByDate = new Map(officialAua.map((item) => [item.referenceDate, item.amountMillionBaht]));
const timelineMap = new Map(bucketHistories.wealthx_other.map((point) => [point.date, {
  date: point.date,
  seriesxAum: point.aumMillionBaht,
  projectedAua: model.anchor && point.date >= model.anchor.aumDate ? projectAua(model, point).value : null,
  actualAua: actualByDate.get(point.date) ?? null
}]));
for (const item of officialAua) if (!timelineMap.has(item.referenceDate)) timelineMap.set(item.referenceDate, { date: item.referenceDate, seriesxAum: null, projectedAua: null, actualAua: item.amountMillionBaht });
const dataVersion = sha256({ latest: buckets.map((bucket) => [bucket.id, bucket.latestDate, bucket.totalMillionBaht]), aua: officialAua.map((item) => [item.referenceDate, item.amountMillionBaht]), modelId }).slice(0, 20);
const payload = {
  appId: "aum-dashboard",
  schemaVersion: 2,
  generatedAt,
  dataVersion,
  canonicalStore: "Sites D1 (offline seed)",
  buckets,
  funds,
  officialAua,
  latestActual: officialAua.at(-1),
  projection: { ...projection, modelVersion: modelId, modelStatus: model.status, asOfDate: projection.aumDate },
  model: { id: modelId, status: model.status, reason: model.reason, pairCount: model.pairCount, slope: model.slope, intercept: model.intercept, pearsonR: model.pearsonR, rSquared: model.rSquared, createdAt: generatedAt, isProvisional: model.status === "provisional" },
  charts: { officialAua, comparison: pairs.map((pair) => ({ referenceDate: pair.referenceDate, aumDate: pair.aumDate, seriesxAum: pair.aumMillionBaht, actualAua: pair.auaMillionBaht })), timeline: [...timelineMap.values()].sort((a, b) => a.date.localeCompare(b.date)) },
  sourceStatus: [],
  cautions: ["Projection เป็นค่าประมาณจากความสัมพันธ์ในอดีต ไม่ใช่ข้อมูลที่บริษัทรับรอง", "Correlation สูงไม่ได้รับประกันความแม่นยำ โดยเฉพาะเมื่อจำนวนจุดข้อมูลยังน้อย", "Projection สิ้นสุดที่วันที่ AUM ล่าสุดและไม่เติมข้อมูลที่ขาดด้วยศูนย์"]
};
await writeFile(new URL("../data/dashboard-cache.json", import.meta.url), `${JSON.stringify(payload)}\n`, "utf8");
console.log(JSON.stringify({ dataVersion, modelId, projection: projection.value }));

function round2(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
