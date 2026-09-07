CREATE TABLE `aua_observation_sources` (
	`observation_id` text NOT NULL,
	`source_id` text NOT NULL,
	`evidence_text` text,
	PRIMARY KEY(`observation_id`, `source_id`),
	FOREIGN KEY (`observation_id`) REFERENCES `aua_observations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `aua_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `aua_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`reference_date` text NOT NULL,
	`amount_million_baht` real NOT NULL,
	`announced_at` text,
	`discovered_at` text NOT NULL,
	`status` text NOT NULL,
	`label` text NOT NULL,
	`observation_key` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`supersedes_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aua_observation_revision_idx` ON `aua_observations` (`observation_key`,`revision`);--> statement-breakpoint
CREATE INDEX `aua_observation_reference_idx` ON `aua_observations` (`reference_date`);--> statement-breakpoint
CREATE TABLE `aua_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`publisher` text NOT NULL,
	`source_kind` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`announced_at` text,
	`discovered_at` text NOT NULL,
	`verification_status` text NOT NULL,
	`completeness_status` text NOT NULL,
	`document_hash` text,
	`r2_key` text,
	`notes` text,
	`last_checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `aua_sources_url_idx` ON `aua_sources` (`url`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`occurred_at` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`actor` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `aum_points` (
	`fund_id` text NOT NULL,
	`as_of_date` text NOT NULL,
	`aum_million_baht` real NOT NULL,
	`nav_per_unit` real,
	`source_url` text,
	`source_observed_at` text,
	`content_hash` text,
	`inserted_at` text NOT NULL,
	`revised_at` text,
	PRIMARY KEY(`fund_id`, `as_of_date`),
	FOREIGN KEY (`fund_id`) REFERENCES `funds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `aum_points_date_idx` ON `aum_points` (`as_of_date`);--> statement-breakpoint
CREATE TABLE `dashboard_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`generated_at` text NOT NULL,
	`data_version` text NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dashboard_snapshots_generated_idx` ON `dashboard_snapshots` (`generated_at`);--> statement-breakpoint
CREATE TABLE `funds` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`bucket_id` text NOT NULL,
	`bucket_name` text NOT NULL,
	`group_name` text,
	`identifier_type` text,
	`identifier` text,
	`data_source` text NOT NULL,
	`source_label` text,
	`inception_date` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `funds_code_unique` ON `funds` (`code`);--> statement-breakpoint
CREATE INDEX `funds_bucket_idx` ON `funds` (`bucket_id`);--> statement-breakpoint
CREATE TABLE `metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`training_fingerprint` text NOT NULL,
	`slope` real,
	`intercept` real,
	`pearson_r` real,
	`r_squared` real,
	`pair_count` integer NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`latest_aua_observation_id` text,
	`anchor_reference_date` text,
	`anchor_aua_million_baht` real,
	`anchor_aum_date` text,
	`anchor_aum_million_baht` real,
	`training_pairs_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_versions_training_fingerprint_unique` ON `model_versions` (`training_fingerprint`);--> statement-breakpoint
CREATE TABLE `projections` (
	`id` text PRIMARY KEY NOT NULL,
	`model_version_id` text NOT NULL,
	`aum_date` text NOT NULL,
	`seriesx_aum_million_baht` real NOT NULL,
	`projected_aua_million_baht` real,
	`status` text NOT NULL,
	`reason` text,
	`projection_kind` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`model_version_id`) REFERENCES `model_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projection_version_date_kind_idx` ON `projections` (`model_version_id`,`aum_date`,`projection_kind`);--> statement-breakpoint
CREATE TABLE `refresh_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`requested_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`updated_at` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`requested_by` text NOT NULL,
	`error` text,
	`result_json` text
);
--> statement-breakpoint
CREATE TABLE `source_status` (
	`source_id` text PRIMARY KEY NOT NULL,
	`source_name` text NOT NULL,
	`status` text NOT NULL,
	`checked_at` text NOT NULL,
	`last_success_at` text,
	`message` text,
	`url` text NOT NULL
);
