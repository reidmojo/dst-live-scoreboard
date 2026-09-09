import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scoreWeekFromEspn } from '../src/scoring.js';

const A = { id: '1', abbreviation: 'BAL' };
const B = { id: '2', abbreviation: 'IND' };
const event = { id: 'test', status: { type: { state: 'in' } }, competitions: [{ competitors: [A, B].map(team => ({ id: team.id, team })) }] };
const start = (text = 'IND 30', period = 1) => ({ text, period: { number: period } });
const possession = (team = A, text = 'IND 30', extras = {}) => ({ id: 'next', team, start: start(text), plays: [], ...extras });
const snap = (team = A, spot = 'IND 30', extras = {}) => ({ id: 'snap', type: { text: 'Rush' }, start: { team, possessionText: spot }, end: { team }, ...extras });
const kick = (extras = {}) => ({ id: 'kick', type: { text: 'Muffed Punt Recovery (Opponent)' }, text: 'BAL punts. IND MUFFS. RECOVERED by BAL.', start: { team: A }, end: { team: A }, period: { number: 1 }, ...extras });
const puntDrive = (play = kick(), extras = {}) => ({ id: 'punt', team: A, result: 'PUNT', start: start('BAL 20'), end: start('BAL 40'), plays: [play], ...extras });
function score(previous, current, scoringPlays = []) {
  return scoreWeekFromEspn([event], new Map([['test', { drives: { previous, current }, scoringPlays }]])).dstScores;
}
function totals(result, a, b) {
  assert.equal(result.BAL.points, a, 'BAL');
  assert.equal(result.IND.points, b, 'IND');
  assert.deepEqual(result.BAL.issues, []);
  assert.deepEqual(result.IND.issues, []);
}

