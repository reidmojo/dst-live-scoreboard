import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreWeekFromEspn } from '../src/scoring.js';
const event = {id:'test',status:{type:{state:'in'}},competitions:[{competitors:[{id:'1',team:{abbreviation:'BAL'}},{id:'2',team:{abbreviation:'IND'}}]}]};
const drive = (r='PUNT',extras={})=>({id:'d1',team:{id:'2',abbreviation:'IND'},result:r,end:{period:{number:1}},plays:[],...extras});
const next = (text='BAL 25',extras={})=>({id:'d2',team:{id:'1',abbreviation:'BAL'},start:{text,period:{number:1}},...extras});
function score(previous,current,scoringPlays=[]){return scoreWeekFromEspn([event],new Map([['test',{drives:{previous,current},scoringPlays}]]));}
for(const [spot,points] of [['BAL 1',1],['BAL 19',1],['BAL 20',1.5],['BAL 49',1.5],['50',1.5],['IND 49',2.5],['IND 20',2.5],['IND 19',3.5],['IND 1',3.5]])test(`takeover at ${spot} awards ${points}`,()=>assert.equal(score([drive()],next(spot)).dstScores.BAL.points,points));
test('active drive awards previous stop without waiting for another completed drive',()=>assert.equal(score([drive()],next()).dstScores.BAL.points,1.5));
test('duplicate current and previous drives are not double counted',()=>assert.equal(score([drive(),next('BAL 25',{result:'FG'})],next('BAL 25',{result:'FG'})).dstScores.IND.points,-0.5));
for(const result of ['MISSED FG','MISSED FIELD GOAL','BLOCKED FIELD GOAL','DOWNS','INT','FUMBLE'])test(`${result} earns a takeover, not a made field goal penalty`,()=>assert.equal(score([drive(result)],next()).dstScores.BAL.points,1.5));
for(const result of ['END OF HALF','END OF GAME','END OF REGULATION'])test(`${result} has no bucket`,()=>assert.equal(score([drive(result)],next()).dstScores.BAL.points,0));
test('halftime kickoff does not award preceding missed field goal',()=>assert.equal(score([drive('MISSED FG',{end:{period:{number:2}}})],next('BAL 35',{start:{text:'BAL 35',period:{number:3}}})).dstScores.BAL.points,0));
test('quarter changes preserve takeover',()=>assert.equal(score([drive()],next('BAL 35',{start:{text:'BAL 35',period:{number:2}}})).dstScores.BAL.points,1.5));
test('safety includes next free kick possession bucket',()=>assert.equal(score([drive('SAFETY')],next()).dstScores.BAL.points,3.5));
test('safety at game end retains two points without bucket',()=>assert.equal(score([drive('SAFETY')]).dstScores.BAL.points,2));
for(const text of ['BAL 0','BAL 99','XYZ 25',''])test(`invalid field position ${text} is flagged, not guessed`,()=>{const r=score([drive()],next(text));assert.equal(r.dstScores.BAL.points,0);assert.equal(r.dstScores.BAL.issues.length,1);});
test('unknown result is flagged',()=>assert.equal(score([drive('NEW PROVIDER RESULT')],next()).dstScores.BAL.issues.length,1));
test('team id resolves when abbreviation is absent',()=>assert.equal(score([drive()],next('BAL 25',{team:{id:'1'}})).dstScores.BAL.points,1.5));
const returnPlay={id:'p1',scoringPlay:true,scoringType:{name:'touchdown'},type:{text:'Interception Return Touchdown'},end:{team:{id:'1'}}};
test('pick-six gets +6 exactly once across drive and scoring feeds',()=>{const r=score([drive('INT TD',{plays:[returnPlay]})],null,[{...returnPlay,team:{id:'1'}}]);assert.equal(r.dstScores.BAL.points,6);assert.equal(r.dstScores.IND.points,0);});
test('kickoff return outside drives credits receiving DST',()=>{const r=score([],null,[{...returnPlay,type:{text:'Kickoff Return Touchdown'},team:{id:'2'}}]);assert.equal(r.dstScores.IND.points,6);assert.equal(r.dstScores.BAL.points,-1);});
test('kickoff return drive is not an offensive TD allowed',()=>{const p={...returnPlay,type:{text:'Kickoff Return Touchdown'},team:{id:'2'}};const r=score([drive('TD',{plays:[p]})]);assert.equal(r.dstScores.IND.points,6);assert.equal(r.dstScores.BAL.points,-1);});
test('offensive fumble recovery touchdown remains offensive',()=>{const p={...returnPlay,type:{text:'Offensive Fumble Recovery Touchdown'},end:{team:{id:'2'}}};assert.equal(score([drive('TD',{plays:[p]})]).dstScores.BAL.points,-1);});
test('interception during conversion does not turn offensive TD into DST TD',()=>{const p={...returnPlay,type:{text:'Passing Touchdown'},end:{team:{id:'2'}},text:'Pass TOUCHDOWN. TWO-POINT CONVERSION intercepted by BAL'};assert.equal(score([drive('TD',{plays:[p]})]).dstScores.BAL.points,-1);});
test('defensive two-point return is not a six-point touchdown',()=>assert.equal(score([],null,[{...returnPlay,type:{text:'Defensive Two Point Conversion'}}]).dstScores.BAL.points,0));
test('rescinded scoring play does not award return touchdown',()=>assert.equal(score([drive('END OF GAME',{plays:[{...returnPlay,scoringPlay:false}]})]).dstScores.BAL.points,0));

