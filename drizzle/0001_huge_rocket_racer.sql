DROP INDEX `projection_version_date_kind_idx`;--> statement-breakpoint
ALTER TABLE `projections` ADD `lower_bound` real;--> statement-breakpoint
ALTER TABLE `projections` ADD `upper_bound` real;--> statement-breakpoint
ALTER TABLE `projections` ADD `interval_level` real;--> statement-breakpoint
ALTER TABLE `projections` ADD `interval_method` text;--> statement-breakpoint
ALTER TABLE `projections` ADD `algorithm_version` text;--> statement-breakpoint
ALTER TABLE `projections` ADD `input_fingerprint` text;--> statement-breakpoint
CREATE UNIQUE INDEX `projection_version_date_input_idx` ON `projections` (`model_version_id`,`aum_date`,`projection_kind`,`input_fingerprint`);--> statement-breakpoint
ALTER TABLE `model_versions` ADD `algorithm_version` text;--> statement-breakpoint
ALTER TABLE `model_versions` ADD `residual_variance` real;--> statement-breakpoint
ALTER TABLE `model_versions` ADD `statistics_json` text;