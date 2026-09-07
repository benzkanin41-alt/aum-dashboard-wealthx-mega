import bootstrapData from "../data/bootstrap-data.json";
import { audit, getMetadata, nowIso, setMetadata } from "./db.ts";
import type { Env } from "./types.ts";

const CHUNK_SIZE = 300;

export async function getBootstrapStatus(env: Env) {
  const complete = (await getMetadata(env, "bootstrap_complete")) === "true";
  const phase = (await getMetadata(env, "bootstrap_phase")) || (complete ? "complete" : "funds");
  const cursor = Number((await getMetadata(env, "bootstrap_cursor")) || 0);
  return {
    complete,
    phase,
    cursor,
    total: phase === "aum" ? bootstrapData.aumPoints.length : phase === "funds" ? bootstrapData.funds.length : bootstrapData.aua.length,
    builtAt: bootstrapData.builtAt
  };
}

export async function advanceBootstrap(env: Env) {
  const status = await getBootstrapStatus(env);
  if (status.complete) return status;
  const now = nowIso();

  if (status.phase === "funds") {
    const statements = bootstrapData.funds.map((fund) => env.DB.prepare(`
      INSERT INTO funds (id, code, bucket_id, bucket_name, group_name, identifier_type, identifier, data_source, source_label, inception_date, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET bucket_id=excluded.bucket_id, bucket_name=excluded.bucket_name, group_name=excluded.group_name,
        identifier_type=excluded.identifier_type, identifier=excluded.identifier, data_source=excluded.data_source,
        source_label=excluded.source_label, inception_date=excluded.inception_date, active=1, updated_at=excluded.updated_at
    `).bind(fund.id, fund.code, fund.bucketId, fund.bucketName, fund.groupName, fund.identifierType, fund.identifier, fund.dataSource, fund.sourceLabel, fund.inceptionDate, now, now));
    await env.DB.batch(statements);
    await setMetadata(env, "bootstrap_phase", "aum");
    await setMetadata(env, "bootstrap_cursor", "0");
    await audit(env, "bootstrap", "funds", "import", null, { count: statements.length });
    return getBootstrapStatus(env);
  }

  if (status.phase === "aum") {
    const slice = bootstrapData.aumPoints.slice(status.cursor, status.cursor + CHUNK_SIZE);
    const statements = slice.map((point) => env.DB.prepare(`
      INSERT INTO aum_points (fund_id, as_of_date, aum_million_baht, nav_per_unit, source_url, source_observed_at, content_hash, inserted_at, revised_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL)
      ON CONFLICT(fund_id, as_of_date) DO UPDATE SET aum_million_baht=excluded.aum_million_baht,
        nav_per_unit=excluded.nav_per_unit, source_url=excluded.source_url,
        revised_at=CASE WHEN aum_points.aum_million_baht <> excluded.aum_million_baht THEN excluded.inserted_at ELSE aum_points.revised_at END
    `).bind(point.fundId, point.asOfDate, point.aumMillionBaht, point.navPerUnit, point.sourceUrl, bootstrapData.builtAt, now));
    if (statements.length) await env.DB.batch(statements);
    const next = status.cursor + slice.length;
    await setMetadata(env, "bootstrap_cursor", String(next));
    if (next >= bootstrapData.aumPoints.length) {
      await setMetadata(env, "bootstrap_phase", "aua");
      await setMetadata(env, "bootstrap_cursor", "0");
    }
    return getBootstrapStatus(env);
  }

  if (status.phase === "aua") {
    await importOfficialAua(env, now);
    await setMetadata(env, "bootstrap_phase", "finalize");
    await setMetadata(env, "bootstrap_cursor", "0");
    return getBootstrapStatus(env);
  }

  await setMetadata(env, "bootstrap_complete", "true");
  await setMetadata(env, "bootstrap_phase", "complete");
  await setMetadata(env, "bootstrap_completed_at", now);
  await audit(env, "bootstrap", "canonical", "complete", null, {
    funds: bootstrapData.funds.length,
    aumPoints: bootstrapData.aumPoints.length,
    aua: bootstrapData.aua.length
  });
  return getBootstrapStatus(env);
}

async function importOfficialAua(env: Env, now: string) {
  const statements: D1PreparedStatement[] = [];
  for (const observation of bootstrapData.aua) {
    for (const source of observation.sources) {
      statements.push(env.DB.prepare(`
        INSERT INTO aua_sources (id, publisher, source_kind, title, url, announced_at, discovered_at, verification_status,
          completeness_status, document_hash, r2_key, notes, last_checked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'complete', NULL, NULL, 'Seeded from verified primary-source review', ?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, announced_at=excluded.announced_at,
          verification_status=excluded.verification_status, last_checked_at=excluded.last_checked_at
      `).bind(source.id, source.publisher, source.sourceKind, source.title, source.url, observation.announcedAt, now, source.verificationStatus, now));
    }
    const key = `${observation.referenceDate}:${observation.amountMillionBaht}`;
    statements.push(env.DB.prepare(`
      INSERT INTO aua_observations (id, reference_date, amount_million_baht, announced_at, discovered_at, status, label,
        observation_key, revision, supersedes_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET announced_at=COALESCE(excluded.announced_at, aua_observations.announced_at),
        status=excluded.status, label=excluded.label, updated_at=excluded.updated_at
    `).bind(observation.id, observation.referenceDate, observation.amountMillionBaht, observation.announcedAt, now,
      observation.status, observation.label, key, now, now));
    for (const source of observation.sources) {
      statements.push(env.DB.prepare(`
        INSERT OR IGNORE INTO aua_observation_sources (observation_id, source_id, evidence_text) VALUES (?, ?, ?)
      `).bind(observation.id, source.id, "Official reported AUA actual"));
    }
  }
  await env.DB.batch(statements);
}
