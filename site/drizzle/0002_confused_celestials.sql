CREATE TABLE `dst_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`league_id` text NOT NULL,
	`season` integer NOT NULL,
	`week` integer NOT NULL,
	`dashboard` text NOT NULL,
	`finalized_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dst_snapshots_league_season_week_unique` ON `dst_snapshots` (`league_id`,`season`,`week`);