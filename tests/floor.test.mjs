import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scoreWeekFromEspn, FINAL_DST_FLOOR } from '../src/scoring.js';

const defense = { id: '1', abbreviation: 'BAL' };
const offense = { id: '2', abbreviation: 'IND' };
const live = { period: 4, displayClock: '0:00', type: { state: 'in', completed: false, name: 'STATUS_IN_PROGRESS' } };
const final = { period: 4, displayClock: '0:00', type: { state: 'post', completed: true, name: 'STATUS_FINAL', description: 'Final' } };
function input({ tds = 6, fgs = 0, status = live } = {}) {
  const event = { id: 'game', date: '2026-09-09T00:20:00Z', status,
    competitions: [{ competitors: [defense, offense].map(team => ({ id: team.id, team })) }] };
  const plays = Array.from({ length: tds + fgs }, (_, index) => ({ id: `p${index}`, team: offense,
    scoringPlay: true, scoringType: { name: index < tds ? 'touchdown' : 'field-goal' },
    type: { text: index < tds ? 'Passing Touchdown' : 'Field Goal Good' },
    period: { number: 4 }, clock: { displayValue: '1:00' } }));
  const summary = { drives: { previous: plays.map((play, index) => ({ id: `d${index}`, team: offense,
    result: index < tds ? 'TD' : 'FG', end: { period: { number: 4 }, clock: { displayValue: '1:00' } }, plays: [play] })) }, scoringPlays: plays };
  return { event, summary };
}
function score(data) { return scoreWeekFromEspn([data.event], new Map([[data.event.id, data.summary]])); }
function assertScore(result, raw, displayed, adjustment) {
  const team = result.dstScores.BAL;
  assert.equal(team.rawPoints, raw);
  assert.equal(team.points, displayed);
  assert.equal(team.floorAdjustment, adjustment);
  assert.equal(team.components.reduce((sum, row) => sum + row.points, 0), displayed);
  assert.equal(team.components.filter(row => row.kind !== 'final_score_floor').reduce((sum, row) => sum + row.points, 0), raw);
  assert.equal(team.components.filter(row => row.kind === 'final_score_floor').length, adjustment > 0 ? 1 : 0);
  const gameTeam = result.games[0].teamScores.find(row => row.team === 'BAL');
  assert.equal(gameTeam.points, displayed);
  assert.equal(gameTeam.rawPoints, raw);
  assert.equal(team.games[0].floorAdjustment, adjustment);
}
test('live score may go below -4, including a zero fourth-quarter clock', () => {
  assertScore(score(input()), -6, -6, 0);
});
test('positive points during live game are added to raw -6, not the floor', () => {
  const data = input();
  data.summary.drives.previous.push({ id: 'punt', team: offense, result: 'PUNT', plays: [], end: { period: { number: 4 } } });
  data.summary.drives.current = { id: 'takeover', team: defense, start: { text: 'BAL 35', period: { number: 4 } }, plays: [] };
  assertScore(score(data), -4.5, -4.5, 0);
  data.event.status = final;
  assertScore(score(data), -4.5, -4, 0.5);
});
test('completed game floors raw -6 to -4 with one separate +2 adjustment', () => {
  const result = score(input({ status: final }));
  assert.equal(FINAL_DST_FLOOR, -4);
  assertScore(result, -6, -4, 2);
  assert.equal(result.games[0].completed, true);
  const adjustment = result.dstScores.BAL.components.at(-1);
  assert.equal(adjustment.kind, 'final_score_floor');
  assert.equal(adjustment.source, 'League scoring rule');
  assert.equal(adjustment.rawPoints, -6);
  assert.equal(adjustment.finalPoints, -4);
  assert.deepEqual(result.dstScores.BAL.issues, []);
});
for (const [tds, fgs, raw] of [[4, 0, -4], [3, 1, -3.5], [0, 0, 0]]) {
  test(`final raw ${raw} needs no floor adjustment`, () => assertScore(score(input({ tds, fgs, status: final })), raw, raw, 0));
}
test('final positive DST points remain unchanged', () => {
  const data = input({ tds: 0, status: final });
  data.summary.drives.previous.push({ id: 'punt', team: offense, result: 'PUNT', plays: [] });
  data.summary.drives.current = { id: 'next', team: defense, start: { text: 'BAL 25' } };
  assertScore(score(data), 1.5, 1.5, 0);
});
test('END OF GAME drive alone cannot activate the floor', () => {
  const data = input();
  data.summary.drives.previous.push({ id: 'end', team: offense, result: 'END OF GAME', plays: [] });
  assertScore(score(data), -6, -6, 0);
});
test('overtime remains raw until its completed final status', () => {
  const data = input({ status: { ...live, period: 5 } });
  assertScore(score(data), -6, -6, 0);
  data.event.status = { ...final, period: 5, type: { ...final.type, name: 'STATUS_FINAL_OVERTIME' } };
  assertScore(score(data), -6, -4, 2);
});
for (const type of [
  { state: 'pre', completed: false, name: 'STATUS_POSTPONED' },
  { state: 'in', completed: false, name: 'STATUS_SUSPENDED' },
  { state: 'post', completed: true, name: 'STATUS_CANCELED' },
  { state: 'post', name: 'STATUS_FINAL' },
  { state: 'post', completed: false, name: 'STATUS_FINAL' },
]) {
  test(`no floor without confirmed final status: ${JSON.stringify(type)}`, () => {
    const result = score(input({ status: { type } }));
    assertScore(result, -6, -6, 0);
    if (type.state === 'post') assert.match(result.dstScores.BAL.issues.join(' '), /completion awaiting confirmation/);
  });
}
test('competition and summary status can confirm completion when event status is absent', () => {
  const data = input();
  delete data.event.status;
  data.event.competitions[0].status = final;
  assertScore(score(data), -6, -4, 2);
  delete data.event.competitions[0].status;
  data.summary.header = { competitions: [{ status: final }] };
  assertScore(score(data), -6, -4, 2);
});
test('explicit live scoreboard status wins over a conflicting final summary', () => {
  const data = input();
  data.summary.header = { competitions: [{ status: final }] };
  assertScore(score(data), -6, -6, 0);
});
test('correction from raw -6 to -5.5 stays -4, not -3.5', () => {
  assertScore(score(input({ status: final })), -6, -4, 2);
  assertScore(score(input({ tds: 5, fgs: 1, status: final })), -5.5, -4, 1.5);
});
test('corrections crossing the floor remove or restore the derived adjustment', () => {
  assertScore(score(input({ status: final })), -6, -4, 2);
  assertScore(score(input({ tds: 3, fgs: 1, status: final })), -3.5, -3.5, 0);
  assertScore(score(input({ tds: 5, fgs: 1, status: final })), -5.5, -4, 1.5);
});
test('reopening a game removes the floor and resumes from raw score', () => {
  const data = input({ status: final });
  assertScore(score(data), -6, -4, 2);
  data.event.status = live;
  assertScore(score(data), -6, -6, 0);
});
test('repeated computation never changes source events or stacks floor adjustments', () => {
  const data = input({ status: final });
  const original = structuredClone(data);
  const first = score(data);
  assert.deepEqual(score(data), first);
  assert.deepEqual(score(JSON.parse(JSON.stringify(data))), first);
  assert.deepEqual(data, original);
});
test('one completed DST is floored while another game remains live', () => {
  const a = input({ status: final });
  const b = input();
  b.event.id = 'other';
  b.event.competitions[0].competitors = [{ id: '1', team: { abbreviation: 'KC' } }, { id: '2', team: { abbreviation: 'DEN' } }];
  const result = scoreWeekFromEspn([a.event, b.event], new Map([[a.event.id, a.summary], [b.event.id, b.summary]]));
  assert.equal(result.dstScores.BAL.points, -4);
  assert.equal(result.dstScores.KC.points, -6);
});
test('raw scoring issues remain visible even after a final-game floor', () => {
  const data = input({ status: final });
  data.summary.scoringPlays.pop();
  const result = score(data);
  assertScore(result, -6, -4, 2);
  assert.match(result.dstScores.BAL.issues.join(' '), /reconciliation/);
});
test('real 2025 Miami result keeps raw -5 and shows final -4', async () => {
  const games = JSON.parse(await readFile(new URL('./fixtures/espn-2025-week1.json', import.meta.url)));
  const data = games.find(g => g.event.id === '401772719');
  const result = score(data);
  const mia = result.dstScores.MIA;
  assert.equal(mia.rawPoints, -5);
  assert.equal(mia.floorAdjustment, 1);
  assert.equal(mia.points, -4);
  assert.equal(mia.components.at(-1).kind, 'final_score_floor');
  assert.deepEqual(mia.issues, []);
  const ongoing = structuredClone(data);
  ongoing.event.status = live;
  assert.equal(score(ongoing).dstScores.MIA.points, -5);
});
