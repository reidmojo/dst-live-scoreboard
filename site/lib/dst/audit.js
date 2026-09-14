export function weeklyPlayerTeams(summaries) {
  const candidates = new Map();
  for (const summary of summaries.values()) for (const team of summary.boxscore?.players || []) {
    for (const category of team.statistics || []) for (const entry of category.athletes || []) {
      const key = nameKey(entry.athlete?.displayName || entry.athlete?.fullName);
      if (!key || !team.team?.abbreviation) continue;
      const teams = candidates.get(key) || new Set();
      teams.add(team.team.abbreviation);
      candidates.set(key, teams);
    }
  }
  return Object.fromEntries([...candidates].filter(([,teams])=>teams.size===1).map(([key,teams])=>[key,[...teams][0]]));
}
export function nameKey(name) { return String(name || '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g,'').replace(/[^a-z]/g,''); }
