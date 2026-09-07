import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const funds = sqliteTable("funds", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  bucketId: text("bucket_id").notNull(),
  bucketName: text("bucket_name").notNull(),
  groupName: text("group_name"),
  identifierType: text("identifier_type"),
  identifier: text("identifier"),
  dataSource: text("data_source").notNull(),
  sourceLabel: text("source_label"),
  inceptionDate: text("inception_date"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
}, (table) => [index("funds_bucket_idx").on(table.bucketId)]);

export const aumPoints = sqliteTable("aum_points", {
  fundId: text("fund_id").notNull().references(() => funds.id),
  asOfDate: text("as_of_date").notNull(),
  aumMillionBaht: real("aum_million_baht").notNull(),
  navPerUnit: real("nav_per_unit"),
  sourceUrl: text("source_url"),
  sourceObservedAt: text("source_observed_at"),
  contentHash: text("content_hash"),
  insertedAt: text("inserted_at").notNull(),
  revisedAt: text("revised_at")
}, (table) => [
  primaryKey({ columns: [table.fundId, table.asOfDate] }),
  index("aum_points_date_idx").on(table.asOfDate)
]);

export const auaSources = sqliteTable("aua_sources", {
  id: text("id").primaryKey(),
  publisher: text("publisher").notNull(),
  sourceKind: text("source_kind").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  announcedAt: text("announced_at"),
  discoveredAt: text("discovered_at").notNull(),
  verificationStatus: text("verification_status").notNull(),
  completenessStatus: text("completeness_status").notNull(),
  documentHash: text("document_hash"),
  r2Key: text("r2_key"),
  notes: text("notes"),
  lastCheckedAt: text("last_checked_at").notNull()
}, (table) => [uniqueIndex("aua_sources_url_idx").on(table.url)]);

export const auaObservations = sqliteTable("aua_observations", {
  id: text("id").primaryKey(),
  referenceDate: text("reference_date").notNull(),
  amountMillionBaht: real("amount_million_baht").notNull(),
  announcedAt: text("announced_at"),
  discoveredAt: text("discovered_at").notNull(),
  status: text("status").notNull(),
  label: text("label").notNull(),
  observationKey: text("observation_key").notNull(),
  revision: integer("revision").notNull().default(1),
  supersedesId: text("supersedes_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
}, (table) => [
  uniqueIndex("aua_observation_revision_idx").on(table.observationKey, table.revision),
  index("aua_observation_reference_idx").on(table.referenceDate)
]);

export const auaObservationSources = sqliteTable("aua_observation_sources", {
  observationId: text("observation_id").notNull().references(() => auaObservations.id),
  sourceId: text("source_id").notNull().references(() => auaSources.id),
  evidenceText: text("evidence_text")
}, (table) => [primaryKey({ columns: [table.observationId, table.sourceId] })]);

export const modelVersions = sqliteTable("model_versions", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  trainingFingerprint: text("training_fingerprint").notNull().unique(),
  slope: real("slope"),
  intercept: real("intercept"),
  pearsonR: real("pearson_r"),
  rSquared: real("r_squared"),
  pairCount: integer("pair_count").notNull(),
  status: text("status").notNull(),
  reason: text("reason"),
  latestAuaObservationId: text("latest_aua_observation_id"),
  anchorReferenceDate: text("anchor_reference_date"),
  anchorAuaMillionBaht: real("anchor_aua_million_baht"),
  anchorAumDate: text("anchor_aum_date"),
  anchorAumMillionBaht: real("anchor_aum_million_baht"),
  trainingPairsJson: text("training_pairs_json").notNull()
});

export const projections = sqliteTable("projections", {
  id: text("id").primaryKey(),
  modelVersionId: text("model_version_id").notNull().references(() => modelVersions.id),
  aumDate: text("aum_date").notNull(),
  seriesxAumMillionBaht: real("seriesx_aum_million_baht").notNull(),
  projectedAuaMillionBaht: real("projected_aua_million_baht"),
  status: text("status").notNull(),
  reason: text("reason"),
  projectionKind: text("projection_kind").notNull(),
  createdAt: text("created_at").notNull()
}, (table) => [
  uniqueIndex("projection_version_date_kind_idx").on(table.modelVersionId, table.aumDate, table.projectionKind)
]);

export const refreshJobs = sqliteTable("refresh_jobs", {
  id: text("id").primaryKey(),
  requestedAt: text("requested_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at").notNull(),
  status: text("status").notNull(),
  stage: text("stage").notNull(),
  cursor: integer("cursor").notNull().default(0),
  total: integer("total").notNull().default(0),
  requestedBy: text("requested_by").notNull(),
  error: text("error"),
  resultJson: text("result_json")
});

export const sourceStatus = sqliteTable("source_status", {
  sourceId: text("source_id").primaryKey(),
  sourceName: text("source_name").notNull(),
  status: text("status").notNull(),
  checkedAt: text("checked_at").notNull(),
  lastSuccessAt: text("last_success_at"),
  message: text("message"),
  url: text("url").notNull()
});

export const metadata = sqliteTable("metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const dashboardSnapshots = sqliteTable("dashboard_snapshots", {
  id: text("id").primaryKey(),
  generatedAt: text("generated_at").notNull(),
  dataVersion: text("data_version").notNull(),
  payloadJson: text("payload_json").notNull()
}, (table) => [index("dashboard_snapshots_generated_idx").on(table.generatedAt)]);

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  occurredAt: text("occurred_at").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  actor: text("actor").notNull()
});
