const MAX_FANTASY_WEEK = 17;

export function weekOptions(league, sleeperState, isLatestSeason) {
  if (league.status === "pre_draft") return [1];
  if (league.status === "complete") {
    return rangeWeeks(Number(league.settings?.last_scored_leg || MAX_FANTASY_WEEK));
  }

  const seasonType = String(sleeperState.season_type || "").toLowerCase();
  const regularSeasonHasStarted = seasonType === "regular" || seasonType === "post";
  const stateWeek = isLatestSeason && regularSeasonHasStarted
    ? Number(sleeperState.display_week || sleeperState.week || 1)
    : 0;
  const leagueWeek = Number(
    league.settings?.last_scored_leg
    || (regularSeasonHasStarted ? league.settings?.leg : league.settings?.start_week)
    || 1,
  );
  return rangeWeeks(Math.max(stateWeek, leagueWeek, 1));
}

export function compactInjuryStatus(value) {
  const status = String(value || "").trim();
  if (!status) return "";
  const normalized = status.toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const labels = {
    QUESTIONABLE: "Q",
    Q: "Q",
    DOUBTFUL: "D",
    D: "D",
    OUT: "OUT",
    O: "OUT",
    "INJURED RESERVE": "IR",
    IR: "IR",
    "PHYSICALLY UNABLE TO PERFORM": "PUP",
    PUP: "PUP",
    "NON FOOTBALL INJURY": "NFI",
    NFI: "NFI",
    SUSPENDED: "SUS",
    SUS: "SUS",
    "DAY TO DAY": "DTD",
    DTD: "DTD",
    INACTIVE: "IA",
    IA: "IA",
    "COVID 19": "COV",
    COVID: "COV",
    COV: "COV",
  };
  return labels[normalized] || (normalized.length <= 4 ? normalized : normalized.slice(0, 4));
}

export function formatProjection(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

// Compact Games stat lines already identify each group with CMP / CAR / REC.
// Apply at render time so saved historical dashboards get the same labels.
export function compactGameStatLabel(label) {
  return String(label || "").replace(/^(?:PASS|RUSH|REC) (YD|TD)$/i, "$1");
}

export function playerGameForWeek(player, games = []) {
  if (!player?.playerId || String(player.playerId) === "0") return null;
  // The week's actual player list takes precedence over a current team (trades).
  const matches = games.filter(game => game.positionGroups?.some(group =>
    [...group.away, ...group.home].some(entry => String(entry.playerId) === String(player.playerId))));
  if (matches.length) return matches.length === 1 ? matches[0] : null;
  const team = canonicalTeam(player.team);
  if (!team) return null;
  const scheduled = games.filter(game => game.teams?.some(entry => canonicalTeam(entry.abbreviation) === team));
  return scheduled.length === 1 ? scheduled[0] : null;
}

export function gameViewHref(game, selected) {
  if (!game?.id || !selected?.season || !selected?.week) return "";
  const params = new URLSearchParams({ season: String(selected.season), week: String(selected.week), view: "games", game: String(game.id) });
  return `/fantasy_football/dst?${params}`;
}

export function starterSchedule(team, games = []) {
  const teamKey = canonicalTeam(team);
  if (!teamKey) return emptySchedule();
  const game = games.find((candidate) =>
    (candidate.teams || []).some((entry) => canonicalTeam(entry.abbreviation) === teamKey)
  );
  if (!game) return emptySchedule();
  const scheduledTeam = (game.teams || []).find((entry) => canonicalTeam(entry.abbreviation) === teamKey);
  const opponent = (game.teams || []).find((entry) => canonicalTeam(entry.abbreviation) !== teamKey);
  return {
    gameStart: game.date || "",
    gameStatus: game.status || "",
    gameStatusState: game.statusState || "",
    gameCompleted: game.completed === true,
    gameClock: game.clock || "",
    gamePeriod: Number(game.period || 0),
    opponent: displayTeam(opponent?.abbreviation),
    homeAway: scheduledTeam?.homeAway || "",
  };
}

function emptySchedule() {
  return { gameStart: "", gameStatus: "", gameStatusState: "", gameCompleted: false, gameClock: "", gamePeriod: 0, opponent: "", homeAway: "" };
}

// NFL result from the player's perspective, never a fantasy score or a live lead.
export function finalGameResult(team, games = []) {
  const teamKey = canonicalTeam(team);
  if (!teamKey) return "";
  const game = games.find(candidate => (candidate.teams || []).some(entry => canonicalTeam(entry.abbreviation) === teamKey));
  if (game?.statusState !== "post" || game.completed !== true) return "";
  const own = game.teams.find(entry => canonicalTeam(entry.abbreviation) === teamKey);
  const opponent = game.teams.find(entry => canonicalTeam(entry.abbreviation) !== teamKey);
  const against = opponent ? ` ${own.homeAway === "away" ? "@" : "vs"} ${displayTeam(opponent.abbreviation)}` : "";
  const validScore = value => (typeof value === "number" || (typeof value === "string" && value.trim() !== ""))
    && Number.isInteger(Number(value)) && Number(value) >= 0;
  if (!opponent || !validScore(own.score) || !validScore(opponent.score)) return `Final${against}`;
  const ownScore = Number(own.score);
  const opponentScore = Number(opponent.score);
  const result = ownScore > opponentScore ? "W" : ownScore < opponentScore ? "L" : "T";
  return `Final ${result} ${ownScore}-${opponentScore}${against}`;
}

function canonicalTeam(value) {
  const team = String(value || "").toUpperCase();
  return ({ WAS: "WSH", JAC: "JAX", LA: "LAR", OAK: "LV", SD: "LAC", STL: "LAR" })[team] || team;
}

function displayTeam(value) {
  const team = canonicalTeam(value);
  return team === "WSH" ? "WAS" : team;
}

function rangeWeeks(maxWeek) {
  const end = Math.min(Math.max(Math.trunc(maxWeek || 1), 1), MAX_FANTASY_WEEK);
  return Array.from({ length: end }, (_, index) => index + 1);
}
