import catalog from "../config/funds.json" with { type: "json" };
import { flattenFunds, sha256 } from "../shared/model.js";
import { audit, getMetadata, nowIso, setMetadata } from "./db.ts";
import type { Env } from "./types.ts";

export async function syncFundCatalog(env: Env) {
  const version = `${catalog.catalogVersion}:${sha256(catalog).slice(0, 16)}`;
  if (await getMetadata(env, "fund_catalog_version") === version) return version;
  const now = nowIso();
  // Trusted, versioned source only. Refresh callers cannot provide fund codes or URLs.
  for (const fund of flattenFunds(catalog)) {
    const before = await env.DB.prepare("SELECT * FROM funds WHERE code=?").bind(fund.code).first();
    await env.DB.prepare(`INSERT INTO funds
      (id, code, bucket_id, bucket_name, group_name, identifier_type, identifier, data_source, source_label, inception_date, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(code) DO UPDATE SET bucket_id=excluded.bucket_id, bucket_name=excluded.bucket_name,
      group_name=excluded.group_name, identifier_type=excluded.identifier_type, identifier=excluded.identifier,
      data_source=excluded.data_source, source_label=excluded.source_label,
      inception_date=COALESCE(excluded.inception_date,funds.inception_date), updated_at=excluded.updated_at`)
      .bind(fund.code, fund.code, fund.bucketId, fund.bucketName, fund.group || null, fund.identifierType || null,
        fund.identifier || null, fund.dataSource, fund.source || null, fund.inceptionDate || null, now, now).run();
    if (!before) await audit(env, "fund", fund.code, "catalog_add", null, { ...fund, catalogVersion: version });
  }
  await setMetadata(env, "fund_catalog_version", version);
  return version;
}
