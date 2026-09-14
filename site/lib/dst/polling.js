const POSTGAME_GRACE_MS = 10 * 60_000;
const POSTGAME_POLL_INTERVAL_MS = 60 * 60_000;

// ESPN's scheduled date is kickoff, not the final whistle. Start a conservative
// grace period at the first confirmed final observation, persisted with the
// dashboard in the shared cache so a new browser/worker cannot reset the clock.
export function withPostgameRefresh(dashboard, previous, now = Date.now()) {
  const games = dashboard.nflGames || [];
  if (dashboard.correction.status !== "provisional" || !games.length
    || !games.every((game) => game.completed === true)) return dashboard;

  const sameWeek = previous?.league?.id === dashboard.league.id
    && previous?.selected?.season === dashboard.selected.season
    && previous?.selected?.week === dashboard.selected.week;
  const gameIds = (rows) => rows.map((game) => String(game.id)).sort().join(",");
  const sameFinalSlate = sameWeek && previous.nflGames?.length === games.length
    && previous.nflGames.every((game) => game.completed === true)
    && gameIds(previous.nflGames) === gameIds(games);
  const previousTime = sameFinalSlate ? Date.parse(previous.correction?.allGamesFinalObservedAt) : NaN;
  const observedAt = Number.isFinite(previousTime) && previousTime <= now ? previousTime : now;
  return {
    ...dashboard,
    correction: { ...dashboard.correction, allGamesFinalObservedAt: new Date(observedAt).toISOString() },
    health: {
      ...dashboard.health,
      pollIntervalMs: dashboard.health.ok && !dashboard.health.stale && now - observedAt >= POSTGAME_GRACE_MS
        ? POSTGAME_POLL_INTERVAL_MS : 60_000,
    },
  };
}
