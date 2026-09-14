import { weeklyPlayerTeams, nameKey } from "./audit.js";
import { createUpstreamClient } from "./upstream.js";
import { scoreWeekFromEspn, SCORING_VERSION, FINAL_DST_FLOOR } from "./scoring.js";
import { compactInjuryStatus, starterSchedule, weekOptions } from "./presentation.js";
import { leagueProjectionPoints, sleeperDstProjection } from "./projections.js";
import { withPostgameRefresh } from "./polling.js";
import { sleeperDefaultDstAudit, SLEEPER_DEFAULT_SCORING_VERSION } from "./sleeper-default.js";
import { buildGameViews, GAME_VIEW_VERSION } from "./games.js";
import { LIVE_ESTIMATE_VERSION, withLiveProjection } from "./live-estimates.js";
import { healthFlags } from "./health.js";

const SLEEPER_BASE = "https://api.sleeper.app/v1";
const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const ESPN_SUMMARY = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary";
const FIRST_LEAGUE_ID = "1239299227176157184";
const TRACKED_USER_ID = "728330006803111936";
const EASTERN_TIME_ZONE = "America/New_York";
const LIVE_POLL_INTERVAL_MS = 15_000;
const SCHEDULED_POLL_INTERVAL_MS = 300_000;
const SLEEPER_TO_ESPN_DEFENSE = { WAS: "WSH" };

const fetchJson = createUpstreamClient();
const dashboardRequests = new Map();
const dashboards = new Map();
const DASHBOARD_TTL_MS = 10_000;

export async function getDashboard(request, db) {
  const url = new URL(request.url);
  const season = url.searchParams.get("season");
  const week = url.searchParams.get("week");
  if ((season && (!/^20\d{2}$/.test(season) || +season < 2025 || +season > new Date().getUTCFullYear() + 1))
    || (week && (!/^\d{1,2}$/.test(week) || +week < 1 || +week > 17))) throw new Error("Invalid season or week");
  const key = `${season || "latest"}:${week || "latest"}:${SCORING_VERSION}:${SLEEPER_DEFAULT_SCORING_VERSION}:${GAME_VIEW_VERSION}:${LIVE_ESTIMATE_VERSION}`;
  if (dashboardRequests.has(key)) return dashboardRequests.get(key);
  const task = (async () => {
    let cached = dashboards.get(key);
    if (!cached || Date.now() - Date.parse(cached.generatedAt) >= DASHBOARD_TTL_MS) {
      try {
        const row = await db.prepare("SELECT dashboard FROM dst_live_cache WHERE cache_key = ?").bind(key).first();
        if (row?.dashboard) {
          const shared = JSON.parse(row.dashboard);
          if (!cached || shared.generatedAt > cached.generatedAt) cached = shared;
        }
      } catch { /* Live reads can still work while durable storage recovers. */ }
    }
    if (cached && Date.now() - Date.parse(cached.generatedAt) < DASHBOARD_TTL_MS) return cached;
    try {
      const dashboard = await buildDashboard(request, db, cached);
      if (dashboard.health.ok) {
        dashboards.set(key, dashboard);
        try {
          await db.prepare(`INSERT INTO dst_live_cache (cache_key, dashboard, generated_at)
            VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET dashboard = excluded.dashboard, generated_at = excluded.generated_at
            WHERE excluded.generated_at >= dst_live_cache.generated_at`)
            .bind(key, JSON.stringify(dashboard), dashboard.generatedAt).run();
        } catch {
          dashboard.health.warnings.push({ kind: "storage", label: "Backup storage", message: "Live scores loaded; durable backup temporarily unavailable" });
          dashboard.health.ok = false;
          dashboard.health.pollIntervalMs = Math.min(dashboard.health.pollIntervalMs || 60_000, 60_000);
        }
      }
      return dashboard;
    } catch (error) {
      if (!cached) throw error;
      return { ...cached, servedAt: new Date().toISOString(), health: { ...cached.health,
        ok: false, stale: true, pollIntervalMs: LIVE_POLL_INTERVAL_MS,
        warnings: [...(cached.health.warnings || []), { kind: "upstream", label: "Score update", message: `Showing last confirmed scores: ${error.message}` }] } };
    }
  })();
  dashboardRequests.set(key, task);
  try { return await task; } finally { dashboardRequests.delete(key); }
}

