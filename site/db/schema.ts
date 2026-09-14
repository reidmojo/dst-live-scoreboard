import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const responses = sqliteTable("responses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull().unique(),
  selections: text("selections").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const ptwResponses = sqliteTable("ptw_responses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull().unique(),
  selections: text("selections").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const ptwTimeResponses = sqliteTable("ptw_time_responses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull().unique(),
  unavailableSlots: text("unavailable_slots").notNull().default("[]"),
  answeredSlots: text("answered_slots"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dstSnapshots = sqliteTable("dst_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leagueId: text("league_id").notNull(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  dashboard: text("dashboard").notNull(),
  finalizedAt: text("finalized_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("dst_snapshots_league_season_week_unique").on(table.leagueId, table.season, table.week),
]);

export const dstLiveCache = sqliteTable("dst_live_cache", {
  cacheKey: text("cache_key").primaryKey(),
  dashboard: text("dashboard").notNull(),
  generatedAt: text("generated_at").notNull(),
});
