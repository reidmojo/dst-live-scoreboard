import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("defines the r31d.wiki landing and fantasy football routes", async () => {
  const [home, fantasyIndex, fantasyPage, ptwPage, dstPage, dstApp, app, ptwApp, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/fantasy_football/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/fantasy_football/availability/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/fantasy_football/ptw_availability/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/fantasy_football/dst/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/fantasy_football/dst/dst-tracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/draft-availability-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/fantasy_football/ptw-availability-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /r31d\.wiki/);
  assert.match(home, /r31d\.wiki/);
  assert.ok(home.includes('href="/fantasy_football/dst"'));
  assert.ok(!home.includes('href="/fantasy_football/availability"'));
  assert.ok(!fantasyIndex.includes('href="/fantasy_football/ptw_availability"'));
  assert.ok(fantasyIndex.includes('href="/fantasy_football/dst"'));
  assert.match(fantasyPage, /DraftAvailabilityApp/);
  assert.match(ptwPage, /PtwAvailabilityApp/);
  assert.match(dstPage, /DstTracker/);
  assert.match(dstApp, /Drive scoring liveboard/);
  assert.match(app, /placeholder="e\.g\., Reid"/);
  assert.match(ptwApp, /placeholder="e\.g\., Reid"/);
  assert.match(app, /SURVEY_START = "2026-08-08"/);
  assert.match(app, /SURVEY_END = "2026-09-06"/);
  assert.match(ptwApp, /SURVEY_START = "2026-08-08"/);
  assert.match(ptwApp, /SURVEY_END = "2026-09-07"/);
  assert.ok(ptwApp.includes('type Choice = "yes" | "no"'));
  assert.match(app, /statesForDate/);
  assert.doesNotMatch(`${home}\n${fantasyIndex}\n${fantasyPage}\n${ptwPage}\n${dstPage}\n${dstApp}\n${app}\n${ptwApp}\n${layout}`, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("keeps database-backed responses scoped by league", async () => {
  const [schema, route, ptwRoute, handlers, ptwHandlers, app, ptwApp, hosting] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/fantasy_football/availability/api/responses/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/fantasy_football/ptw_availability/api/responses/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/fantasy_football/response-handlers.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/fantasy_football/ptw-response-handlers.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/draft-availability-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/fantasy_football/ptw-availability-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(hosting, /"d1": "DB"/);
  assert.ok(schema.includes('sqliteTable("responses"'));
  assert.ok(schema.includes('sqliteTable("ptw_responses"'));
  assert.match(route, /response-handlers/);
  assert.match(ptwRoute, /ptw-response-handlers/);
  assert.match(handlers, /onConflictDoUpdate/);
  assert.match(ptwHandlers, /onConflictDoUpdate/);
  assert.match(handlers, /mergeSelectionUpdate/);
  assert.match(ptwHandlers, /mergeSelectionUpdate/);
  assert.doesNotMatch(handlers, /date >= today/);
  assert.match(app, /editableDates: targetDates/);
  assert.match(ptwApp, /editableDates: targetDates/);
  assert.match(app, /Editing .*saved response\. Change any date and save again/);
  assert.match(ptwApp, /Editing .*saved response\. Change any date and save again/);
  assert.match(handlers, /choice === "in_person" && !isSaturday/);
  assert.ok(ptwHandlers.includes('VALID_CHOICES = new Set(["yes", "no"])'));
});

test("keeps the shared calendar UI mobile-friendly", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /touch-action: manipulation/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /\.day-name\s*{\s*display: none;/);
});

test("retains the durable PTW time survey at its direct route", async () => {
  const [index, page, app, route, handlers, schema, migration, answeredSlotsMigration, css] = await Promise.all([
    readFile(new URL("../app/fantasy_football/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/fantasy_football/ptw_time_availability/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/fantasy_football/ptw-time-availability-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/fantasy_football/ptw_time_availability/api/responses/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/fantasy_football/ptw-time-response-handlers.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_tan_iron_monger.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0004_marvelous_cobalt_man.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.ok(!index.includes('href="/fantasy_football/ptw_time_availability"'));
  assert.match(page, /PtwTimeAvailabilityApp/);
  assert.match(route, /ptw-time-response-handlers/);
  assert.match(schema, /sqliteTable\("ptw_time_responses"/);
  assert.match(handlers, /onConflictDoUpdate/);
  assert.match(handlers, /PTW_DRAFT_TIME_SLOT_KEYS/);
  assert.match(handlers, /PTW_LEGACY_ANSWERED_TIME_SLOT_KEYS/);
  assert.match(handlers, /answeredSlots/);
  assert.match(app, /useState<UnavailableSlots>\(\{\}\)/);
  assert.match(app, /useState<AnsweredSlots>\(\{\}\)/);
  assert.match(app, /Everything starts available/);
  assert.match(app, /Every time below is Pacific Daylight Time \(PDT\)/);
  assert.match(app, /\{slot\.label\} PDT/);
  assert.match(app, /Save changes/);
  assert.match(app, /Best availability periods/);
  assert.match(app, /Hover, focus, or tap any heatmap block/);
  assert.match(app, /New morning slots start gray/);
  assert.match(app, /No response/);
  assert.match(app, /onMouseEnter=.*setInspectedSlotKey/);
  assert.match(app, /availabilityLevel/);
  assert.match(css, /\.time-columns\s*{[\s\S]*grid-template-columns: repeat\(3,/);
  assert.match(css, /\.heatmap-cell\.full/);
  assert.match(css, /\.heatmap-cell\.none/);
  assert.match(css, /\.time-slot\.unavailable\s*{ background: var\(--no\); }/);
  assert.match(css, /\.time-slot\.unanswered/);
  assert.match(migration, /CREATE TABLE `ptw_time_responses`/);
  assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE|DELETE FROM|UPDATE /);
  assert.match(answeredSlotsMigration, /ALTER TABLE `ptw_time_responses` ADD `answered_slots` text/);
  assert.doesNotMatch(answeredSlotsMigration, /DROP TABLE|DELETE FROM|UPDATE /);
});

test("keeps the DST tracker season-safe, durable, shareable, and responsive", async () => {
  const [component, dashboard, css, schema, migration] = await Promise.all([
    readFile(new URL("../app/fantasy_football/dst/dst-tracker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/dst/dashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../app/fantasy_football/dst/dst.module.css", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0002_confused_celestials.sql", import.meta.url), "utf8"),
  ]);

  assert.match(dashboard, /previous_league_id/);
  assert.match(dashboard, /leagueProjectionPoints/);
  assert.match(dashboard, /dst_snapshots/);
  assert.match(dashboard, /SCHEDULED_POLL_INTERVAL_MS/);
  assert.match(schema, /dstSnapshots/);
  assert.match(migration, /CREATE TABLE `dst_snapshots`/);
  assert.match(component, /AbortController/);
  assert.match(component, /popstate/);
  assert.match(component, /MY_TEAM_KEY/);
  assert.match(component, /MY_TEAM_COOKIE/);
  assert.match(component, /Max-Age=31536000/);
  assert.match(component, /Number\(b\.manager === myManager\) - Number\(a\.manager === myManager\)/);
  assert.match(component, /matchup: matchup\.id/);
  assert.match(component, /matchupWinEstimate\(matchup\.teams\)/);
  assert.match(component, /winPercent \?\? 0/);
  assert.match(component, /manager\.replace\(\/\^@\//);
  assert.match(component, /YetToPlaySummary/);
  assert.match(component, /resolvedOptions\(\)\.timeZone/);
  assert.match(component, /formatKickoff/);
  assert.match(component, /comparisonScore\(playerDisplayProjection\(player, final\)\)/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /\.playerGame/);
  assert.match(css, /overflow-x: clip/);
  assert.match(css, /min-height: 44px/);
});