async function buildDashboard(request, db, previous) {
  const url = new URL(request.url);
  const requestState = { warnings: [], sources: [] };
  const sleeperState = await fetchJson(`${SLEEPER_BASE}/state/nfl`, {
    ttlMs: 60_000,
    requestState,
    label: "Sleeper NFL state",
    validate: (value) => !!value?.season,
  });
  const leagueCatalog = await buildLeagueCatalog(sleeperState, requestState);
  const seasons = [...leagueCatalog.keys()].sort((a, b) => a - b);
  const requestedSeason = Number(url.searchParams.get("season") || 0);
  if (requestedSeason && !seasons.includes(requestedSeason)) throw new Error("Requested season is unavailable");
  const selectedSeason = requestedSeason || seasons.at(-1);
  const league = leagueCatalog.get(selectedSeason);
  if (!league) throw new Error("No linked Sleeper league is available.");

  const latestSeason = seasons.at(-1);
  const weeks = weekOptions(league, sleeperState, selectedSeason === latestSeason);
  const requestedWeek = Number(url.searchParams.get("week") || 0);
  if (requestedWeek && !weeks.includes(requestedWeek)) throw new Error("Requested week is unavailable");
  const week = requestedWeek || weeks.at(-1);

  let snapshot;
  try { snapshot = await readSnapshot(db, league.league_id, selectedSeason, week); }
  catch { requestState.warnings.push({ kind: "storage", label: "Saved results", message: "Saved results unavailable; recomputing from providers" }); }
  if (snapshot) return dashboardFromSnapshot(snapshot);

  const dashboard = league.status === "pre_draft"
    ? await buildPreDraftDashboard({ league, seasons, selectedSeason, week, weeks, latestSeason, requestState, sleeperState })
    : await buildScoredDashboard({ league, seasons, selectedSeason, week, weeks, latestSeason, requestState, sleeperState });

  if (dashboard.correction?.status === "finalized" && dashboard.health.ok) {
    try {
      await saveSnapshot(db, dashboard);
      dashboard.source.snapshotSaved = true;
    } catch (error) {
      requestState.warnings.push({
        kind: "storage",
        label: "Finalized snapshot",
        message: error instanceof Error ? error.message : "Snapshot storage failed",
      });
      dashboard.health.ok = false;
      dashboard.health.stale = healthFlags(requestState).stale;
      dashboard.health.warnings = requestState.warnings;
    }
  }

  if (dashboard.correction.status === "finalized" && !dashboard.health.ok) {
    dashboard.correction = { ...dashboard.correction, status: "provisional", label: "Awaiting complete provider data before finalizing" };
    dashboard.health.pollIntervalMs = 60_000;
  }
  return withPostgameRefresh(dashboard, previous);
}

async function buildLeagueCatalog(sleeperState, requestState) {
  const firstLeague = await fetchJson(`${SLEEPER_BASE}/league/${FIRST_LEAGUE_ID}`, {
    ttlMs: 300_000,
    requestState,
    label: "Sleeper base league",
    validate: (value) => !!value?.league_id && !!value?.season,
  });
  const catalog = new Map([[Number(firstLeague.season), firstLeague]]);
  let latestLeague = firstLeague;
  const stateSeason = Number(sleeperState.league_season || sleeperState.season || firstLeague.season);

  for (let season = Number(firstLeague.season) + 1; season <= stateSeason; season += 1) {
    const leagues = await fetchJson(`${SLEEPER_BASE}/user/${TRACKED_USER_ID}/leagues/nfl/${season}`, {
      ttlMs: 300_000,
      requestState,
      label: `Sleeper leagues ${season}`,
      validate: Array.isArray,
    });
    const nextLeague = (Array.isArray(leagues) ? leagues : []).find((candidate) =>
      String(candidate.previous_league_id || "") === String(latestLeague.league_id)
    );
    if (!nextLeague) break;
    catalog.set(Number(nextLeague.season), nextLeague);
    latestLeague = nextLeague;
  }

  return catalog;
}

