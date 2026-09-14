import test from "node:test";
import assert from "node:assert/strict";
import { buildGameViews, gameDriveDetails, playerScoringDetails } from "../lib/dst/games.js";

function game(id = "early", date = "2026-09-13T17:00:00Z", state = "post") {
  return { id, date, statusState: state, status: state === "pre" ? "Scheduled" : "Final", completed: state === "post", period: 4, clock: "0:00",
    teams: [{ id: "1", abbreviation: "PHI", homeAway: "home", score: 28 }, { id: "2", abbreviation: "WSH", homeAway: "away", score: 21 }],
    teamScores: [{ team: "PHI", points: -4, components: [{ kind: "touchdown_allowed", label: "TD allowed", points: -6 }, { kind: "final_score_floor", label: "Final floor", points: 2 }] }, { team: "WSH", points: 6, components: [] }],
  };
}
function input() {
  return { games: [game()], playersById: {
    qb: { full_name: "Home QB", first_name: "Home", last_name: "QB", team: "PHI", position: "QB" },
    te: { full_name: "Away TE", team: "WAS", position: "TE" },
    free: { full_name: "Free Agent", team: "PHI", position: "WR" },
    bench: { full_name: "Bench RB", team: "PHI", position: "RB" },
    bye: { full_name: "Bye Player", team: "DAL", position: "RB" },
    defense: { full_name: "Defensive Player", team: "PHI", position: "LB" },
  }, playerStats: { qb: { pass_att: 30, pass_yd: 250, pass_td: 2, pass_int: 1 }, te: { rec: 4, rec_yd: 50, bonus_rec_te: 4 }, free: { rec: 2, rec_yd: 25 } },
  playerProjections: { qb: { pass_yd: 240 }, bench: { rush_yd: 30 }, bye: { rush_yd: 40 }, defense: { pts_std: 8 } },
  scoringSettings: { pass_yd: .04, pass_td: 4, pass_int: -1, rec: 0, rec_yd: .1, rush_yd: .1, bonus_rec_te: .5 },
  rosters: [{ owner_id: "u", players: ["qb", "bench"], reserve: ["te"] }], users: [{ user_id: "u", username: "owner", display_name: "Not the handle" }],
  matchups: [{ starters: ["qb"], starters_points: [18], players_points: { qb: 18, bench: 0 } }],
  };
}
const players = games => games.flatMap(game => game.positionGroups.flatMap(group => [...group.away, ...group.home]));

test("games sort by kickoff with stable ties and retain scheduled, live, and final games", () => {
  const result = buildGameViews({ games: [game("late", "2026-09-14T00:20:00Z", "pre"), game("b"), game("a", "2026-09-13T17:00:00Z", "in")] });
  assert.deepEqual(result.map(game => game.id), ["a", "b", "late"]);
  assert.deepEqual(result.map(game => game.statusState), ["in", "post", "pre"]);
});

test("games include bench players and free agents, map team aliases, and group opposite sides by position", () => {
  const result = buildGameViews(input());
  const entries = players(result);
  assert.deepEqual(result[0].positionGroups.map(group => group.position), ["QB", "RB", "WR", "TE", "DEF"]);
  assert.equal(result[0].positionGroups.find(group => group.position === "TE").away[0].playerId, "te");
  assert.equal(entries.find(player => player.playerId === "bench").owner, "owner");
  assert.equal(entries.find(player => player.playerId === "free").owner, null);
  assert.ok(!entries.some(player => ["bye", "defense"].includes(player.playerId)));
});

test("game actual scores preserve authoritative starter points and zeroes, with explained adjustments", () => {
  const entries = players(buildGameViews(input()));
  const qb = entries.find(player => player.playerId === "qb");
  assert.equal(qb.score, 18);
  assert.equal(qb.components.find(component => component.key === "sleeper_adjustment").points, 1);
  assert.equal(qb.components.reduce((total, component) => total + component.points, 0), qb.score);
  assert.equal(entries.find(player => player.playerId === "bench").score, 0);
  assert.equal(entries.find(player => player.playerId === "te").score, 7);
  assert.equal(entries.find(player => player.playerId === "free").score, 2.5);
});

test("missing actual data is distinct from zero; scheduled games cannot show stale actual stats", () => {
  assert.equal(playerScoringDetails(undefined, { pass_yd: .04 }).total, null);
  assert.equal(playerScoringDetails({ pass_yd: 0 }, { pass_yd: .04 }).total, 0);
  const data = input(); data.games = [game("early", "2026-09-13T17:00:00Z", "pre")];
  const qb = players(buildGameViews(data)).find(player => player.playerId === "qb");
  assert.equal(qb.score, 0); assert.equal(qb.projectedScore, 9.6);
  assert.deepEqual(qb.compactStats, []); assert.deepEqual(qb.components, []);
});

test("games use the same custom DST score and final-floor components as the matchup engine", () => {
  const dst = players(buildGameViews(input())).find(player => player.playerId === "PHI");
  assert.equal(dst.score, -4); assert.equal(dst.projectedScore, null);
  assert.equal(dst.components.reduce((sum, row) => sum + row.points, 0), -4);
  assert.ok(dst.components.some(row => row.kind === "final_score_floor"));
});

test("historical views use the week's boxscore team instead of today's roster", () => {
  const data = input(); data.historical = true;
  data.playersById.qb.team = "DAL";
  data.summaries = new Map([["early", { boxscore: { players: [{ team: { abbreviation: "PHI" }, statistics: [{ athletes: [{ athlete: { displayName: "Home QB" } }] }] }] } }]]);
  const entries = players(buildGameViews(data));
  assert.equal(entries.find(player => player.playerId === "qb").team, "PHI");
  assert.ok(!entries.some(player => player.playerId === "bench"));
});

test("drive drilldowns merge duplicate current drives and preserve their own ordered plays", () => {
  const summary = { drives: { previous: [
    { id: "d1", team: { id: "1" }, result: "PUNT", plays: [{ id: "p1", text: "First drive only" }] },
    { id: "d2", team: { id: "2" }, plays: [{ id: "p3", sequenceNumber: 3, text: "Older detail" }] },
  ], current: { id: "d2", team: { id: "2" }, plays: [{ id: "p2", sequenceNumber: 2, text: "Second drive starts" }, { id: "p3", sequenceNumber: 3, text: "Corrected latest play" }] } } };
  const result = gameDriveDetails(summary, game("early", "2026-09-13T17:00:00Z", "in"));
  assert.deepEqual(result.driveResults.map(drive => drive.id), ["d2", "d1"]);
  assert.deepEqual(result.driveResults[0].plays.map(play => play.id), ["p2", "p3"]);
  assert.equal(result.driveResults[0].result, "In progress");
  assert.equal(result.latestPlay, "Corrected latest play");
  assert.equal(result.driveResults[1].plays.length, 1);
});
