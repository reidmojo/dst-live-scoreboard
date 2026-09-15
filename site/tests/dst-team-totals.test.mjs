import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLeagueTeams } from '../lib/dst/dashboard.js';
import { matchupWinEstimate, teamLiveEstimate } from '../lib/dst/live-estimates.js';

function input() {
  return {
    rosters: [{ roster_id: 1, owner_id: 'u', players: ['11', '22', 'WAS'], settings: { fpts: 999 } }],
    users: [],
    matchups: [{ roster_id: 1, matchup_id: 1, points: 20, custom_points: null,
      starters: ['11', '0', 'WAS'], starters_points: [12, 0, 8], players_points: { 11: 12, 22: 35, WAS: 8 } }],
    espnScores: { dstScores: { WSH: { points: 4, components: [] } } },
    playersById: { 11: { position: 'QB', team: 'PHI' } },
    playerStats: { WAS: { pts_allow: 14, sack: 3, ff: 1, fum_rec: 1 } },
    playerProjections: { 11: { pass_yd: 200 }, WAS: { pts_std: 6 } },
    scoringSettings: { pass_yd: 0.04 },
    rosterPositions: ['QB', 'RB', 'DEF'],
    nflGames: [{ id: 'g1', date: '2026-09-13T17:00:00Z', status: 'In Progress', statusState: 'in',
      period: 2, clock: '0:00', completed: false, teams: [{ abbreviation: 'PHI' }, { abbreviation: 'WSH' }] }],
  };
}

test('commissioner team overrides cannot affect actuals, default comparison, projections or win chances', () => {
  const data = input();
  const [baseline] = buildLeagueTeams(data);
  const opponentData = input();
  opponentData.matchups[0].starters_points[0] = 10;
  const [opponent] = buildLeagueTeams(opponentData);
  const estimate = teamLiveEstimate(baseline), odds = matchupWinEstimate([baseline, opponent]);
  assert.equal(baseline.projectedCustomTotal, 16);
  assert.equal(baseline.sleeperDefaultTotal, 19);
  assert.ok(Number.isFinite(estimate.projected));
  assert.ok(odds && Number.isFinite(odds.left));
  for (const override of [undefined, null, 16, 20, 0, -4, 99.99, 146.13999938964844]) {
    data.matchups[0].custom_points = override;
    const [updated] = buildLeagueTeams(data);
    assert.deepEqual(updated, baseline, `custom_points=${override}`);
    assert.deepEqual(teamLiveEstimate(updated), estimate);
    assert.deepEqual(matchupWinEstimate([updated, opponent]), odds);
  }
});

test('aggregate points are not a fallback source for our starter totals', () => {
  const data = input(), [baseline] = buildLeagueTeams(data);
  for (const points of [undefined, null, 0, -10, 999]) {
    data.matchups[0].points = points;
    assert.deepEqual(buildLeagueTeams(data)[0], baseline);
  }
});

test('zero, nonzero and negative Sleeper D/ST scores are excluded before adding our D/ST once', () => {
  for (const sleeperDst of [0, 8, -3]) for (const customDst of [0, 7, -1.5]) {
    const data = input();
    data.matchups[0].starters_points[2] = sleeperDst;
    data.matchups[0].custom_points = 12 + customDst;
    data.espnScores.dstScores.WSH.points = customDst;
    const [team] = buildLeagueTeams(data);
    assert.equal(team.nonDstSleeperTotal, 12);
    assert.equal(team.projectedCustomTotal, 12 + customDst);
    assert.equal(team.starters[2].score, customDst);
    assert.equal(team.sleeperDefaultTotal, 19);
  }
});

test('starter sum excludes bench and empty slots, retains negatives, and follows player stat corrections', () => {
  const data = input();
  data.matchups[0].starters_points = [-1.25, 100, 8];
  const [negative] = buildLeagueTeams(data);
  assert.equal(negative.nonDstSleeperTotal, -1.25);
  assert.equal(negative.projectedCustomTotal, 2.75);
  assert.equal(negative.starters[1].score, 0);
  data.matchups[0].starters_points[0] = 0;
  assert.equal(buildLeagueTeams(data)[0].projectedCustomTotal, 4);
  data.matchups[0].starters_points[0] = 12.34;
  assert.equal(buildLeagueTeams(data)[0].projectedCustomTotal, 16.34);
});

test('players_points fallback totals only starters even after an override', () => {
  const data = input();
  data.matchups[0].starters_points = [];
  data.matchups[0].custom_points = 16;
  data.matchups[0].players_points['0'] = 100;
  assert.equal(buildLeagueTeams(data)[0].projectedCustomTotal, 16);
});

test('missing starter scores cannot be concealed by a commissioner total', () => {
  const data = input();
  data.matchups[0].custom_points = 16;
  data.matchups[0].players_points = {};
  for (const points of [null, undefined, NaN, Infinity, 'invalid']) {
    data.matchups[0].starters_points[0] = points;
    assert.throws(() => buildLeagueTeams(data), /starter points are missing or invalid/);
  }
});

test('an empty D/ST slot contributes no defense even with a commissioner override', () => {
  const data = input();
  data.matchups[0].starters[2] = '0';
  data.matchups[0].custom_points = 16;
  const [team] = buildLeagueTeams(data);
  assert.equal(team.sleeperTotal, 12);
  assert.equal(team.customDstPoints, 0);
  assert.equal(team.projectedCustomTotal, 12);
});

test('observed Week 1 overrides reproduce independent totals instead of double counting', () => {
  // Public matchup API observation, 2026-09-15; only score values retained.
  for (const [nonDst, customDst, override, expected] of [
    [139.14, 7, 146.13999938964844, 146.14],
    [134.16, -1.5, 132.66000366210938, 132.66],
    [120.34, 17, 137.33999633789062, 137.34],
  ]) {
    const data = input();
    data.matchups[0].points = nonDst;
    data.matchups[0].custom_points = override;
    data.matchups[0].starters_points = [nonDst, 0, 0];
    data.espnScores.dstScores.WSH.points = customDst;
    assert.equal(buildLeagueTeams(data)[0].projectedCustomTotal, expected);
  }
});
