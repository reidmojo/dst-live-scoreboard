import test from 'node:test';
import assert from 'node:assert/strict';
import { withPostgameRefresh } from '../lib/dst/polling.js';

const now = Date.parse('2026-09-15T03:30:00Z');
const minute = 60_000;
function dashboard(overrides = {}) {
  return {
    league: { id: 'league' }, selected: { season: '2026', week: 1 },
    health: { ok: true, stale: false, pollIntervalMs: minute },
    correction: { status: 'provisional' },
    nflGames: [{ id: 'a', completed: true }, { id: 'b', completed: true }],
    ...overrides,
  };
}
const firstFinal = withPostgameRefresh(dashboard(), undefined, now);

test('postgame grace starts at observation, switching to hourly at exactly ten minutes', () => {
  assert.equal(firstFinal.correction.allGamesFinalObservedAt, new Date(now).toISOString());
  assert.equal(firstFinal.health.pollIntervalMs, minute);
  assert.equal(withPostgameRefresh(dashboard(), firstFinal, now + 10 * minute - 1).health.pollIntervalMs, minute);
  assert.equal(withPostgameRefresh(dashboard(), firstFinal, now + 10 * minute).health.pollIntervalMs, 60 * minute);
});

test('corrections and reordered games preserve the original grace period', () => {
  const corrected = dashboard({ nflGames: [{ id: 'b', completed: true }, { id: 'a', completed: true }], dstScores: { BAL: { points: 7 } } });
  const updated = withPostgameRefresh(corrected, firstFinal, now + 20 * minute);
  assert.equal(updated.health.pollIntervalMs, 60 * minute);
  assert.equal(updated.correction.allGamesFinalObservedAt, firstFinal.correction.allGamesFinalObservedAt);
  assert.equal(updated.dstScores.BAL.points, 7);
});

test('new week, season, league, or game slate gets its own grace period', () => {
  for (const changes of [
    { selected: { season: '2026', week: 2 } },
    { selected: { season: '2027', week: 1 } },
    { league: { id: 'different-league' } },
    { nflGames: [{ id: 'a', completed: true }, { id: 'c', completed: true }] },
    { nflGames: [{ id: 'a', completed: true }] },
  ]) {
    const updated = withPostgameRefresh(dashboard(changes), firstFinal, now + 20 * minute);
    assert.equal(updated.health.pollIntervalMs, minute);
    assert.equal(updated.correction.allGamesFinalObservedAt, new Date(now + 20 * minute).toISOString());
  }
});

test('remaining scheduled/live/unconfirmed games cannot trigger hourly polling', () => {
  for (const game of [{ completed: false, statusState: 'pre' }, { completed: false, statusState: 'in' }, { statusState: 'post' }]) {
    const current = dashboard({ nflGames: [{ id: 'a', completed: true }, { id: 'b', ...game }] });
    const updated = withPostgameRefresh(current, firstFinal, now + 20 * minute);
    assert.equal(updated.health.pollIntervalMs, minute);
    assert.equal(updated.correction.allGamesFinalObservedAt, undefined);
  }
  const empty = dashboard({ nflGames: [] });
  assert.equal(withPostgameRefresh(empty, firstFinal, now + 20 * minute), empty);
});

test('a reopened game restores live cadence and starts a fresh grace when it finishes again', () => {
  const live = dashboard({ correction: { status: 'live' }, health: { ok: true, pollIntervalMs: 15_000 }, nflGames: [{ id: 'a', completed: false }, { id: 'b', completed: true }] });
  const reopened = withPostgameRefresh(live, firstFinal, now + 20 * minute);
  assert.equal(reopened.health.pollIntervalMs, 15_000);
  assert.equal(reopened.correction.allGamesFinalObservedAt, undefined);
  const reended = withPostgameRefresh(dashboard(), reopened, now + 30 * minute);
  assert.equal(reended.health.pollIntervalMs, minute);
  assert.equal(reended.correction.allGamesFinalObservedAt, new Date(now + 30 * minute).toISOString());
});

test('unhealthy/stale responses keep retrying; invalid or future saved timestamps restart grace', () => {
  for (const health of [{ ok: false, stale: false }, { ok: true, stale: true }]) {
    assert.equal(withPostgameRefresh(dashboard({ health }), firstFinal, now + 20 * minute).health.pollIntervalMs, minute);
  }
  for (const timestamp of ['invalid', undefined, new Date(now + minute).toISOString()]) {
    const previous = { ...firstFinal, correction: { status: 'provisional', allGamesFinalObservedAt: timestamp } };
    assert.equal(withPostgameRefresh(dashboard(), previous, now).health.pollIntervalMs, minute);
  }
});

test('finalized results remain paused', () => {
  const frozen = dashboard({ correction: { status: 'finalized' }, health: { ok: true, pollIntervalMs: 0 } });
  assert.equal(withPostgameRefresh(frozen, firstFinal, now + 20 * minute).health.pollIntervalMs, 0);
});
