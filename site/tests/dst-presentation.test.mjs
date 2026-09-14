import test from "node:test";
import assert from "node:assert/strict";
import { compactInjuryStatus, formatProjection, starterSchedule, weekOptions } from "../lib/dst/presentation.js";

test("defaults a preseason league to fantasy Week 1", () => {
  const league = { status: "in_season", settings: { start_week: 1, leg: 3 } };
  const sleeperState = { season_type: "pre", week: 3, display_week: 3 };
  assert.deepEqual(weekOptions(league, sleeperState, true), [1]);
});

test("follows the current fantasy week after the regular season begins", () => {
  const league = { status: "in_season", settings: { start_week: 1, leg: 3 } };
  const sleeperState = { season_type: "regular", week: 3, display_week: 3 };
  assert.deepEqual(weekOptions(league, sleeperState, true), [1, 2, 3]);
});

test("uses compact Sleeper-style injury tags", () => {
  assert.equal(compactInjuryStatus("Questionable"), "Q");
  assert.equal(compactInjuryStatus("Doubtful"), "D");
  assert.equal(compactInjuryStatus("Out"), "OUT");
  assert.equal(compactInjuryStatus("Injured Reserve"), "IR");
  assert.equal(compactInjuryStatus("Physically Unable to Perform"), "PUP");
});

test("keeps two decimal places for player projections", () => {
  assert.equal(formatProjection(4), "4.00");
  assert.equal(formatProjection(20.4), "20.40");
  assert.equal(formatProjection(19.9418), "19.94");
});

test("maps a starter to its scheduled game and Sleeper-style opponent", () => {
  const games = [{
    date: "2026-09-13T20:25:00Z",
    status: "Scheduled",
    statusState: "pre",
    clock: "0:00",
    period: 0,
    teams: [{ abbreviation: "PHI", homeAway: "home" }, { abbreviation: "WSH", homeAway: "away" }],
  }];
  assert.deepEqual(starterSchedule("PHI", games), {
    gameStart: "2026-09-13T20:25:00Z",
    gameStatus: "Scheduled",
    gameStatusState: "pre",
    gameCompleted: false,
    gameClock: "0:00",
    gamePeriod: 0,
    opponent: "WAS",
    homeAway: "home",
  });
  assert.equal(starterSchedule("WAS", games).homeAway, "away");
});