async function buildPreDraftDashboard({ league, seasons, selectedSeason, week, weeks, latestSeason, requestState, sleeperState }) {
  const [rosters, users] = await Promise.all([
    fetchJson(`${SLEEPER_BASE}/league/${league.league_id}/rosters`, { ttlMs: 300_000, requestState, validate: Array.isArray, label: "Sleeper rosters" }),
    fetchJson(`${SLEEPER_BASE}/league/${league.league_id}/users`, { ttlMs: 300_000, requestState, validate: Array.isArray, label: "Sleeper users" }),
  ]);
  const teams = buildLeagueTeams({
    rosters,
    users,
    matchups: [],
    espnScores: { dstScores: {} },
    playersById: {},
    playerStats: {},
    playerProjections: {},
    scoringSettings: league.scoring_settings || {},
    rosterPositions: league.roster_positions || [],
    nflGames: [],
  });

  return baseDashboard({
    league,
    seasons,
    selectedSeason,
    week,
    weeks,
    sleeperState,
    requestState,
    health: {
      liveGameCount: 0,
      pollIntervalMs: selectedSeason === latestSeason ? SCHEDULED_POLL_INTERVAL_MS : 0,
    },
    correction: { status: "scheduled", label: "Pre-draft; matchups will appear after the league draft", finalizesAt: null },
    teams,
    matchups: [],
    nflGames: [],
    dstScores: {},
    emptyState: "The new league is linked. Matchups will appear here after the draft and Week 1 schedule are available.",
  });
}

