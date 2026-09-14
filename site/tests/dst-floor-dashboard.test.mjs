import test from 'node:test';
import assert from 'node:assert/strict';

test('live/final/corrected dashboard totals and durable snapshots preserve raw DST points', async () => {
  const OriginalDate = Date;
  const originalFetch = globalThis.fetch;
  let now = OriginalDate.parse('2025-09-08T12:00:00Z');
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  const leagueId = '1239299227176157184';
  const snapshots = new Map([[`${leagueId}:2025:1`, { dashboard: JSON.stringify({ source: { scoringVersion: '2026-09-09.5' }, health: { ok: true } }) }]]);
  const liveCache = new Map();
  const db = { prepare(sql) {
    let args;
    return {
      bind(...values) { args = values; return this; },
      async first() { return sql.includes('dst_live_cache') ? liveCache.get(args[0]) : snapshots.get(args.join(':')); },
      async run() {
        if (sql.includes('dst_live_cache')) liveCache.set(args[0], { dashboard: args[1] });
        else snapshots.set(args.slice(0, 3).join(':'), { dashboard: args[3], finalized_at: args[4] });
        return {};
      },
    };
  } };
  let completed = false, touchdowns = 6, fieldGoals = 0, espnCalls = 0, statsAvailable = true;
  const league = { league_id: leagueId, season: '2025', name: 'Test league', status: 'complete', roster_positions: ['QB', 'DEF'], settings: { last_scored_leg: 1 } };
  const routes = {
    '/v1/state/nfl': { season: '2025', season_type: 'regular', week: 1 },
    [`/v1/league/${leagueId}`]: league,
    [`/v1/league/${leagueId}/rosters`]: [{ roster_id: 1, owner_id: 'owner' }],
    [`/v1/league/${leagueId}/users`]: [],
    [`/v1/league/${leagueId}/matchups/1`]: [{ roster_id: 1, matchup_id: 1, points: 9, starters: ['11', 'BAL'], starters_points: [12, -3] }],
    '/v1/players/nfl': { 11: { position: 'QB' } },
    '/v1/stats/nfl/regular/2025/1': { BAL: { pts_allow: 42 } },
    '/v1/projections/nfl/regular/2025/1': {},
  };
  globalThis.fetch = async (url) => {
    if (url.includes('/stats/nfl/')) return Response.json(statsAvailable ? { BAL: { pts_allow: 42 } } : {});
    if (url.includes('/scoreboard?')) {
      espnCalls += 1;
      return Response.json({ events: [{ id: 'game', date: '2025-09-07T17:00:00Z', status: {
        type: { state: completed ? 'post' : 'in', completed, name: completed ? 'STATUS_FINAL' : 'STATUS_IN_PROGRESS', description: completed ? 'Final' : 'In Progress' },
      }, competitions: [{ competitors: [{ id: '1', team: { abbreviation: 'BAL' } }, { id: '2', team: { abbreviation: 'IND' } }] }] }] });
    }
    if (url.includes('/summary?')) {
      espnCalls += 1;
      const scoringPlays = Array.from({ length: touchdowns + fieldGoals }, (_, index) => ({ id: `p${index}`, team: { id: '2' }, scoringPlay: true,
        scoringType: { name: index < touchdowns ? 'touchdown' : 'field-goal' }, type: { text: index < touchdowns ? 'Passing Touchdown' : 'Field Goal Good' } }));
      return Response.json({ header: { id: 'game' }, scoringPlays, drives: { previous: scoringPlays.map((p, index) => ({ id: `d${index}`, team: { id: '2' },
        result: index < touchdowns ? 'TD' : 'FG', plays: [p] })) } });
    }
    const data = routes[new URL(url).pathname];
    return data ? Response.json(data) : new Response('', { status: 404 });
  };
  const request = new Request('https://example.test/?season=2025&week=1');
  function check(dashboard, raw, displayed, adjustment) {
    const team = dashboard.teams[0];
    assert.equal(dashboard.health.ok, true);
    assert.equal(team.customDstRawPoints, raw);
    assert.equal(team.customDstPoints, displayed);
    assert.equal(team.customDstFloorAdjustment, adjustment);
    assert.equal(team.projectedCustomTotal, 9 - (-3) + displayed);
    assert.equal(team.starters[1].score, displayed);
    assert.equal(team.newDstAudit.rawTotal, raw);
    assert.equal(team.newDstAudit.total, displayed);
    assert.equal(team.newDstAudit.floorAdjustment, adjustment);
    assert.equal(team.newDstAudit.components.reduce((n, row) => n + row.points, 0), displayed);
    assert.equal(dashboard.dstScores.BAL.rawPoints, raw);
    assert.equal(dashboard.dstScores.BAL.floorAdjustment, adjustment);
    assert.equal(dashboard.scoring.finalDstFloor, -4);
  }
  try {
    const { getDashboard } = await import(`../lib/dst/dashboard.js?floor=${Math.random()}`);
    // An old-comparison snapshot must not bypass default-score reconstruction, even with the same custom scorer.
    const ongoing = await getDashboard(request, db);
    check(ongoing, -6, -6, 0);
    assert.equal(ongoing.source.snapshot, false);
    assert.equal(ongoing.correction.status, 'live');
    assert.equal(ongoing.health.pollIntervalMs, 15_000);

    now += 60_000; completed = true;
    const ended = await getDashboard(request, db);
    check(ended, -6, -4, 2);
    assert.equal(ended.correction.status, 'provisional');
    assert.equal(ended.source.snapshotSaved, false);
    assert.equal(ended.health.pollIntervalMs, 60_000);
    const finalObservedAt = ended.correction.allGamesFinalObservedAt;
    assert.equal(finalObservedAt, new Date(now).toISOString());

    // A +0.5 correction changes raw -6 to -5.5, not displayed -4 to -3.5.
    now += 60_000; touchdowns = 5; fieldGoals = 1;
    check(await getDashboard(request, db), -5.5, -4, 1.5);
    now += 60_000; touchdowns = 3;
    check(await getDashboard(request, db), -3.5, -3.5, 0);
    now += 60_000; touchdowns = 5;
    check(await getDashboard(request, db), -5.5, -4, 1.5);

    // The durable live cache carries the grace clock into a cold worker.
    now = OriginalDate.parse(finalObservedAt) + 10 * 60_000;
    const postgameWorker = await import(`../lib/dst/dashboard.js?postgame-cold=${Math.random()}`);
    const hourly = await postgameWorker.getDashboard(request, db);
    check(hourly, -5.5, -4, 1.5);
    assert.equal(hourly.health.pollIntervalMs, 3_600_000);
    assert.equal(hourly.correction.allGamesFinalObservedAt, finalObservedAt);

    // Hourly browser polling does not make the API cache hourly: manual refresh
    // can still retrieve a correction well before the next automatic update.
    now += 60_000; touchdowns = 3;
    const manualCallsBefore = espnCalls;
    const manual = await postgameWorker.getDashboard(request, db);
    check(manual, -3.5, -3.5, 0);
    assert.ok(espnCalls > manualCallsBefore);
    assert.equal(manual.health.pollIntervalMs, 3_600_000);
    assert.equal(manual.correction.allGamesFinalObservedAt, finalObservedAt);
    now += 60_000; completed = false;
    const reopened = await postgameWorker.getDashboard(request, db);
    assert.equal(reopened.health.pollIntervalMs, 15_000);
    assert.equal(reopened.correction.allGamesFinalObservedAt, undefined);
    now += 60_000; completed = true; touchdowns = 5;
    const reended = await postgameWorker.getDashboard(request, db);
    assert.equal(reended.health.pollIntervalMs, 60_000);
    assert.notEqual(reended.correction.allGamesFinalObservedAt, finalObservedAt);

    now = OriginalDate.parse('2025-09-10T05:00:00Z');
    statsAvailable = false;
    const incomplete = await getDashboard(request, db);
    assert.equal(incomplete.health.ok, false);
    assert.equal(incomplete.correction.status, 'provisional');
    assert.equal(incomplete.source.snapshotSaved, false);
    assert.equal(incomplete.teams[0].sleeperDefaultDstPoints, null);
    assert.equal(incomplete.teams[0].customDstPoints, -4);
    statsAvailable = true; now += 60_000;
    const frozen = await getDashboard(request, db);
    check(frozen, -5.5, -4, 1.5);
    assert.equal(frozen.source.snapshotSaved, true);
    const stored = JSON.parse(snapshots.get(`${leagueId}:2025:1`).dashboard);
    check(stored, -5.5, -4, 1.5);

    // A cold worker reads raw and adjusted values from JSON without flooring again.
    now += 60_000;
    const callsBefore = espnCalls;
    const cold = await import(`../lib/dst/dashboard.js?floor-cold=${Math.random()}`);
    const restored = await cold.getDashboard(request, db);
    check(restored, -5.5, -4, 1.5);
    assert.equal(restored.source.snapshot, true);
    assert.equal(restored.health.pollIntervalMs, 0);
    assert.equal(espnCalls, callsBefore);
    assert.equal(restored.dstScores.BAL.components.filter(row => row.kind === 'final_score_floor').length, 1);
  } finally {
    globalThis.Date = OriginalDate;
    globalThis.fetch = originalFetch;
  }
});
