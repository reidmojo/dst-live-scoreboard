import test from "node:test";
import assert from "node:assert/strict";
import { sleeperLiveProjection, nflProjectionClock, withLiveProjection, displayedProjection, playerDisplayProjection, teamLiveEstimate, sleeperStyleWinProbability, matchupWinEstimate } from "../lib/dst/live-estimates.js";

const live = { statusState: "in", status: "In Progress", period: 2, clock: "0:00", completed: false };
const final = { ...live, statusState: "post", status: "Final", completed: true, period: 4 };
const starter = (id, score, projection, status) => ({ playerId: id, score, projectedScore: projection, liveProjectedScore: projection, projectionStatus: status });

test("live projection reproduces public Sleeper reference values, including defense weighting", () => {
  assert.equal(sleeperLiveProjection(15, 20, 1800), 21.25);
  assert.equal(sleeperLiveProjection(15, 20, 1800, true), 17.5);
  assert.equal(sleeperLiveProjection(0, 20, 1800), 10);
  assert.equal(sleeperLiveProjection(0, 20, 3600), 20);
  assert.equal(sleeperLiveProjection(-4, 6, 0, true), -4);
  assert.equal(sleeperLiveProjection(4, null, 0), 4);
  assert.equal(sleeperLiveProjection(null, 20, 1800), null);
  assert.equal(sleeperLiveProjection(4, null, 1800), null);
});

test("clock handles halftime, quarter changes, overtime and confirmed final status", () => {
  assert.deepEqual(nflProjectionClock({ statusState: "pre" }), { state: "pregame", remaining: 3600 });
  assert.deepEqual(nflProjectionClock({ ...live, status: "Halftime", clock: "" }), { state: "live", remaining: 1800 });
  assert.equal(nflProjectionClock({ ...live, period: 1, clock: "0:00" }).remaining, 2700);
  assert.equal(nflProjectionClock({ ...live, period: 2, clock: "15:00" }).remaining, 2700);
  assert.deepEqual(nflProjectionClock({ ...live, period: 5, clock: "8:30" }), { state: "live", remaining: 0 });
  assert.deepEqual(nflProjectionClock({ ...live, period: 4 }), { state: "live", remaining: 0 });
  assert.deepEqual(nflProjectionClock(final), { state: "final", remaining: 0 });
  for (const game of [null, { ...live, clock: "" }, { ...live, clock: "16:00" }, { ...final, completed: false }, { ...final, status: "Canceled" }, { ...live, status: "Suspended" }]) {
    assert.deepEqual(nflProjectionClock(game), { state: "unavailable", remaining: null });
  }
});

test("player projection keeps baseline and actual score immutable; missing data stays unavailable", () => {
  const player = { playerId: "qb", projectedScore: 20, score: 15, isDefense: false };
  const updated = withLiveProjection(player, live);
  assert.equal(displayedProjection(updated), 21.25);
  assert.equal(updated.projectedScore, 20);
  assert.equal(updated.score, 15);
  assert.equal(player.liveProjectedScore, undefined);
  assert.equal(displayedProjection(withLiveProjection(player, null)), null);
  assert.equal(withLiveProjection({ ...player, score: 0 }, null, { bye: true }).liveProjectedScore, 0);
  assert.equal(withLiveProjection({ ...player, playerId: "0", score: 0 }, null).projectionStatus, "final");
});

test("team projections combine independently scored actuals, live estimates and upcoming starters", () => {
  const team = { projectedCustomTotal: 25, starters: [starter("done", 20, 20, "final"), starter("live", 5, 8, "live"), starter("next", 0, 10, "pregame"), starter("0", 0, null, "final")] };
  assert.deepEqual(teamLiveEstimate(team), { actual: 25, projected: 38, complete: false });
  team.starters[1] = starter("live", 5, 5, "final");
  team.starters[2] = starter("next", 0, 0, "final");
  assert.deepEqual(teamLiveEstimate(team), { actual: 25, projected: 25, complete: true });
  assert.equal(teamLiveEstimate({ ...team, scoringProvisional: true }).complete, false);
  team.starters[1].liveProjectedScore = null;
  assert.equal(teamLiveEstimate(team).projected, null);
});

test("completed player references never feed back into team projections or win odds", () => {
  const player = withLiveProjection({ playerId: "qb", score: 20, projectedScore: 12.5 }, final);
  assert.equal(playerDisplayProjection(player, true), 12.5);
  assert.equal(playerDisplayProjection({ ...player, projectedScore: null }, true), null);
  assert.equal(playerDisplayProjection({ ...player, projectedScore: 0 }, true), 0);
  assert.equal(playerDisplayProjection({ ...player, liveProjectedScore: 18 }, false), 18);
  const team = { projectedCustomTotal: 20, starters: [player] };
  const opponent = { projectedCustomTotal: 10, starters: [starter("opp", 10, 25, "live")] };
  const estimate = teamLiveEstimate(team), odds = matchupWinEstimate([team, opponent]);
  player.projectedScore = 999;
  assert.deepEqual(estimate, { actual: 20, projected: 20, complete: true });
  assert.deepEqual(teamLiveEstimate(team), estimate);
  assert.deepEqual(matchupWinEstimate([team, opponent]), odds);
});

test("pregame and live win probabilities match independently captured Sleeper outputs", () => {
  for (const [actual, projected, otherActual, otherProjected, expected] of [
    [0, 123.23, 0, 108.2, 0.6194262145619176],
    [0, 119.75, 0, 116.35, 0.5269233993059224],
    [50, 130, 70, 115, 0.6609080612996454],
  ]) {
    const left = { actual, projected, complete: false }, right = { actual: otherActual, projected: otherProjected, complete: false };
    const result = sleeperStyleWinProbability(left, right);
    assert.ok(Math.abs(result.left - expected) < 1e-7);
    assert.equal(result.left + result.right, 1);
    assert.ok(Math.abs(sleeperStyleWinProbability(right, left).left - result.right) < 1e-12);
  }
});

test("odds remain 1–99 until confirmed final, including overtime and coincidental score/projection equality", () => {
  const left = { actual: 120, projected: 120, complete: false }, right = { actual: 100, projected: 100, complete: false };
  assert.equal(sleeperStyleWinProbability(left, right).left, 0.99);
  left.complete = right.complete = true;
  assert.deepEqual(sleeperStyleWinProbability(left, right), { left: 1, right: 0, tied: false, final: true });
  assert.deepEqual(sleeperStyleWinProbability(left, left), { left: 0.5, right: 0.5, tied: true, final: true });
  assert.deepEqual(sleeperStyleWinProbability({ actual: -4, projected: -4, complete: true }, { actual: -5, projected: -5, complete: true }), { left: 1, right: 0, tied: false, final: true });
  assert.equal(sleeperStyleWinProbability({ actual: 4, projected: null }, right), null);
  assert.equal(sleeperStyleWinProbability({ actual: -4, projected: -3 }, right), null);
  assert.equal(matchupWinEstimate([{ projectedCustomTotal: 0, starters: [] }]), null);
});