async function buildScoredDashboard({ league, seasons, selectedSeason, week, weeks, latestSeason, requestState, sleeperState }) {
  const [rosters, users, matchups, scoreboard, playersById, playerStats, playerProjections] = await Promise.all([
    fetchJson(`${SLEEPER_BASE}/league/${league.league_id}/rosters`, { ttlMs: 300_000, requestState, validate: Array.isArray, label: "Sleeper rosters" }),
    fetchJson(`${SLEEPER_BASE}/league/${league.league_id}/users`, { ttlMs: 300_000, requestState, validate: Array.isArray, label: "Sleeper users" }),
    fetchJson(`${SLEEPER_BASE}/league/${league.league_id}/matchups/${week}`, { ttlMs: 30_000, validate: (value) => Array.isArray(value) && value.length > 0, requestState, label: "Sleeper matchups" }),
    fetchJson(`${ESPN_SCOREBOARD}?seasontype=2&week=${week}&dates=${selectedSeason}`, { ttlMs: 20_000, validate: (value) => Array.isArray(value?.events) && value.events.length > 0, requestState, label: "ESPN scoreboard" }),
    fetchJson(`${SLEEPER_BASE}/players/nfl`, { ttlMs: 43_200_000, validate: (value) => value && typeof value === "object" && !Array.isArray(value), requestState, label: "Sleeper player metadata" }),
    fetchJson(`${SLEEPER_BASE}/stats/nfl/regular/${selectedSeason}/${week}`, { ttlMs: 30_000, optional: true, validate: (value) => value && typeof value === "object" && !Array.isArray(value), requestState, label: "Sleeper player stats" }),
    fetchJson(`${SLEEPER_BASE}/projections/nfl/regular/${selectedSeason}/${week}`, { ttlMs: 300_000, optional: true, requestState, label: "Sleeper player projections" }),
  ]);

  const events = scoreboard.events || [];
  const summaries = new Map();
  await Promise.all(events.map(async (event) => {
    if (event.status?.type?.state === "pre") return;
    const summary = await fetchJson(`${ESPN_SUMMARY}?event=${event.id}`, {
      ttlMs: 20_000,
      validate: (value) => String(value?.header?.id) === String(event.id)
        && !!value?.drives && ((Array.isArray(value.drives.previous) && value.drives.previous.length > 0) || !!value.drives.current),
      requestState,
      label: `ESPN summary ${event.id}`,
    });
    if (summary) summaries.set(event.id, summary);
  }));

  const espnScores = scoreWeekFromEspn(events, summaries, league.scoring_settings || {});
  for (const score of Object.values(espnScores.dstScores)) {
    for (const message of score.issues || []) requestState.warnings.push({ kind: "scoring", teams: [score.team], label: `${score.team} drive scoring`, message });
  }
  if (matchups.length < rosters.length && week < Number(league.settings?.playoff_week_start || 15)) {
    throw new Error("Sleeper matchup response is incomplete");
  }
  const teams = buildLeagueTeams({
    rosters,
    users,
    matchups: matchups || [],
    espnScores,
    playersById,
    playerStats: playerStats || {},
    playerProjections: playerProjections || {},
    scoringSettings: league.scoring_settings || {},
    rosterPositions: league.roster_positions || [],
    nflGames: espnScores.games,
    playerTeams: weeklyPlayerTeams(summaries),
    historical: selectedSeason < latestSeason,
  });
  const liveGameCount = countLiveGames(events);
  for (const team of teams) for (const message of team.oldDstAudit.issues) {
    requestState.warnings.push({ kind: "comparison", teams: [team.dstTeam], label: `${team.dstTeam} Sleeper default comparison`, message: `${team.dstTeam}: ${message}` });
  }
  const hasScheduledGames = events.some((event) => event.status?.type?.state === "pre");
  const pollIntervalMs = liveGameCount > 0
    ? LIVE_POLL_INTERVAL_MS
    : selectedSeason === latestSeason && hasScheduledGames && league.status !== "complete"
      ? (events.some((event) => Math.abs(Date.parse(event.date) - Date.now()) < 900_000) ? LIVE_POLL_INTERVAL_MS : 60_000)
      : correctionStatus(events).status === "finalized" ? 0 : 60_000;

  return baseDashboard({
    league,
    seasons,
    selectedSeason,
    week,
    weeks,
    sleeperState,
    requestState,
    health: { liveGameCount, pollIntervalMs },
    correction: correctionStatus(events),
    teams,
    matchups: buildMatchups(teams),
    nflGames: buildGameViews({ games: espnScores.games, summaries, playersById, playerStats: playerStats || {},
      playerProjections: playerProjections || {}, scoringSettings: league.scoring_settings || {}, rosters, users, matchups,
      historical: selectedSeason < latestSeason }),
    dstScores: espnScores.dstScores,
    emptyState: teams.length ? "" : "No matchups are available for this week yet.",
  });
}

function baseDashboard({ league, seasons, selectedSeason, week, weeks, sleeperState, requestState, health, correction, teams, matchups, nflGames, dstScores, emptyState }) {
  return {
    generatedAt: new Date().toISOString(),
    health: {
      ...healthFlags(requestState),
      warnings: requestState.warnings,
      ...health,
      sources: requestState.sources,
      dataAsOf: requestState.sources.filter((source) => /matchups|scoreboard|summary/.test(source.label)).map((source) => source.fetchedAt).sort()[0] || new Date().toISOString(),
    },
    source: {
      liveDriveData: "ESPN site APIs",
      leagueData: "Sleeper API",
      snapshot: false,
      scoringVersion: SCORING_VERSION,
      sleeperDefaultScoringVersion: SLEEPER_DEFAULT_SCORING_VERSION,
      gameViewVersion: GAME_VIEW_VERSION,
      liveEstimateVersion: LIVE_ESTIMATE_VERSION,
      snapshotSaved: false,
      status: "ESPN data is unofficial and live scores remain provisional until corrections settle.",
    },
    scoring: {
      finalDstFloor: FINAL_DST_FLOOR,
      touchdownAllowed: -1,
      fieldGoalAllowed: -0.5,
      defenseLt20: 1,
      defense20To50: 1.5,
      offense49To20: 2.5,
      offenseLt20: 3.5,
      dstTouchdown: 6,
      safety: 2,
    },
    sleeperState,
    league: {
      id: league.league_id,
      name: league.name,
      avatar: sleeperAvatar(league.avatar),
      season: league.season,
      status: league.status,
      totalRosters: league.total_rosters,
      lastScoredWeek: league.settings?.last_scored_leg,
      startWeek: league.settings?.start_week,
    },
    selected: { season: String(selectedSeason), week },
    seasons,
    weeks,
    correction,
    teams,
    matchups,
    nflGames,
    dstScores,
    emptyState,
  };
}

