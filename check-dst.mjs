import assert from 'node:assert/strict';
// Read-only, bounded smoke test. Usage: node scripts/check-dst.mjs [origin] [season] [week]
const origin = process.argv[2] || 'https://r31d.wiki';
const season = process.argv[3] || String(new Date().getFullYear());
const week = process.argv[4] || '1';
const url = new URL('/fantasy_football/dst/api/dashboard', origin);
url.searchParams.set('season', season);
url.searchParams.set('week', week);
const checks = await Promise.all(Array.from({length:10}, async () => {
  const start = performance.now();
  const response = await fetch(url, {signal:AbortSignal.timeout(30000)});
  assert.equal(response.status, 200);
  const dashboard = await response.json();
  assert.equal(dashboard.health.ok, true, JSON.stringify(dashboard.health.warnings));
  assert.equal(dashboard.health.stale, false);
  assert.equal(dashboard.selected.season, season);
  assert.equal(dashboard.selected.week, Number(week));
  for (const team of dashboard.teams) {
    assert.ok(Math.abs(team.projectedCustomTotal - (team.sleeperTotal - team.sleeperDstPoints + team.customDstPoints)) < 0.011);
    for (const audit of [team.newDstAudit,team.oldDstAudit]) assert.ok(Math.abs(audit.total-audit.components.reduce((sum,row)=>sum+row.points,0))<0.011);
  }
  return {milliseconds:Math.round(performance.now()-start),dashboard};
}));
const dashboard=checks[0].dashboard;
const response=await fetch(`https://api.sleeper.app/v1/league/${dashboard.league.id}/matchups/${week}`,{signal:AbortSignal.timeout(15000)});
assert.equal(response.status,200);
const matchups=await response.json();
let differences=0;
for(const team of dashboard.teams){
  const matchup=matchups.find(row=>row.roster_id===team.rosterId);
  if(Math.abs(team.sleeperTotal-(matchup.custom_points??matchup.points))>0.011)differences++;
  for(const starter of team.starters){
    if(starter.playerId==='0')continue;
    const score=matchup.starters_points?.[matchup.starters.indexOf(starter.playerId)]??matchup.players_points?.[starter.playerId];
    if(Math.abs(starter.sleeperScore-score)>0.011)differences++;
  }
}
const times=checks.map(result=>result.milliseconds).sort((a,b)=>a-b);
console.log(JSON.stringify({url:url.href,requests:checks.length,league:dashboard.league.id,teams:dashboard.teams.length,games:dashboard.nflGames.length,scoringVersion:dashboard.source.scoringVersion,liveGames:dashboard.health.liveGameCount,pollIntervalMs:dashboard.health.pollIntervalMs,minMs:times[0],medianMs:times[5],maxMs:times.at(-1),sleeperDifferences:differences,note:differences?'Provider receipts are asynchronous; inspect differences and repeat once before diagnosing a defect.':'Direct Sleeper team and starter scores matched.'},null,2));
if(differences)process.exitCode=1;
