import { createHash } from "node:crypto";
import { ALGORITHM_VERSION, INTERVAL_METHOD, predictionInterval } from "./prediction-interval.js";

export const SERIESX_BUCKET_ID = "wealthx_other";
export const MIN_MODEL_PAIRS = 4;

export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function flattenFunds(config) {
  return (config.buckets || []).flatMap((bucket) => (bucket.funds || []).map((fund) => ({
    ...fund,
    bucketId: bucket.id,
    bucketName: bucket.name,
    dataSource: fund.dataSource || "talis"
  })));
}

export function buildAggregateHistory(config, history, bucketId) {
  const funds = flattenFunds(config).filter((fund) => fund.bucketId === bucketId);
  const timelines = funds.map((fund) => {
    const points = Object.values(history[fund.code] || {})
      .filter((point) => point?.navDate && point.aumMillionBaht != null && Number.isFinite(Number(point.aumMillionBaht)) && (!fund.inceptionDate || point.navDate >= fund.inceptionDate))
      .sort((a, b) => a.navDate.localeCompare(b.navDate));
    return { fund, points, firstDate: fund.inceptionDate || points[0]?.navDate || null };
  });
  const observedDates = timelines.flatMap(({ points }) => points.map((point) => point.navDate));
  const latestDate = observedDates.sort().at(-1);
  const dates = [...new Set([...observedDates, ...timelines.map(t => t.firstDate).filter(d => d && d <= latestDate)])].sort();
  const aggregates = [];

  for (const date of dates) {
    const active = timelines.filter(({ firstDate }) => !firstDate || firstDate <= date);
    if (!active.length) continue;
    let total = 0;
    let latestSourceDate = null;
    let complete = true;
    const components = [];
    for (const { fund, points } of active) {
      const point = findLatestOnOrBefore(points, date);
      if (!point || calendarDayDiff(point.navDate, date) > 7) {
        complete = false;
        components.push({ code: fund.code, missing: true });
        continue;
      }
      total += Number(point.aumMillionBaht);
      latestSourceDate = !latestSourceDate || point.navDate > latestSourceDate ? point.navDate : latestSourceDate;
      components.push({ code: fund.code, date: point.navDate, aum: Number(point.aumMillionBaht) });
    }
    {
      aggregates.push({
        date,
        aumMillionBaht: complete ? round2(total) : null,
        partialMillionBaht: round2(total),
        activeFundCount: components.filter(c => !c.missing).length,
        expectedFundCount: active.length,
        complete,
        latestSourceDate,
        components
      });
    }
  }
  return aggregates;
}

export function matchAuaToAum(auaObservations, aggregateHistory) {
  return auaObservations
    .filter((item) => item.status === "verified")
    .sort((a, b) => a.referenceDate.localeCompare(b.referenceDate))
    .map((aua) => {
      const aum = findLatestOnOrBefore(aggregateHistory, aua.referenceDate, "date");
      if (!aum?.complete || calendarDayDiff(aum.date, aua.referenceDate) > 7) return null;
      return {
        auaId: aua.id,
        referenceDate: aua.referenceDate,
        announcedAt: aua.announcedAt || null,
        auaMillionBaht: Number(aua.amountMillionBaht),
        aumDate: aum.date,
        aumMillionBaht: Number(aum.aumMillionBaht),
        activeFundCount: aum.activeFundCount,
        componentsHash: sha256(aum.components || []),
        revision: aua.revision || 1
      };
    })
    .filter(Boolean);
}