function countLiveGames(events) {
  return events.filter((event) => event.status?.type?.state === "in").length;
}

function correctionStatus(events) {
  if (!events.length) return { status: "unknown", label: "No NFL games found for selected week", finalizesAt: null };
  if (events.some((event) => event.status?.type?.state === "in")) {
    return { status: "live", label: "Live; corrections pending", finalizesAt: null };
  }
  if (events.some((event) => event.status?.type?.state !== "post")) {
    return { status: "scheduled", label: "Scheduled; scoring remains provisional", finalizesAt: null };
  }
  const finalizesAt = correctionCutoff(events);
  if (!finalizesAt) return { status: "provisional", label: "Final game complete; correction cutoff unavailable", finalizesAt: null };
  const finalized = Date.now() >= finalizesAt.getTime();
  return {
    status: finalized ? "finalized" : "provisional",
    label: finalized ? "Finalized snapshot" : "Provisional until Wednesday correction window",
    finalizesAt: finalizesAt.toISOString(),
  };
}

function correctionCutoff(events) {
  const eventDates = events.map((event) => new Date(event.date)).filter((date) => Number.isFinite(date.getTime()));
  if (!eventDates.length) return null;
  const latestKickoff = new Date(Math.max(...eventDates.map((date) => date.getTime())));
  const local = easternParts(latestKickoff);
  const daysUntilWednesday = ((3 - local.weekday + 7) % 7) || 7;
  return easternTimeToUtc(local.year, local.month, local.day + daysUntilWednesday, 0, 0, 0);
}

function easternParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayByName = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day), weekday: weekdayByName[value.weekday] };
}

function easternTimeToUtc(year, month, day, hour, minute, second) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let index = 0; index < 2; index += 1) {
    const offset = timeZoneOffsetMs(new Date(utc), EASTERN_TIME_ZONE);
    utc = Date.UTC(year, month - 1, day, hour, minute, second) - offset;
  }
  return new Date(utc);
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day), Number(value.hour) % 24, Number(value.minute), Number(value.second));
  return asUtc - date.getTime();
}