for (const [spot, points] of [['BAL 19', 1], ['BAL 20', 1.5], ['50', 1.5], ['IND 49', 2.5], ['IND 20', 2.5], ['IND 19', 3.5]]) {
  test(`kicking team recovers muffed punt, starts at ${spot}: +${points}, no receiving-side penalty`, () => {
    const r = score([puntDrive()], possession(A, spot));
    totals(r, points, 0);
    assert.equal(r.BAL.components[0].kind, 'special_teams_recovery');
  });
}
test('successful onside kick earns own-45 bucket before first snap', () => {
  const p = kick({ type: { text: 'Kickoff' }, text: 'BAL kicks onside. RECOVERED by BAL.' });
  totals(score([], possession(A, 'BAL 45', { plays: [p] })), 1.5, 0);
});
test('made FG deduction and separate onside recovery both stand', () => {
  const p = kick({ type: { text: 'Kickoff' }, text: 'BAL kicks onside. RECOVERED by BAL.' });
  const fg = puntDrive(null, { result: 'FG', plays: [] });
  const fieldGoal = { id: 'fg', scoringType: { name: 'field-goal' }, team: A };
  totals(score([fg], possession(A, 'BAL 45', { plays: [p] }), [fieldGoal]), 1.5, -0.5);
});
for (const text of ['BAL kicks onside. IND recovers.', 'BAL kicks. IND MUFFS and recovers.', 'BAL kicks for a touchback.']) {
  test(`kickoff reception earns zero: ${text}`, () => {
    const p = kick({ type: { text: 'Kickoff' }, text, end: { team: B } });
    totals(score([], possession(B, 'IND 35', { plays: [p] })), 0, 0);
  });
}
test('ordinary downed punt has only the receiving DST bucket', () => {
  const p = kick({ type: { text: 'Punt' }, text: 'BAL punts 40 yards, downed by BAL.', end: { team: B } });
  totals(score([puntDrive(p)], possession(B, 'IND 30')), 0, 1.5);
});
test('receiving team recovering its own punt muff still gets only the normal stop bucket', () => {
  const p = kick({ end: { team: B } });
  totals(score([puntDrive(p)], possession(B, 'IND 30')), 0, 1.5);
});
test('kick recovery copied into a receiving-team FUMBLE drive counts once', () => {
  const p = kick();
  const temporary = { ...possession(B), id: 'temporary', result: 'FUMBLE', offensivePlays: 0, plays: [p] };
  totals(score([puntDrive(p), temporary], possession(A)), 2.5, 0);
});
test('punt recovery inside a continuing drive uses next snap position, including enforcement', () => {
  totals(score([puntDrive(kick(), { plays: [snap(A, 'BAL 20', { id: 'before' }), kick(), snap(A, 'IND 24')], result: 'END OF HALF' })]), 2.5, 0);
});
test('unknown recovery location is provisional rather than guessed', () => {
  const r = score([puntDrive()], possession(A, ''));
  assert.equal(r.BAL.points, 0);
  assert.deepEqual(r.BAL.issues, ['Kick recovery awaiting field position']);
});
test('confirmed recovery awaiting next possession is provisional', () => {
  assert.deepEqual(score([puntDrive()]).BAL.issues, ['Kick recovery awaiting offensive possession']);
});
test('kick recovery on last play without offensive possession earns no bucket', () => {
  totals(score([puntDrive(kick(), { result: 'END OF GAME' })]), 0, 0);
});
test('halftime kickoff cannot confirm a preceding recovery', () => {
  const p = kick({ period: { number: 2 } });
  const later = possession(A, 'BAL 35', { start: start('BAL 35', 3), plays: [kick({ id: 'second-half', type: { text: 'Kickoff' }, text: 'IND kicks for a touchback.', start: { team: B }, end: { team: A } })] });
  totals(score([puntDrive(p, { result: 'END OF HALF' })], later), 0, 0);
});
test('nullified kick recovery does not award points', () => {
  totals(score([puntDrive(kick({ text: 'BAL recovers. Penalty - No Play.' }))], possession(A)), 0, 0);
});
test('punt recovered for touchdown gets six only, including duplicate scoring feed', () => {
  const p = kick({ type: { text: 'Punt Touchdown' }, scoringPlay: true, scoringType: { name: 'touchdown' }, team: A });
  totals(score([puntDrive(p, { result: 'TD' })], possession(A), [p]), 6, -1);
});
test('kickoff fumble recovered by kicking team for touchdown gets six only', () => {
  const p = kick({ type: { text: 'Kickoff' }, text: 'BAL kicks 60 yards. IND FUMBLES. RECOVERED by BAL for TOUCHDOWN.', scoringPlay: true, scoringType: { name: 'touchdown' }, team: A });
  totals(score([puntDrive(p, { result: 'TD' })], possession(A), [p]), 6, -1);
});
test('safety followed by conceding team recovering free kick: safety and recovery go to different DSTs', () => {
  const safety = puntDrive(null, { result: 'SAFETY', plays: [] });
  const p = kick({ type: { text: 'Free Kick' }, text: 'BAL kicks. IND MUFFS. RECOVERED by BAL.' });
  totals(score([safety], possession(A, 'BAL 45', { plays: [p] })), 1.5, 2);
});
test('kick-only receiving drive after safety cannot add a phantom safety bucket', () => {
  const safety = puntDrive(null, { result: 'SAFETY', plays: [] });
  const p = kick({ type: { text: 'Free Kick' }, text: 'BAL kicks. IND MUFFS. RECOVERED by BAL.' });
  const temporary = { ...possession(B), id: 'temporary', result: 'FUMBLE', offensivePlays: 0, plays: [p] };
  totals(score([safety, temporary], possession(A, 'BAL 45')), 1.5, 2);
});

