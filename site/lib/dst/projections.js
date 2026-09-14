export function leagueProjectionPoints(projection = {}, scoringSettings = {}) {
  let total = 0;
  let matchedScoringStat = false;

  for (const [statKey, multiplierValue] of Object.entries(scoringSettings)) {
    const multiplier = Number(multiplierValue);
    const statValue = Number(projection[statKey]);
    if (!Number.isFinite(multiplier) || multiplier === 0 || !Number.isFinite(statValue)) continue;
    matchedScoringStat = true;
    total += statValue * multiplier;
  }

  if (matchedScoringStat) return round(total);

  const receptionValue = Number(scoringSettings.rec ?? 1);
  const preferredKey = receptionValue >= 1 ? "pts_ppr" : receptionValue > 0 ? "pts_half_ppr" : "pts_std";
  const fallback = numericValue(projection[preferredKey])
    ?? numericValue(projection.pts_ppr)
    ?? numericValue(projection.pts_half_ppr)
    ?? numericValue(projection.pts_std);
  return fallback == null ? null : round(fallback);
}

// Match Gameday's projection baseline without pretending standard DST
// projections are predictions from our drive-based custom scoring engine.
export function sleeperDstProjection(projection = {}) {
  const points = numericValue(projection.pts_std);
  return points == null ? null : round(points);
}

export function teamProjectionPoints(starters = []) {
  const occupied = starters.filter(player => player.playerId !== "0");
  if (!occupied.length || occupied.some(player => numericValue(player.projectedScore) == null)) return null;
  return round(occupied.reduce((total, player) => total + Number(player.projectedScore), 0));
}

function numericValue(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