test('scoring-play / drive mismatch is surfaced for reconciliation',()=>{
  const offensive={...returnPlay,team:{id:'2'},type:{text:'Passing Touchdown'}};
  assert.equal(score([],null,[offensive]).dstScores.BAL.issues.length,1);
});
test('return touchdown audit sorts at the actual quarter and clock',()=>{
  const touchdownDrive = drive('INT TD', {
    end: {period:{number:1},clock:{displayValue:'10:00'}},
    plays: [{...returnPlay,period:{number:1},clock:{displayValue:'10:00'}}],
  });
  const laterPunt = drive('PUNT',{id:'later',end:{period:{number:2},clock:{displayValue:'5:00'}}});
  const r = score([touchdownDrive,laterPunt],next('BAL 25',{start:{text:'BAL 25',period:{number:2}}}));
  assert.deepEqual(r.dstScores.BAL.components.map(row=>row.kind),['dst_touchdown','takeover']);
});
test('replays all 323 completed 2025 Week 1 drives and reconciles independent scoring-play feed',async()=>{
  const {readFile}=await import('node:fs/promises');
  const games=JSON.parse(await readFile(new URL('./fixtures/espn-2025-week1.json',import.meta.url)));
  let drives=0;
  for(const {event,summary} of games){
    drives+=summary.drives.previous.length;
    const scored=scoreWeekFromEspn([event],new Map([[event.id,summary]]));
    for(const team of Object.values(scored.dstScores)){
      assert.deepEqual(team.issues,[],`${event.shortName}: ${team.team}`);
      assert.equal(team.points,team.components.reduce((sum,row)=>sum+row.points,0));
    }
    // Simulate the final drive still being delivered in ESPN's current collection.
    const split=structuredClone(summary);split.drives.current=split.drives.previous.pop();
    assert.deepEqual(scoreWeekFromEspn([event],new Map([[event.id,split]])).dstScores,scored.dstScores);
  }
  assert.equal(drives,323);
  const hou=games.find(g=>g.event.id==='401772723');
  assert.equal(scoreWeekFromEspn([hou.event],new Map([[hou.event.id,hou.summary]])).dstScores.HOU.points,6.5);
  const chi=games.find(g=>g.event.id==='401772810');
  assert.equal(scoreWeekFromEspn([chi.event],new Map([[chi.event.id,chi.summary]])).dstScores.CHI.points,12.5);
});