export function fitProjectionModel(pairs, observations = []) {
  const clean = [...pairs].filter((pair) => Number.isFinite(pair.aumMillionBaht) && Number.isFinite(pair.auaMillionBaht)).sort((a,b) => a.referenceDate.localeCompare(b.referenceDate));
  const fingerprint = sha256({ algorithmVersion: ALGORITHM_VERSION, observations, pairs: clean.map((pair) => ({
    auaId: pair.auaId,
    referenceDate: pair.referenceDate,
    aumDate: pair.aumDate,
    aum: pair.aumMillionBaht,
    aua: pair.auaMillionBaht,
    componentsHash: pair.componentsHash || null,
    revision: pair.revision || 1
  })) });
  if (observations.length && observations.at(-1).id !== clean.at(-1)?.auaId) {
    return unavailableModel(clean, fingerprint, "AUA ทางการล่าสุดยังจับคู่ AUM ที่ครบถ้วนไม่ได้");
  }
  if (clean.length < MIN_MODEL_PAIRS) {
    return unavailableModel(clean, fingerprint, `ต้องมีข้อมูลที่จับคู่ได้อย่างน้อย ${MIN_MODEL_PAIRS} จุด (ปัจจุบัน ${clean.length} จุด)`);
  }
  const xs = clean.map((pair) => pair.aumMillionBaht);
  const ys = clean.map((pair) => pair.auaMillionBaht);
  const xMean = mean(xs);
  const yMean = mean(ys);
  const sxx = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  if (sxx <= 0) return unavailableModel(clean, fingerprint, "AUM ในชุดฝึกไม่มีความแปรปรวน");
  const sxy = clean.reduce((sum, pair) => sum + (pair.aumMillionBaht - xMean) * (pair.auaMillionBaht - yMean), 0);
  const syy = ys.reduce((sum, y) => sum + (y - yMean) ** 2, 0);
  const slope = sxy / sxx;
  const intercept = yMean - slope * xMean;
  const pearsonR = syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
  const rSquared = pearsonR === null ? null : pearsonR ** 2;
  const latest = clean.at(-1);
  const sse = clean.reduce((sum, p) => sum + (p.auaMillionBaht - intercept - slope * p.aumMillionBaht) ** 2, 0);
  return {
    fingerprint,
    algorithmVersion: ALGORITHM_VERSION,
    sse, sxx, xMean, residualVariance: sse / (clean.length - 2),
    xMin: Math.min(...xs), xMax: Math.max(...xs),
    status: clean.length < 8 ? "provisional" : "ready",
    reason: clean.length < 8 ? "ชุดข้อมูลยังมีจำนวนน้อย ผลประมาณการเป็นข้อมูลเบื้องต้น" : null,
    pairCount: clean.length,
    slope,
    intercept,
    pearsonR,
    rSquared,
    anchor: latest,
    pairs: clean
  };
}

export function projectAua(model, latestAggregate) {
  const base = { lower: null, upper: null, aumDate: latestAggregate?.date || null, intervalLevel: 0.95, intervalMethod: INTERVAL_METHOD, algorithmVersion: ALGORITHM_VERSION, inputFingerprint: null };
  if (!model || model.status === "unavailable" || !model.anchor || !latestAggregate || latestAggregate.complete === false || latestAggregate.aumMillionBaht == null) {
    return { ...base, status: "unavailable", value: null, reason: latestAggregate?.complete === false ? "AUM รายกองยังไม่ครบ ณ วันที่ล่าสุด" : model?.reason || "ยังไม่มีข้อมูลเพียงพอ" };
  }
  if (latestAggregate.date < model.anchor.referenceDate) return { ...base, status: "unavailable", value: null, reason: "วันที่ AUM ก่อนวันอ้างอิง AUA ล่าสุด" };
  const value = model.anchor.auaMillionBaht + model.slope * (latestAggregate.aumMillionBaht - model.anchor.aumMillionBaht);
  if (value < 0) return { ...base, status: "unavailable", value: null, reason: "ค่าประมาณอยู่นอกขอบเขตที่ใช้ได้" };
  const inputFingerprint = sha256({ model: model.fingerprint, date: latestAggregate.date, aum: latestAggregate.aumMillionBaht, components: latestAggregate.components || [] });
  const seed = Number.parseInt(sha256(`${model.fingerprint}:${latestAggregate.date}`).slice(0,8),16);
  const interval = predictionInterval(model, latestAggregate.date, latestAggregate.aumMillionBaht, value, seed);
  return {
    ...base,
    lower: round2(interval.lower), upper: round2(interval.upper), inputFingerprint,
    extrapolated: latestAggregate.aumMillionBaht < model.xMin || latestAggregate.aumMillionBaht > model.xMax,
    status: model.status,
    value: round2(value),
    reason: model.reason,
    aumDate: latestAggregate.date,
    aumMillionBaht: latestAggregate.aumMillionBaht,
    anchorReferenceDate: model.anchor.referenceDate,
    anchorAuaMillionBaht: model.anchor.auaMillionBaht,
    anchorAumDate: model.anchor.aumDate,
    anchorAumMillionBaht: model.anchor.aumMillionBaht
  };
}

function unavailableModel(pairs, fingerprint, reason) {
  return { fingerprint, algorithmVersion: ALGORITHM_VERSION, sse: null, sxx: null, xMean: null, residualVariance: null, xMin: null, xMax: null, status: "unavailable", reason, pairCount: pairs.length, slope: null, intercept: null, pearsonR: null, rSquared: null, anchor: pairs.at(-1) || null, pairs };
}

function findLatestOnOrBefore(items, date, dateKey = "navDate") {
  let match = null;
  for (const item of items) {
    if (item[dateKey] <= date && (!match || item[dateKey] > match[dateKey])) match = item;
  }
  return match;
}

function calendarDayDiff(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
