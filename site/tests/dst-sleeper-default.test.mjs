import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sleeperDefaultDstAudit, SLEEPER_DEFAULT_DST_SETTINGS } from '../lib/dst/sleeper-default.js';
import { buildLeagueTeams } from '../lib/dst/dashboard.js';

const live = [{ id: 'g', statusState: 'in', teams: [{ abbreviation: 'WSH' }, { abbreviation: 'IND' }] }];
const score = (stats, games = live) => sleeperDefaultDstAudit(stats, games);

test('fixed rates match the captured Sleeper NFL app preset, including its special-teams defaults', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/sleeper-default-dst-preset.json', import.meta.url)));
  const enabled = Object.fromEntries(Object.entries(fixture.settings).filter(([, value]) => value !== null));
  assert.deepEqual(SLEEPER_DEFAULT_DST_SETTINGS, enabled);
});

for (const [allowed, expected] of [[0,10],[1,7],[6,7],[7,4],[13,4],[14,1],[20,1],[21,0],[27,0],[28,-1],[34,-1],[35,-4],[60,-4]]) {
  test(`Sleeper default points-allowed boundary: ${allowed} → ${expected}`, () => assert.equal(score({ pts_allow: allowed }).total, expected));
}

test('all default event categories contribute once using their own stat keys', () => {
  const result = score({ pts_allow: 21, sack: 2, int: 1, ff: 1, fum_rec: 1, safe: 1, blk_kick: 1,
    def_td: 1, def_st_td: 1, def_st_ff: 1, def_st_fum_rec: 1 });
  assert.equal(result.total, 25);
  assert.equal(result.components.reduce((sum, row) => sum + row.points, 0), 25);
  assert.equal(new Set(result.components.map(row => row.kind)).size, result.components.length);
});

test('special-teams bonuses follow the preset even when the feed also credits a recovery or forced fumble', () => {
  const result = score({ pts_allow: 21, ff: 1, fum_rec: 1, def_st_ff: 1, def_st_fum_rec: 1 });
  assert.equal(result.total, 5);
});

test('ignores precomputed fantasy points, individual-player return stats, yards, and disabled two-point returns', () => {
  assert.equal(score({ pts_allow: 21, pts_std: 999, pts_ppr: 999, st_td: 1, st_fum_rec: 2, st_ff: 2,
    yds_allow: 500, yds_allow_500_549: 1, def_2pt: 1, def_st_tkl_solo: 8, def_3_and_out: 5 }).total, 0);
});

test('pregame and bye scores are zero; a confirmed live shutout starts at ten', () => {
  assert.equal(score({ pts_allow: 0 }, [{ statusState: 'pre' }]).total, 0);
  assert.equal(score(undefined, []).total, 0);
  assert.equal(score({ pts_allow_0: 1 }).total, 10);
});

test('supports sparse points-allowed tier stats without inventing a shutout', () => {
  assert.equal(score({ pts_allow_14_20: 1, sack: 3 }).total, 4);
  for (const stats of [undefined, {}, { sack: 3 }, { gp: 1 }, { pts_allow: null }, { pts_allow: -1 },
    { pts_allow: '' }, { pts_allow: true }, { pts_allow: 1.5 }, { pts_allow_0: 1, pts_allow_14_20: 1 },
    { pts_allow_0: 2 }, { pts_allow: 14, pts_allow_0: 1 }, { pts_allow: 0, sack: 'bad' }]) {
    const result = score(stats);
    assert.equal(result.total, null, JSON.stringify(stats));
    assert.equal(result.status, 'unavailable');
    assert.ok(result.issues.length);
  }
});

test('corrections rebuild the comparison from raw stats without a reconciliation adjustment', () => {
  assert.equal(score({ pts_allow: 13, sack: 2 }).total, 6);
  const corrected = score({ pts_allow: 14, sack: 3 });
  assert.equal(corrected.total, 4);
  assert.ok(corrected.components.every(row => row.kind !== 'sleeper_reconciliation'));
});

test('does not turn aggregate weekly points allowed into a per-game tier for multiple games', () => {
  assert.equal(score({ pts_allow: 28 }, [live[0], { ...live[0], id: 'other' }]).status, 'unavailable');
});

test('real 2025 Week 1 stat examples reproduce the fixed preset independently of pts_std', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/sleeper-dst-2025-week1.json', import.meta.url)));
  for (const [team, expected] of Object.entries({ HOU: 7, CHI: 11, BAL: -2, MIA: 0, TEN: 10, DEN: 16 })) {
    assert.equal(score(fixture.stats[team]).total, expected, team);
  }
  assert.equal(Object.keys(fixture.stats).length, 32);
  for (const [team, stats] of Object.entries(fixture.stats)) {
    const result = score(stats);
    assert.equal(result.status, 'available', team);
    assert.equal(result.total, result.components.reduce((sum, row) => sum + row.points, 0), team);
  }
});

function input(actualDst = 0) {
  return { rosters: [{ roster_id: 1, owner_id: 'u' }], users: [],
    matchups: [{ roster_id: 1, matchup_id: 1, points: 12 + actualDst, starters: ['11', 'WAS'], starters_points: [12, actualDst] }],
    espnScores: { dstScores: { WSH: { points: 4, components: [] } } }, playersById: {},
    playerStats: { WAS: { pts_allow: 14, sack: 3, ff: 1, fum_rec: 1 } }, playerProjections: {},
    scoringSettings: Object.fromEntries(Object.keys(SLEEPER_DEFAULT_DST_SETTINGS).map(key => [key, 0])),
    rosterPositions: ['QB', 'DEF'], nflGames: live };
}

test('zeroed league rates and actual DST adjustments cannot change the default comparison or double count DST', () => {
  for (const actualDst of [0, 8, 4, -3]) {
    const [team] = buildLeagueTeams(input(actualDst));
    assert.equal(team.sleeperDstPoints, actualDst);
    assert.equal(team.sleeperTotal, 12 + actualDst);
    assert.equal(team.sleeperDefaultDstPoints, 7);
    assert.equal(team.sleeperDefaultTotal, 19);
    assert.equal(team.projectedCustomTotal, 16);
    assert.equal(team.customDstDelta, -3);
    assert.equal(team.starters[1].sleeperScore, actualDst);
    assert.equal(team.starters[1].sleeperDefaultScore, 7);
    assert.equal(team.oldDstAudit.total, 7);
  }
});

test('missing comparison stats stay unavailable without hiding or altering custom totals', () => {
  const data = input(); data.playerStats = {};
  const [team] = buildLeagueTeams(data);
  assert.equal(team.sleeperDefaultDstPoints, null);
  assert.equal(team.sleeperDefaultTotal, null);
  assert.equal(team.customDstDelta, null);
  assert.equal(team.starters[1].sleeperDefaultScore, null);
  assert.equal(team.projectedCustomTotal, 16);
});