const doubleTurnover = { id: 'double', type: { text: 'Pass Interception Return' }, text: 'BAL pass INTERCEPTED by IND. FUMBLES. RECOVERED by BAL.', start: { team: A }, end: { team: A } };
test('interception fumbled back on same play earns neither DST a bucket', () => {
  totals(score([puntDrive(doubleTurnover, { result: 'INT' })], possession(A)), 0, 0);
});
test('fumble recovered by defense then fumbled back is retained possession', () => {
  const p = { ...doubleTurnover, type: { text: 'Fumble Recovery (Own)' }, text: 'BAL FUMBLES. IND recovers and FUMBLES. RECOVERED by BAL.' };
  totals(score([puntDrive(p, { result: 'FUMBLE' })], possession(A)), 0, 0);
});
test('temporary possession and duplicate double-turnover play cannot award either DST', () => {
  const temporary = { ...possession(B), id: 'temporary', result: 'FUMBLE', plays: [doubleTurnover] };
  totals(score([puntDrive(doubleTurnover, { result: 'INT' }), temporary], possession(A)), 0, 0);
});
test('multiple-turnover play with missing final team is provisional, not a guessed bucket', () => {
  const p = { ...doubleTurnover, end: {} };
  const r = score([puntDrive(p, { result: 'INT' })], possession(B, 'IND 30'));
  assert.equal(r.IND.points, 0);
  assert.deepEqual(r.IND.issues, ['Multiple-turnover play awaiting possession confirmation']);
});
test('after an actual snap, a new fumble is a separate possession and both buckets remain', () => {
  const first = { ...doubleTurnover, end: { team: B }, text: 'BAL pass INTERCEPTED by IND.' };
  const second = snap(B, 'IND 30', { id: 'new-snap-fumble', type: { text: 'Fumble Recovery (Opponent)' }, text: 'IND FUMBLES. RECOVERED by BAL.', end: { team: A } });
  totals(score([puntDrive(first, { result: 'INT' }), possession(B, 'IND 30', { result: 'FUMBLE', plays: [second] })], possession(A, 'IND 30', { id: 'third' })), 2.5, 1.5);
});
test('three possession changes ending with original defense still earn just one bucket', () => {
  const p = { ...doubleTurnover, text: 'BAL pass INTERCEPTED by IND. FUMBLES. BAL recovers and FUMBLES. RECOVERED by IND.', end: { team: B } };
  totals(score([puntDrive(p, { result: 'FUMBLE' })], possession(B, 'IND 30')), 0, 1.5);
});
test('original offense scores after double turnover: offensive TD deduction, no DST bonus', () => {
  const p = { ...doubleTurnover, scoringPlay: true, scoringType: { name: 'touchdown' }, team: A };
  totals(score([puntDrive(p, { result: 'INT TD' })], possession(A), [p]), 0, -1);
});

test('real ESPN ARI-LAC double turnover is retained possession', async () => {
  const cases = JSON.parse(await readFile(new URL('./fixtures/espn-possession-cases.json', import.meta.url)));
  const { event, summary } = cases.find(c => c.name === 'double-turnover');
  const r = scoreWeekFromEspn([event], new Map([[event.id, summary]])).dstScores;
  assert.equal(r.ARI.points, 0);
  assert.equal(r.LAC.points, 0);
  assert.deepEqual(r.ARI.issues, []);
  assert.deepEqual(r.LAC.issues, []);
});
test('real ESPN SEA onside kick uses midfield drive start despite incorrect play-end team/spot', async () => {
  const cases = JSON.parse(await readFile(new URL('./fixtures/espn-possession-cases.json', import.meta.url)));
  const { event, summary } = cases.find(c => c.name === 'successful-onside');
  const r = scoreWeekFromEspn([event], new Map([[event.id, summary]])).dstScores;
  assert.equal(r.SEA.points, 1.5);
  assert.equal(r.SEA.components[0].takeover, '50');
  assert.equal(r.GB.points, -1, 'ensuing offensive touchdown remains a separate deduction');
  assert.deepEqual(r.SEA.issues, []);
  assert.deepEqual(r.GB.issues, []);
});
test('real 2025 TEN muffed-punt recovery adds exactly 2.5 at DEN 24', async () => {
  const games = JSON.parse(await readFile(new URL('./fixtures/espn-2025-week1.json', import.meta.url)));
  const { event, summary } = games.find(g => g.event.id === '401772832');
  const r = scoreWeekFromEspn([event], new Map([[event.id, summary]])).dstScores;
  const rows = r.TEN.components.filter(row => row.kind === 'special_teams_recovery');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].points, 2.5);
  assert.equal(rows[0].takeover, 'DEN 24');
  assert.equal(r.DEN.components.filter(row => row.playId === rows[0].playId).length, 0);
});
