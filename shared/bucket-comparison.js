import { round2, sha256 } from "./model.js";

export const COMPARISON_METHOD = "published-asof-baseline-v1";

const finiteTotal = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const validBaseline = (baseline, latestDate) => baseline && validDate(baseline.asOfDate) &&
  baseline.asOfDate < latestDate && finiteTotal(baseline.totalMillionBaht) &&
  typeof baseline.snapshotId === "string" && typeof baseline.fundSetFingerprint === "string";

export async function loadPublishedBaseline(db, bucketId, latestDate) {
  if (!validDate(latestDate)) return null;
  const latest = await db.prepare(`
    SELECT s.id, s.generated_at, s.data_version, b.value AS bucket_json
    FROM dashboard_snapshots s, json_each(s.payload_json, '$.buckets') b
    WHERE json_extract(b.value, '$.id')=?
      AND json_extract(b.value, '$.latestDate')=?
      AND json_extract(b.value, '$.comparison.method')=?
      AND json_extract(b.value, '$.comparison.baseline.asOfDate') < ?
      AND json_type(b.value, '$.comparison.baseline.totalMillionBaht') IN ('integer', 'real')
      AND json_extract(b.value, '$.comparison.baseline.totalMillionBaht') >= 0
    ORDER BY s.generated_at DESC, s.id DESC LIMIT 1
  `).bind(bucketId, latestDate, COMPARISON_METHOD, latestDate).first();
  const previousBucket = latest ? JSON.parse(latest.bucket_json) : null;
  // A same-date refresh must retain the published baseline, not replace it with revised history.
  if (previousBucket?.latestDate === latestDate && previousBucket.comparison?.method === COMPARISON_METHOD &&
      validBaseline(previousBucket.comparison.baseline, latestDate)) {
    return previousBucket.comparison.baseline;
  }
  const row = await db.prepare(`
    SELECT s.id, s.generated_at, s.data_version, b.value AS bucket_json,
      json_extract(s.payload_json, '$.funds') AS funds_json
    FROM dashboard_snapshots s, json_each(s.payload_json, '$.buckets') b
    WHERE json_extract(b.value, '$.id')=?
      AND json_extract(b.value, '$.latestDate') < ?
      AND json_type(b.value, '$.totalMillionBaht') IN ('integer', 'real')
      AND json_extract(b.value, '$.totalMillionBaht') >= 0
    ORDER BY s.generated_at DESC, s.id DESC LIMIT 1
  `).bind(bucketId, latestDate).first();
  if (!row) return null;
  const bucket = JSON.parse(row.bucket_json);
  const codes = (JSON.parse(row.funds_json || "[]") || []).filter(fund => fund.bucketId === bucketId).map(fund => fund.code).sort();
  const fundSetFingerprint = bucket.fundSetFingerprint || (codes.length ? sha256(codes) : null);
  const baseline = {
    snapshotId: row.id,
    dataVersion: row.data_version,
    publishedAt: row.generated_at,
    asOfDate: bucket.latestDate,
    totalMillionBaht: bucket.totalMillionBaht,
    fundSetFingerprint
  };
  return validBaseline(baseline, latestDate) ? baseline : null;
}

export function buildPublishedComparison(bucket, aggregate, baseline) {
  const result = {
    method: COMPARISON_METHOD,
    status: "unavailable",
    reason: null,
    baseline,
    changeMillionBaht: null,
    revisedBaselineMillionBaht: null,
    backfillChangeMillionBaht: null,
    likeForDateChangeMillionBaht: null
  };
  if (!validDate(bucket.latestDate) || !finiteTotal(bucket.totalMillionBaht)) return { ...result, reason: "missing_current_total" };
  if (!validBaseline(baseline, bucket.latestDate)) return { ...result, reason: "missing_published_baseline" };
  if (bucket.fundSetFingerprint !== baseline.fundSetFingerprint) return { ...result, reason: "fund_scope_changed" };
  const revised = aggregate.find(point => point.date === baseline.asOfDate)?.aumMillionBaht;
  const hasRevised = finiteTotal(revised);
  return {
    ...result,
    status: "available",
    changeMillionBaht: round2(bucket.totalMillionBaht - baseline.totalMillionBaht),
    revisedBaselineMillionBaht: hasRevised ? round2(revised) : null,
    backfillChangeMillionBaht: hasRevised ? round2(revised - baseline.totalMillionBaht) : null,
    likeForDateChangeMillionBaht: hasRevised ? round2(bucket.totalMillionBaht - revised) : null
  };
}