export function buildLeagueTeams({ rosters, users, matchups, espnScores, playersById, playerStats, playerProjections, scoringSettings, rosterPositions, nflGames, playerTeams = {}, historical = false }) {
  const usersById = new Map((users || []).map((user) => [user.user_id, user]));
  const matchupsByRoster = new Map((matchups || []).map((matchup) => [matchup.roster_id, matchup]));
  const hasScoredMatchups = (matchups || []).some((matchup) => matchup.matchup_id != null);
  return (rosters || [])
    .filter((roster) => !hasScoredMatchups || matchupsByRoster.get(roster.roster_id)?.matchup_id != null)
    .map((roster) => {
      const user = usersById.get(roster.owner_id) || {};
      const matchup = matchupsByRoster.get(roster.roster_id) || {};
      if (matchup.roster_id != null && (!Array.isArray(matchup.starters) || matchup.points == null)) {
        throw new Error("Sleeper weekly lineup or team points are missing");
      }
      const rawStarters = matchup.starters || roster.starters || [];
      const rawStarterPoints = matchup.starters_points || [];
      const starterEntries = rawStarters
        .map((playerId, index) => ({ playerId: String(playerId || "0"), points: rawStarterPoints[index] ?? matchup.players_points?.[playerId] }));
      if (matchup.roster_id != null && starterEntries.some(({ playerId, points }) => playerId !== "0" && (points == null || !Number.isFinite(Number(points))))) {
        throw new Error("Sleeper starter points are missing or invalid");
      }
      const starters = starterEntries.map(({ playerId }) => playerId);
      const startersPoints = starterEntries.map(({ points }) => points);
      const dstStarterIndex = starters.findIndex((playerId) => isDefenseId(playerId));
      const dstTeam = dstStarterIndex >= 0 ? starters[dstStarterIndex] : "";
      const sleeperDstPoints = dstStarterIndex >= 0 ? Number(startersPoints[dstStarterIndex]) : 0;
      if (!Number.isFinite(sleeperDstPoints)) throw new Error("Sleeper starting D/ST points are missing");
      const customDst = espnScores.dstScores[espnDefenseKey(dstTeam)] || { points: 0, components: [], games: [], oldComponents: [], oldEstimatedPoints: 0 };
      const sleeperTotal = Number(matchup.custom_points ?? matchup.points ?? 0);
      if (!Number.isFinite(sleeperTotal)) throw new Error("Sleeper weekly team points are invalid");
      const nonDstSleeperTotal = round(sleeperTotal - sleeperDstPoints);
      const projectedCustomTotal = round(nonDstSleeperTotal + customDst.points);
      const dstNflGames = (nflGames || []).filter((game) => game.teams?.some((team) => espnDefenseKey(team.abbreviation) === espnDefenseKey(dstTeam)));
      const oldDstAudit = sleeperDefaultDstAudit(playerStats?.[dstTeam] ?? playerStats?.[espnDefenseKey(dstTeam)], dstNflGames);
      const sleeperDefaultDstPoints = oldDstAudit.total;
      return {
        rosterId: roster.roster_id,
        matchupId: matchup.matchup_id ?? null,
        ownerId: roster.owner_id,
        manager: user.display_name || `Roster ${roster.roster_id}`,
        teamName: user.metadata?.team_name || user.display_name || `Roster ${roster.roster_id}`,
        avatar: sleeperAvatar(user.metadata?.avatar || user.avatar),
        record: roster.metadata?.record || "",
        wins: Number(roster.settings?.wins || 0),
        losses: Number(roster.settings?.losses || 0),
        ties: Number(roster.settings?.ties || 0),
        sleeperTotal: round(sleeperTotal),
        sleeperDstPoints: round(sleeperDstPoints),
        sleeperDefaultDstPoints,
        sleeperDefaultTotal: sleeperDefaultDstPoints == null ? null : round(nonDstSleeperTotal + sleeperDefaultDstPoints),
        nonDstSleeperTotal,
        projectedCustomTotal,
        dstTeam,
        customDstPoints: round(customDst.points),
        customDstRawPoints: round(customDst.rawPoints ?? customDst.points),
        customDstFloorAdjustment: round(customDst.floorAdjustment || 0),
        customDstDelta: sleeperDefaultDstPoints == null ? null : round(customDst.points - sleeperDefaultDstPoints),
        scoringProvisional: !!customDst.issues?.length,
        newDstAudit: { total: round(customDst.points), rawTotal: round(customDst.rawPoints ?? customDst.points),
          floorAdjustment: round(customDst.floorAdjustment || 0), components: customDst.components || [] },
        oldDstAudit,
        dstComponents: customDst.components || [],
        dstGames: customDst.games || [],
        starters: buildStarters({ starters, startersPoints, playersPoints: matchup.players_points || {}, rosterPositions, playersById, playerStats, playerProjections, scoringSettings, dstTeam, customDst, sleeperDefaultDstPoints, nflGames, playerTeams, historical }),
      };
    })
    .sort((a, b) => b.projectedCustomTotal - a.projectedCustomTotal);
}

