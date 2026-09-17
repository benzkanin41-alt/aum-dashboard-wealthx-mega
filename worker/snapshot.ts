import { buildAggregateHistory, fitProjectionModel, projectAua, matchAuaToAum, sha256 } from "../shared/model.js";
import { audit, nowIso, setMetadata } from "./db.ts";
import type { AuaRow, AumRow, Env, FundRow } from "./types.ts";

const BUCKET_COLORS: Record<string, string> = {
  wealthx_other: "#4f8cff",
  mega30: "#25b6a5",
  other_funds: "#f28b42"
};

export async function rebuildModelAndSnapshot(env: Env, actor = "system") {
  const [fundRows, aumRows, auaRows, sourceRows, sourceStatuses] = await Promise.all([
    env.DB.prepare("SELECT * FROM funds WHERE active=1 ORDER BY bucket_id, code").all<FundRow>(),
    readAllAum(env),
    env.DB.prepare("SELECT * FROM aua_observations ORDER BY reference_date, revision").all<AuaRow>(),
    env.DB.prepare(`
      SELECT aos.observation_id, s.id, s.publisher, s.title, s.url, s.announced_at, s.verification_status, s.completeness_status, s.r2_key
      FROM aua_observation_sources aos JOIN aua_sources s ON s.id=aos.source_id
      ORDER BY s.announced_at, s.id
    `).all(),
    env.DB.prepare("SELECT * FROM source_status ORDER BY source_name").all()
  ]);

  const config = rowsToConfig(fundRows.results);
  const history = rowsToHistory(fundRows.results, aumRows);
  const bucketHistories = Object.fromEntries(config.buckets.map((bucket: { id: string }) => [bucket.id, buildAggregateHistory(config, history, bucket.id)]));
  const canonicalAua = canonicalObservations(auaRows.results);
  const seriesHistory = bucketHistories.wealthx_other || [];
  const pairs: any[] = matchCanonicalAua(canonicalAua, seriesHistory);
  const fitted = fitProjectionModel(pairs, canonicalAua.map(row => ({ id: row.id, date: row.reference_date, amount: row.amount_million_baht, revision: row.revision })));
  const model = await persistModelVersion(env, fitted, canonicalAua.at(-1) || null, actor);
  const latestSeries = seriesHistory.at(-1) || null;
  const currentProjection = projectAua({ ...fitted, anchor: fitted.anchor }, latestSeries);
  await persistProjection(env, model.id, currentProjection, latestSeries, actor);

  const sourceMap = new Map<string, unknown[]>();
  for (const row of sourceRows.results as Array<Record<string, unknown>>) {
    const key = String(row.observation_id);
    const values = sourceMap.get(key) || [];
    values.push({
      id: row.id,
      publisher: row.publisher,
      title: row.title,
      url: row.url,
      announcedAt: row.announced_at,
      verificationStatus: row.verification_status,
      completenessStatus: row.completeness_status,
      archived: Boolean(row.r2_key)
    });
    sourceMap.set(key, values);
  }

  const generatedAt = nowIso();
  const officialAua = canonicalAua.map((row) => ({
    id: row.id,
    referenceDate: row.reference_date,
    amountMillionBaht: row.amount_million_baht,
    announcedAt: row.announced_at,
    discoveredAt: row.discovered_at,
    label: row.label,
    status: row.status,
    sources: sourceMap.get(row.id) || []
  }));
  const latestActual = officialAua.at(-1) || null;
  const buckets = config.buckets.map((bucket) => {
    const aggregate = bucketHistories[bucket.id] || [];
    const latest = aggregate.at(-1) || null;
    const previous = aggregate.at(-2) || null;
    return {
      id: bucket.id,
      name: bucket.name,
      description: bucket.description,
      color: BUCKET_COLORS[bucket.id] || "#8090a6",
      fundCount: bucket.funds.length,
      coveredFundCount: latest?.activeFundCount || 0,
      latestDate: latest?.date || null,
      totalMillionBaht: latest?.aumMillionBaht ?? null,
      coverageComplete: latest?.complete ?? false,
      previousDate: previous?.date || null,
      previousTotalMillionBaht: previous?.aumMillionBaht || null,
      changeMillionBaht: latest?.aumMillionBaht != null && previous?.aumMillionBaht != null ? round2(latest.aumMillionBaht - previous.aumMillionBaht) : null,
      changePct: latest?.aumMillionBaht != null && previous?.aumMillionBaht ? (latest.aumMillionBaht - previous.aumMillionBaht) / previous.aumMillionBaht : null,
      history: aggregate.map((item) => ({ date: item.date, value: item.aumMillionBaht, fundCount: item.activeFundCount }))
    };
  });
  const fundCards = fundRows.results.map((fund) => fundCard(fund, history[fund.code] || {}));
  const timelineMap = new Map<string, any>(seriesHistory.map((point: any) => {
    const projection = fitted.anchor && point.date >= fitted.anchor.referenceDate ? projectAua(fitted, point) : null;
    const actual = officialAua.find((item) => item.referenceDate === point.date);
    return [point.date, {
      date: point.date,
      seriesxAum: point.aumMillionBaht,
      projectedAua: projection?.value ?? null,
      lower: projection?.lower ?? null,
      upper: projection?.upper ?? null,
      intervalLevel: 0.95,
      modelVersion: model.id,
      projectionKind: "reconstructed",
      actualAua: actual?.amountMillionBaht ?? null
    }] as [string, any];
  }));
  for (const actual of officialAua) {
    if (!timelineMap.has(actual.referenceDate)) timelineMap.set(actual.referenceDate, {
      date: actual.referenceDate,
      seriesxAum: null,
      projectedAua: actual.referenceDate === fitted.anchor?.referenceDate ? actual.amountMillionBaht : null,
      lower: actual.referenceDate === fitted.anchor?.referenceDate ? actual.amountMillionBaht : null,
      upper: actual.referenceDate === fitted.anchor?.referenceDate ? actual.amountMillionBaht : null,
      actualAua: actual.amountMillionBaht
    });
  }
  const timeline = [...timelineMap.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const dataVersion = sha256({
    buckets: buckets.map((bucket: { id: string; latestDate: string | null; totalMillionBaht: number | null }) => [bucket.id, bucket.latestDate, bucket.totalMillionBaht]),
    officialAua: officialAua.map((item) => [item.id, item.referenceDate, item.amountMillionBaht, item.status]),
    model: model.id,
    projection: currentProjection,
    histories: buckets.map(bucket => bucket.history),
    sourceStatus: sourceStatuses.results,
    catalog: fundRows.results.map(fund => [fund.code, fund.inception_date])
  }).slice(0, 20);
  const payload = {
    appId: "aum-dashboard",
    schemaVersion: 3,
    generatedAt,
    dataVersion,
    canonicalStore: "Sites D1",
    buckets,
    funds: fundCards,
    officialAua,
    latestActual,
    projection: {
      ...currentProjection,
      modelVersion: model.id,
      modelStatus: fitted.status,
      asOfDate: currentProjection.aumDate || null
    },
    model: {
      id: model.id,
      status: fitted.status,
      reason: fitted.reason,
      pairCount: fitted.pairCount,
      slope: fitted.slope,
      intercept: fitted.intercept,
      pearsonR: fitted.pearsonR,
      rSquared: fitted.rSquared,
      createdAt: model.createdAt,
      isProvisional: fitted.status === "provisional",
      algorithmVersion: fitted.algorithmVersion,
      residualVariance: fitted.residualVariance,
      trainingFingerprint: fitted.fingerprint
    },
    charts: {
      officialAua,
      comparison: pairs.map((pair) => ({
        referenceDate: pair.referenceDate,
        aumDate: pair.aumDate,
        seriesxAum: pair.aumMillionBaht,
        actualAua: pair.auaMillionBaht
      })),
      timeline
    },
    sourceStatus: sourceStatuses.results.map((row: Record<string, unknown>) => ({
      id: row.source_id,
      name: row.source_name,
      status: row.status,
      checkedAt: row.checked_at,
      lastSuccessAt: row.last_success_at,
      message: row.message,
      url: row.url
    })),
    pendingReviewCount: auaRows.results.filter(row => row.status === "pending_review").length,
    cautions: [
      "Projection เป็นค่าประมาณจากความสัมพันธ์ในอดีต ไม่ใช่ข้อมูลที่บริษัทรับรอง",
      "Correlation สูงไม่ได้รับประกันความแม่นยำ โดยเฉพาะเมื่อจำนวนจุดข้อมูลยังน้อย",
      "Projection สิ้นสุดที่วันที่ AUM ล่าสุดและไม่เติมข้อมูลที่ขาดด้วยศูนย์",
      "ช่วง 95% อยู่ภายใต้สมมติฐานโมเดล ไม่ใช่ความแม่นยำที่ผ่านการพิสูจน์; เส้นย้อนหลังสร้างใหม่ด้วยโมเดลปัจจุบัน"
    ]
  };
  const snapshotId = `snapshot-${generatedAt}-${dataVersion}`;
  await env.DB.prepare("INSERT INTO dashboard_snapshots (id, generated_at, data_version, payload_json) VALUES (?, ?, ?, ?)")
    .bind(snapshotId, generatedAt, dataVersion, JSON.stringify(payload)).run();
  await setMetadata(env, "current_snapshot_id", snapshotId);
  await setMetadata(env, "current_data_version", dataVersion);
  await audit(env, "dashboard_snapshot", snapshotId, "create", null, { dataVersion, modelVersion: model.id }, actor);
  return payload;
}

export async function loadDashboardSnapshot(env: Env) {
  const row = await env.DB.prepare("SELECT payload_json FROM dashboard_snapshots ORDER BY generated_at DESC LIMIT 1")
    .first<{ payload_json: string }>();
  return row ? JSON.parse(row.payload_json) : null;
}

export async function loadFundDetail(env: Env, code: string) {
  const fund = await env.DB.prepare("SELECT * FROM funds WHERE code=?").bind(code).first<FundRow>();
  if (!fund) return null;
  const points = await env.DB.prepare(`
    SELECT as_of_date AS date, aum_million_baht AS aumMillionBaht, nav_per_unit AS navPerUnit, source_url AS sourceUrl,
      source_observed_at AS sourceObservedAt, revised_at AS revisedAt
    FROM aum_points WHERE fund_id=? ORDER BY as_of_date
  `).bind(fund.id).all();
  return {
    code: fund.code,
    bucketId: fund.bucket_id,
    bucketName: fund.bucket_name,
    group: fund.group_name,
    identifier: fund.identifier,
    dataSource: fund.data_source,
    inceptionDate: fund.inception_date,
    history: points.results
  };
}

async function persistModelVersion(env: Env, fitted: any, latestAua: AuaRow | null, actor: string) {
  const existing = await env.DB.prepare("SELECT id, created_at FROM model_versions WHERE training_fingerprint=?")
    .bind(fitted.fingerprint).first<{ id: string; created_at: string }>();
  if (existing) return { id: existing.id, createdAt: existing.created_at, created: false };
  const createdAt = nowIso();
  const id = `model-${createdAt.slice(0, 10)}-${fitted.fingerprint.slice(0, 12)}`;
  await env.DB.prepare(`
    INSERT INTO model_versions (id, created_at, training_fingerprint, slope, intercept, pearson_r, r_squared, pair_count,
      status, reason, latest_aua_observation_id, anchor_reference_date, anchor_aua_million_baht,
      anchor_aum_date, anchor_aum_million_baht, training_pairs_json, algorithm_version, residual_variance, statistics_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, createdAt, fitted.fingerprint, fitted.slope, fitted.intercept, fitted.pearsonR, fitted.rSquared,
    fitted.pairCount, fitted.status, fitted.reason, latestAua?.id || null, fitted.anchor?.referenceDate || null,
    fitted.anchor?.auaMillionBaht || null, fitted.anchor?.aumDate || null, fitted.anchor?.aumMillionBaht || null,
    JSON.stringify(fitted.pairs), fitted.algorithmVersion, fitted.residualVariance,
    JSON.stringify({ sse: fitted.sse, sxx: fitted.sxx, xMean: fitted.xMean, xMin: fitted.xMin, xMax: fitted.xMax })).run();
  await audit(env, "model_version", id, "create", null, { fingerprint: fitted.fingerprint, status: fitted.status, pairCount: fitted.pairCount }, actor);
  return { id, createdAt, created: true };
}

async function persistProjection(env: Env, modelId: string, projection: any, latestSeries: any, actor: string) {
  if (!latestSeries || projection.value == null) return;
  const id = `${modelId}:${latestSeries.date}:${projection.inputFingerprint}:recorded`;
  const existing = await env.DB.prepare("SELECT id FROM projections WHERE id=?").bind(id).first();
  if (existing) return;
  await env.DB.prepare(`
    INSERT INTO projections (id, model_version_id, aum_date, seriesx_aum_million_baht, projected_aua_million_baht,
      status, reason, projection_kind, created_at, lower_bound, upper_bound, interval_level, interval_method, algorithm_version, input_fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'recorded', ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, modelId, latestSeries.date, latestSeries.aumMillionBaht, projection.value, projection.status, projection.reason,
    nowIso(), projection.lower, projection.upper, projection.intervalLevel, projection.intervalMethod, projection.algorithmVersion, projection.inputFingerprint).run();
  await audit(env, "projection", id, "create", null, projection, actor);
}

async function readAllAum(env: Env) {
  const rows: AumRow[] = [];
  const pageSize = 4000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await env.DB.prepare("SELECT * FROM aum_points ORDER BY fund_id, as_of_date LIMIT ? OFFSET ?")
      .bind(pageSize, offset).all<AumRow>();
    rows.push(...page.results);
    if (page.results.length < pageSize) break;
  }
  return rows;
}

function rowsToConfig(rows: FundRow[]) {
  const buckets = new Map<string, { id: string; name: string; description: string; funds: Array<{ code: string; group: string | null; dataSource: string; inceptionDate: string | null }> }>();
  for (const row of rows) {
    if (!buckets.has(row.bucket_id)) buckets.set(row.bucket_id, {
      id: row.bucket_id,
      name: row.bucket_name,
      description: bucketDescription(row.bucket_id),
      funds: []
    });
    buckets.get(row.bucket_id)?.funds.push({ code: row.code, group: row.group_name, dataSource: row.data_source, inceptionDate: row.inception_date });
  }
  const order: Record<string,number> = { wealthx_other: 0, mega30: 1, other_funds: 2 };
  return { buckets: [...buckets.values()].sort((a,b) => (order[a.id] ?? 99) - (order[b.id] ?? 99)) };
}

function rowsToHistory(funds: FundRow[], rows: AumRow[]) {
  const history: Record<string, Record<string, unknown>> = Object.fromEntries(funds.map((fund) => [fund.code, {}]));
  for (const row of rows) {
    history[row.fund_id] ||= {};
    history[row.fund_id][row.as_of_date] = {
      code: row.fund_id,
      navDate: row.as_of_date,
      aumMillionBaht: Number(row.aum_million_baht),
      nav: row.nav_per_unit,
      raw: { source: row.source_url }
    };
  }
  return history;
}

function canonicalObservations(rows: AuaRow[]) {
  const byDate = new Map<string, AuaRow>();
  for (const row of rows) {
    if (row.status !== "verified") continue;
    const current = byDate.get(row.reference_date);
    if (!current || row.revision > current.revision) byDate.set(row.reference_date, row);
  }
  return [...byDate.values()].sort((a, b) => a.reference_date.localeCompare(b.reference_date));
}

function matchCanonicalAua(rows: AuaRow[], aggregates: any[]): any[] {
  return matchAuaToAum(rows.map(row => ({ id: row.id, referenceDate: row.reference_date,
    announcedAt: row.announced_at, amountMillionBaht: Number(row.amount_million_baht), status: row.status, revision: row.revision })), aggregates);
}

function fundCard(fund: FundRow, pointsByDate: Record<string, any>) {
  const points = Object.values(pointsByDate).sort((a, b) => a.navDate.localeCompare(b.navDate));
  const latest = points.at(-1) as any;
  const previous = points.at(-2) as any;
  return {
    code: fund.code,
    bucketId: fund.bucket_id,
    bucketName: fund.bucket_name,
    group: fund.group_name,
    dataSource: fund.data_source,
    inceptionDate: fund.inception_date,
    latestDate: latest?.navDate || null,
    aumMillionBaht: latest?.aumMillionBaht ?? null,
    previousAumMillionBaht: previous?.aumMillionBaht ?? null,
    changeMillionBaht: latest && previous ? round2(latest.aumMillionBaht - previous.aumMillionBaht) : null,
    sourceUrl: latest?.raw?.source || null,
    sparkline: points.slice(-24).map((point: any) => ({ date: point.navDate, value: point.aumMillionBaht }))
  };
}

function bucketDescription(id: string) {
  if (id === "wealthx_other") return "กอง SeriesX/Class-X ที่เป็นกองพิเศษเฉพาะ WealthX และเป็นตัวแปรของโมเดล";
  if (id === "mega30") return "MEGA30 รวม TLUSHD แสดงแยกและไม่ใช้ฝึกโมเดล";
  return "กองทุนที่เผยแพร่บน WealthX แต่ไม่อยู่ใน SeriesX bucket หลัก";
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
