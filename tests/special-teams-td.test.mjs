import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scoreWeekFromEspn } from '../src/scoring.js';

const kicking = { id: '1', abbreviation: 'BAL' };
const receiving = { id: '2', abbreviation: 'IND' };
const event = { id: 'test', status: { type: { state: 'in' } }, competitions: [{ competitors: [kicking, receiving].map(team => ({ id: team.id, team })) }] };
const td = (type, team = receiving, extras = {}) => ({ id: 'td', type: { text: type }, scoringPlay: true, scoringType: { name: 'touchdown' },
  team, start: { team: kicking }, end: { team }, period: { number: 4 }, clock: { displayValue: '0:00' }, ...extras });
function score(play, summaryPlay = play, driveExtras = {}, current = null) {
  const drive = { id: 'd1', team: kicking, result: 'TD', plays: [play], ...driveExtras };
  return scoreWeekFromEspn([event], new Map([[event.id, { drives: { previous: [drive], current }, scoringPlays: summaryPlay ? [summaryPlay] : [] }]])).dstScores;
}
function assertTd(result, scoringTeam) {
  const concedingTeam = scoringTeam === 'BAL' ? 'IND' : 'BAL';
  assert.equal(result[scoringTeam].points, 6);
  assert.equal(result[concedingTeam].points, -1);
  assert.deepEqual(result[scoringTeam].components.map(c => c.kind), ['dst_touchdown']);
  assert.deepEqual(result[concedingTeam].components.map(c => c.kind), ['special_teams_touchdown_allowed']);
  for (const team of Object.values(result)) assert.deepEqual(team.issues, []);
  const debit = result[concedingTeam].components[0];
  assert.equal(debit.period, 4);
  assert.equal(debit.clock, '0:00');
  assert.equal(debit.source, 'ESPN');
}
for (const type of ['Kickoff Return Touchdown', 'Punt Return Touchdown', 'Blocked Punt Touchdown', 'Blocked Field Goal Touchdown', 'Missed Field Goal Return Touchdown', 'Free Kick Return Touchdown']) {
  test(`${type}: +6 / -1 once across drive and scoring feeds, even on final play`, () => assertTd(score(td(type)), 'IND'));
}
for (const type of ['Kickoff Return Touchdown', 'Punt Touchdown']) {
  test(`${type} recovered by kicking team reverses who gets +6 / -1`, () => {
    const p = td(type, kicking);
    assertTd(score(p, p, { team: receiving, result: 'FUMBLE TD' }), 'BAL');
  });
}
test('no extra bucket or duplicate debit when a following active drive is present', () => {
  const p = td('Punt Return Touchdown');
  assertTd(score(p, p, {}, { id: 'd2', team: receiving, start: { text: 'IND 35', period: { number: 4 } }, plays: [] }), 'IND');
});
test('kick context survives abbreviated generic fumble-return scoring summary', () => {
  const p = td('Fumble Recovery (Opponent)', kicking, { text: 'BAL kicks 65 yards. IND FUMBLES. BAL recovers for TOUCHDOWN.' });
  const short = { id: p.id, type: p.type, team: kicking, scoringType: p.scoringType, text: 'BAL 1 Yd Fumble Return' };
  assertTd(score(p, short, { team: receiving, result: 'FUMBLE TD' }), 'BAL');
});
test('scoring summary can confirm TD before the full kick play is marked scoring', () => {
  const p = td('Fumble Recovery (Opponent)', kicking, { scoringPlay: false, text: 'BAL kicks 65 yards. IND FUMBLES. BAL recovers.' });
  const short = { id: p.id, type: p.type, team: kicking, scoringType: { name: 'touchdown' }, text: 'BAL 1 Yd Fumble Return', period: p.period, clock: p.clock };
  assertTd(score(p, short, { team: receiving, result: 'FUMBLE TD' }), 'BAL');
});
test('No Play on the appended extra point does not erase the preceding kick TD', () => {
  const p = td('Kickoff Return Touchdown', receiving, { text: 'IND kickoff return TOUCHDOWN. EXTRA POINT penalty - No Play.' });
  assertTd(score(p), 'IND');
});
test('duplicate current/completed kick-TD drive produces one credit and one debit', () => {
  const p = td('Kickoff Return Touchdown');
  assertTd(score(p, p, { team: receiving }, { id: 'd1', team: receiving, result: 'TD', plays: [p] }), 'IND');
});
for (const type of ['Interception Return Touchdown', 'Fumble Recovery (Opponent) Touchdown']) {
  test(`${type} against the offense does not charge the conceding DST`, () => {
    const r = score(td(type));
    assert.equal(r.IND.points, 6);
    assert.equal(r.BAL.points, 0);
    assert.deepEqual(r.BAL.components, []);
    assert.deepEqual(r.BAL.issues, []);
  });
}
test('offensive TD in punt formation remains one offensive deduction and no DST bonus', () => {
  const r = score(td('Passing Touchdown', kicking, { text: '(Punt formation) BAL pass for TOUCHDOWN.' }));
  assert.equal(r.BAL.points, 0);
  assert.equal(r.IND.points, -1);
  assert.deepEqual(r.IND.components.map(c => c.kind), ['touchdown_allowed']);
  assert.deepEqual(r.IND.issues, []);
});
test('blocked conversion returned for two points does not get +6 or -1', () => {
  const p = td('Blocked Extra Point', receiving, { text: 'EXTRA POINT blocked and returned.', scoringType: { name: 'two-point-conversion' } });
  const r = score(p, p, { result: 'END OF GAME' });
  assert.equal(r.BAL.points, 0);
  assert.equal(r.IND.points, 0);
});
test('rescinded special-teams TD removes both credit and debit on recomputation', () => {
  const p = td('Kickoff Return Touchdown');
  assertTd(score(p), 'IND');
  const r = score({ ...p, scoringPlay: false }, null, { result: 'END OF GAME' });
  assert.equal(r.BAL.points, 0);
  assert.equal(r.IND.points, 0);
});
test('explicitly nullified kick TD has neither credit nor debit', () => {
  const p = td('Kickoff Return Touchdown', receiving, { text: 'Touchdown nullified by penalty - No Play.' });
  const r = score(p, p, { result: 'END OF GAME' });
  assert.equal(r.BAL.points, 0);
  assert.equal(r.IND.points, 0);
});
test('unresolved scoring team awards neither side and flags the feed', () => {
  const p = td('Kickoff Return Touchdown', { id: 'unknown' });
  const r = score(p);
  for (const team of Object.values(r)) {
    assert.equal(team.points, 0);
    assert.deepEqual(team.issues, ['Return touchdown awaiting scoring-team confirmation']);
  }
});
test('real ESPN kick touchdowns apply +6 / -1 to the correct sides', async () => {
  const cases = JSON.parse(await readFile(new URL('./fixtures/espn-special-teams-td.json', import.meta.url)));
  for (const { name, event, summary, scoringTeam, concedingTeam } of cases) {
    const r = scoreWeekFromEspn([event], new Map([[event.id, summary]])).dstScores;
    assert.equal(r[scoringTeam].points, 6, `${name}: scoring DST`);
    assert.equal(r[concedingTeam].points, -1, `${name}: conceding DST`);
    assert.deepEqual(r[concedingTeam].components.map(c => c.kind), ['special_teams_touchdown_allowed']);
    for (const team of Object.values(r)) assert.deepEqual(team.issues, [], name);
  }
});