function buildStarters({ starters, startersPoints, playersPoints, rosterPositions, playersById, playerStats, playerProjections, scoringSettings, dstTeam, customDst, sleeperDefaultDstPoints, nflGames, playerTeams, historical }) {
  return starters.map((playerId, index) => {
    const player = playersById?.[playerId] || {};
    const stats = playerStats?.[playerId] || {};
    const projection = playerProjections?.[playerId] || {};
    const isDefense = isDefenseId(playerId);
    const team = isDefense ? playerId : playerTeams[nameKey(playerName(player, playerId))] || (historical ? "" : player.team || "");
    const sleeperScore = round(Number(startersPoints[index] ?? playersPoints[playerId] ?? 0));
    const position = player.position || player.fantasy_positions?.[0] || (isDefense ? "DEF" : "");
    const schedule = starterSchedule(team, nflGames);
    return withLiveProjection({
      playerId,
      slot: rosterPositions[index] || position || "STARTER",
      name: playerId === "0" ? "Empty slot" : playerName(player, playerId),
      shortName: playerId === "0" ? "Empty slot" : shortPlayerName(player, playerId),
      position,
      team,
      injuryStatus: historical ? "" : compactInjuryStatus(player.injury_status),
      status: player.status || "",
      score: isDefense && playerId === dstTeam ? round(customDst.points) : sleeperScore,
      sleeperScore,
      sleeperDefaultScore: isDefense ? sleeperDefaultDstPoints : null,
      projectedScore: playerId === "0" ? null : isDefense ? sleeperDstProjection(projection) : leagueProjectionPoints(projection, scoringSettings),
      customScore: isDefense ? round(customDst.points) : null,
      isDefense,
      statsLine: playerStatsLine(position, stats),
      ...schedule,
    }, schedule.gameStart ? { status: schedule.gameStatus, statusState: schedule.gameStatusState, completed: schedule.gameCompleted,
      period: schedule.gamePeriod, clock: schedule.gameClock } : null, { bye: !historical && !!nflGames?.length && !!team && !schedule.gameStart });
  });
}

function playerStatsLine(position, stats = {}) {
  const parts = [];
  const pos = String(position || "").toUpperCase();
  const passCmp = statValue(stats, "pass_cmp");
  const passAtt = statValue(stats, "pass_att");
  if (passCmp != null || passAtt != null) {
    parts.push(`${formatStat(passCmp || 0)}/${formatStat(passAtt || 0)} CMP`);
    addStatPart(parts, stats, "pass_yd", "YD");
    addStatPart(parts, stats, "pass_td", "TD");
    addStatPart(parts, stats, "pass_int", "INT");
  }
  if (statValue(stats, "rush_att") != null) {
    parts.push(`${formatStat(statValue(stats, "rush_att"))} CAR`);
    addStatPart(parts, stats, "rush_yd", "YD");
    addStatPart(parts, stats, "rush_td", "TD");
  }
  const rec = statValue(stats, "rec");
  const recTgt = statValue(stats, "rec_tgt");
  if (rec != null || recTgt != null) {
    parts.push(`${formatStat(rec || 0)}/${formatStat(recTgt || 0)} REC`);
    addStatPart(parts, stats, "rec_yd", "YD");
    addStatPart(parts, stats, "rec_td", "TD");
  }
  addStatPart(parts, stats, "fum_lost", "FMBL");
  if (pos === "K") {
    const fgm = statValue(stats, "fgm");
    const fga = statValue(stats, "fga");
    const xpm = statValue(stats, "xpm");
    const xpa = statValue(stats, "xpa");
    if (fgm != null || fga != null) parts.push(`${formatStat(fgm || 0)}/${formatStat(fga || 0)} FG`);
    if (xpm != null || xpa != null) parts.push(`${formatStat(xpm || 0)}/${formatStat(xpa || 0)} XP`);
  }
  if (pos === "DEF") {
    addStatPart(parts, stats, "sack", "SACK");
    addStatPart(parts, stats, "int", "INT");
    addStatPart(parts, stats, "fum_rec", "FR");
    addStatPart(parts, stats, "def_td", "TD");
    addStatPart(parts, stats, "safe", "SAFE");
    addStatPart(parts, stats, "pts_allow", "PA");
  }
  return parts.join(", ");
}

function addStatPart(parts, stats, key, label) {
  const value = statValue(stats, key);
  if (value == null || value === 0) return;
  parts.push(`${formatStat(value)} ${label}`);
}

function statValue(stats, key) {
  const value = stats?.[key];
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatStat(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function playerName(player, playerId) {
  if (player.full_name) return player.full_name;
  if (player.first_name || player.last_name) return `${player.first_name || ""} ${player.last_name || ""}`.trim();
  return playerId;
}

function shortPlayerName(player, playerId) {
  if (player.first_name && player.last_name) return `${player.first_name[0]}. ${player.last_name}`;
  return playerName(player, playerId);
}

function buildMatchups(teams) {
  const groups = new Map();
  for (const team of teams) {
    const key = team.matchupId == null ? `solo-${team.rosterId}` : String(team.matchupId);
    const current = groups.get(key) || [];
    current.push(team);
    groups.set(key, current);
  }
  return [...groups.entries()]
    .map(([id, matchupTeams]) => ({ id, teams: matchupTeams.sort((a, b) => Number(a.rosterId) - Number(b.rosterId)) }))
    .sort((a, b) => Number(b.teams[0]?.projectedCustomTotal || 0) - Number(a.teams[0]?.projectedCustomTotal || 0));
}

function isDefenseId(playerId) {
  return /^[A-Z]{2,3}$/.test(String(playerId || ""));
}

function espnDefenseKey(sleeperDefenseId) {
  return SLEEPER_TO_ESPN_DEFENSE[sleeperDefenseId] || sleeperDefenseId;
}

function sleeperAvatar(id) {
  if (String(id || "").startsWith("http")) return id;
  return id ? `https://sleepercdn.com/avatars/thumbs/${id}` : "";
}

async function readSnapshot(db, leagueId, season, week) {
  const row = await db
    .prepare("SELECT dashboard, finalized_at FROM dst_snapshots WHERE league_id = ? AND season = ? AND week = ? LIMIT 1")
    .bind(String(leagueId), Number(season), Number(week))
    .first();
  if (!row?.dashboard) return null;
  try {
    const dashboard = JSON.parse(String(row.dashboard));
    if (dashboard.source?.liveEstimateVersion !== LIVE_ESTIMATE_VERSION || dashboard.source?.gameViewVersion !== GAME_VIEW_VERSION || dashboard.source?.scoringVersion !== SCORING_VERSION
      || dashboard.source?.sleeperDefaultScoringVersion !== SLEEPER_DEFAULT_SCORING_VERSION || !dashboard.health?.ok) return null;
    return { dashboard, finalizedAt: String(row.finalized_at || "") };
  } catch {
    return null;
  }
}

async function saveSnapshot(db, dashboard) {
  await db
    .prepare(`INSERT INTO dst_snapshots (league_id, season, week, dashboard, finalized_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (league_id, season, week) DO UPDATE SET
        dashboard = excluded.dashboard,
        finalized_at = excluded.finalized_at,
        updated_at = CURRENT_TIMESTAMP`)
    .bind(
      String(dashboard.league.id),
      Number(dashboard.selected.season),
      Number(dashboard.selected.week),
      JSON.stringify(dashboard),
      String(dashboard.correction.finalizesAt || dashboard.generatedAt),
    )
    .run();
}

function dashboardFromSnapshot(snapshot) {
  const dashboard = snapshot.dashboard;
  return {
    ...dashboard,
    servedAt: new Date().toISOString(),
    health: { ...(dashboard.health || {}), ok: true, stale: false, warnings: [], liveGameCount: 0, pollIntervalMs: 0 },
    source: { ...(dashboard.source || {}), snapshot: true, snapshotSaved: true },
    correction: { ...(dashboard.correction || {}), status: "finalized", label: "Finalized snapshot", finalizesAt: snapshot.finalizedAt || dashboard.correction?.finalizesAt || null },
  };
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
