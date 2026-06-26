import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreWeekFromEspn } from "./scoring.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const PUBLIC = join(ROOT, "public");

const PORT = Number(process.env.PORT || 4173);
const LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID || "1239299227176157184";
const OBSCURE_PATH = process.env.PUBLIC_PATH || "/is-it-whiskey-dst-live";
const SLEEPER_BASE = "https://api.sleeper.app/v1";
const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const ESPN_SUMMARY = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary";
const MAX_FANTASY_WEEK = 17;
const FIRST_SUPPORTED_SEASON = 2025;
const EASTERN_TIME_ZONE = "America/New_York";
const LIVE_POLL_INTERVAL_MS = 15_000;
const NORMAL_POLL_INTERVAL_MS = 30_000;
const SLEEPER_TO_ESPN_DEFENSE = {
  WAS: "WSH"
};

const cache = new Map();
const dashboardCache = new Map();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/") {
      redirect(res, OBSCURE_PATH);
      return;
    }

    if (url.pathname === "/api/dashboard") {
      await handleDashboard(url, res);
      return;
    }

    if (url.pathname === "/api/config") {
      json(res, { leagueId: LEAGUE_ID, publicPath: OBSCURE_PATH });
      return;
    }

    if (url.pathname === OBSCURE_PATH || url.pathname.startsWith(`${OBSCURE_PATH}/`)) {
      await serveStatic("/index.html", res);
      return;
    }

    if (url.pathname.startsWith("/assets/")) {
      await serveStatic(url.pathname, res);
      return;
    }

    notFound(res);
  } catch (error) {
    console.error(error);
    json(res, { error: error.message || "Unexpected error" }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`DST live scoreboard running at http://localhost:${PORT}${OBSCURE_PATH}`);
});

async function handleDashboard(url, res) {
  const dashboardKey = dashboardCacheKey(url);
  try {
    const dashboard = await buildDashboard(url);
    dashboardCache.set(dashboardKey, { time: Date.now(), value: dashboard });
    json(res, dashboard);
  } catch (error) {
    const cached = dashboardCache.get(dashboardKey) || latestDashboard();
    if (!cached) throw error;
    json(res, markDashboardStale(cached.value, error));
  }
}

async function buildDashboard(url) {
  const requestState = { warnings: [] };
  const sleeperState = await fetchJson(`${SLEEPER_BASE}/state/nfl`, { ttlMs: 60_000, requestState, label: "Sleeper NFL state" });
  const league = await fetchJson(`${SLEEPER_BASE}/league/${LEAGUE_ID}`, { ttlMs: 300_000, requestState, label: "Sleeper league" });
  const seasons = seasonOptions(sleeperState, league);
  const requestedSeason = Number(url.searchParams.get("season") || 0);
  const season = String(selectSeason(requestedSeason, seasons));
  const defaultSelectedWeek = defaultWeek(sleeperState, league);
  const weeks = weekOptionsForSeason(Number(season), seasons.at(-1), defaultSelectedWeek);
  const requestedWeek = Number(url.searchParams.get("week") || 0);
  const week = selectWeek(requestedWeek, weeks);
  const [rosters, users, matchups, scoreboard, playersById, playerStats] = await Promise.all([
    fetchJson(`${SLEEPER_BASE}/league/${LEAGUE_ID}/rosters`, { ttlMs: 300_000, requestState, label: "Sleeper rosters" }),
    fetchJson(`${SLEEPER_BASE}/league/${LEAGUE_ID}/users`, { ttlMs: 300_000, requestState, label: "Sleeper users" }),
    fetchJson(`${SLEEPER_BASE}/league/${LEAGUE_ID}/matchups/${week}`, { ttlMs: 30_000, allow404: true, requestState, label: "Sleeper matchups" }),
    fetchJson(`${ESPN_SCOREBOARD}?seasontype=2&week=${week}&dates=${season}`, { ttlMs: 20_000, requestState, label: "ESPN scoreboard" }),
    fetchJson(`${SLEEPER_BASE}/players/nfl`, { ttlMs: 43_200_000, requestState, label: "Sleeper player metadata" }),
    fetchJson(`${SLEEPER_BASE}/stats/nfl/regular/${season}/${week}`, { ttlMs: 30_000, allow404: true, requestState, label: "Sleeper player stats" })
  ]);

  const events = scoreboard.events || [];
  const summaries = new Map();
  await Promise.all(
    events.map(async (event) => {
      if (!event.competitions?.[0]?.playByPlayAvailable && event.status?.type?.state === "pre") return;
      const summary = await fetchJson(`${ESPN_SUMMARY}?event=${event.id}`, {
        ttlMs: 20_000,
        allow404: true,
        requestState,
        label: `ESPN summary ${event.id}`
      });
      if (summary) summaries.set(event.id, summary);
    })
  );

  const espnScores = scoreWeekFromEspn(events, summaries, league.scoring_settings || {});
  const teams = buildLeagueTeams({
    rosters,
    users,
    matchups: matchups || [],
    espnScores,
    playersById,
    playerStats: playerStats || {},
    rosterPositions: league.roster_positions || []
  });
  const matchupsView = buildMatchups(teams);
  const liveGameCount = countLiveGames(events);
  const pollIntervalMs = liveGameCount > 0 ? LIVE_POLL_INTERVAL_MS : NORMAL_POLL_INTERVAL_MS;
  const correction = correctionStatus(events);

  return {
    generatedAt: new Date().toISOString(),
    health: {
      ok: requestState.warnings.length === 0,
      stale: requestState.warnings.length > 0,
      warnings: requestState.warnings,
      liveGameCount,
      pollIntervalMs
    },
    source: {
      liveDriveData: "ESPN site APIs",
      leagueData: "Sleeper API",
      status: "Prototype; ESPN is unofficial and scores are provisional until corrections are reconciled."
    },
    scoring: {
      touchdownAllowed: -1,
      fieldGoalAllowed: -0.5,
      defenseLt20: 1,
      defense20To50: 1.5,
      offense49To20: 2.5,
      offenseLt20: 3.5,
      dstTouchdown: 6,
      safety: 2
    },
    sleeperState,
    league: {
      id: league.league_id,
      name: league.name,
      avatar: sleeperAvatar(league.avatar),
      season: league.season,
      totalRosters: league.total_rosters,
      lastScoredWeek: league.settings?.last_scored_leg,
      startWeek: league.settings?.start_week
    },
    selected: { season, week },
    seasons,
    weeks,
    correction,
    teams,
    matchups: matchupsView,
    nflGames: espnScores.games,
    dstScores: espnScores.dstScores
  };
}

function defaultWeek(state, league) {
  const activeWeek = Number(state.display_week || state.week || 0);
  if (activeWeek > 0) return clampWeek(activeWeek);
  return clampWeek(Number(league.settings?.last_scored_leg || league.settings?.start_week || MAX_FANTASY_WEEK));
}

function clampWeek(week) {
  if (!Number.isFinite(week) || week < 1) return MAX_FANTASY_WEEK;
  return Math.min(Math.max(Math.trunc(week), 1), MAX_FANTASY_WEEK);
}

function seasonOptions(state, league) {
  const includeStateSeason = state.season_type && state.season_type !== "off";
  const candidates = [
    FIRST_SUPPORTED_SEASON,
    Number(league.season),
    ...(includeStateSeason ? [Number(state.league_season), Number(state.season)] : [])
  ].filter((season) => Number.isFinite(season) && season >= FIRST_SUPPORTED_SEASON);
  const latest = Math.max(...candidates);
  return Array.from({ length: latest - FIRST_SUPPORTED_SEASON + 1 }, (_, index) => FIRST_SUPPORTED_SEASON + index);
}

function selectSeason(requestedSeason, seasons) {
  if (seasons.includes(requestedSeason)) return requestedSeason;
  return seasons.at(-1) || FIRST_SUPPORTED_SEASON;
}

function weekOptionsForSeason(season, latestSeason, defaultSelectedWeek) {
  const maxWeek = season < latestSeason ? MAX_FANTASY_WEEK : clampWeek(defaultSelectedWeek);
  return Array.from({ length: maxWeek }, (_, index) => index + 1);
}

function selectWeek(requestedWeek, weeks) {
  if (weeks.includes(requestedWeek)) return requestedWeek;
  return weeks.at(-1) || MAX_FANTASY_WEEK;
}

function countLiveGames(events) {
  return events.filter((event) => event.status?.type?.state === "in").length;
}

function correctionStatus(events) {
  if (!events.length) {
    return {
      status: "unknown",
      label: "No NFL games found for selected week",
      finalizesAt: null
    };
  }
  if (events.some((event) => event.status?.type?.state === "in")) {
    return {
      status: "live",
      label: "Live; corrections pending",
      finalizesAt: null
    };
  }
  if (events.some((event) => event.status?.type?.state !== "post")) {
    return {
      status: "scheduled",
      label: "Scheduled; scoring will remain provisional",
      finalizesAt: null
    };
  }

  const finalizesAt = correctionCutoff(events);
  if (!finalizesAt) {
    return {
      status: "provisional",
      label: "Final game complete; correction cutoff unavailable",
      finalizesAt: null
    };
  }

  const finalized = Date.now() >= finalizesAt.getTime();
  return {
    status: finalized ? "finalized" : "provisional",
    label: finalized ? "Final after Wednesday correction window" : "Provisional until Wednesday correction window",
    finalizesAt: finalizesAt.toISOString()
  };
}

function correctionCutoff(events) {
  const eventDates = events
    .map((event) => new Date(event.date))
    .filter((date) => Number.isFinite(date.getTime()));
  if (!eventDates.length) return null;
  const latestKickoff = new Date(Math.max(...eventDates.map((date) => date.getTime())));
  const local = easternParts(latestKickoff);
  const daysUntilWednesday = ((3 - local.weekday + 7) % 7) || 7;
  const cutoffDay = local.day + daysUntilWednesday;
  return easternTimeToUtc(local.year, local.month, cutoffDay, 0, 0, 0);
}

function easternParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayByName = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    weekday: weekdayByName[value.weekday]
  };
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
    hour12: false
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(value.year),
    Number(value.month) - 1,
    Number(value.day),
    Number(value.hour) % 24,
    Number(value.minute),
    Number(value.second)
  );
  return asUtc - date.getTime();
}

function buildLeagueTeams({ rosters, users, matchups, espnScores, playersById, playerStats, rosterPositions }) {
  const usersById = new Map(users.map((user) => [user.user_id, user]));
  const matchupsByRoster = new Map(matchups.map((matchup) => [matchup.roster_id, matchup]));
  const hasScoredMatchups = matchups.some((matchup) => matchup.matchup_id != null);
  return rosters
    .filter((roster) => {
      const matchup = matchupsByRoster.get(roster.roster_id);
      return !hasScoredMatchups || matchup?.matchup_id != null;
    })
    .map((roster) => {
      const user = usersById.get(roster.owner_id) || {};
      const matchup = matchupsByRoster.get(roster.roster_id) || {};
      const starters = matchup.starters || roster.starters || [];
      const startersPoints = matchup.starters_points || [];
      const dstStarterIndex = starters.findIndex((playerId) => isDefenseId(playerId));
      const dstTeam = dstStarterIndex >= 0 ? starters[dstStarterIndex] : "";
      const sleeperDstPoints = dstStarterIndex >= 0 ? Number(startersPoints[dstStarterIndex] || 0) : 0;
      const customDst = espnScores.dstScores[espnDefenseKey(dstTeam)] || { points: 0, components: [], games: [], oldComponents: [], oldEstimatedPoints: 0 };
      const sleeperTotal = Number(matchup.points ?? roster.settings?.fpts ?? 0);
      const nonDstSleeperTotal = round(sleeperTotal - sleeperDstPoints);
      const projectedCustomTotal = round(nonDstSleeperTotal + customDst.points);
      const newDstAudit = {
        total: round(customDst.points),
        components: customDst.components || []
      };
      const oldDstAudit = {
        total: round(sleeperDstPoints),
        components: reconcileOldDstComponents(customDst.oldComponents || [], sleeperDstPoints, customDst.oldEstimatedPoints || 0)
      };

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
        nonDstSleeperTotal,
        projectedCustomTotal,
        dstTeam,
        customDstPoints: round(customDst.points),
        customDstDelta: round(customDst.points - sleeperDstPoints),
        newDstAudit,
        oldDstAudit,
        dstComponents: customDst.components || [],
        dstGames: customDst.games || [],
        starters: buildStarters({
          starters,
          startersPoints,
          playersPoints: matchup.players_points || {},
          rosterPositions,
          playersById,
          playerStats,
          dstTeam,
          customDst,
          sleeperDstPoints
        })
      };
    })
    .sort((a, b) => b.projectedCustomTotal - a.projectedCustomTotal);
}

function buildStarters({ starters, startersPoints, playersPoints, rosterPositions, playersById, playerStats, dstTeam, customDst, sleeperDstPoints }) {
  return starters.map((playerId, index) => {
    const player = playersById?.[playerId] || {};
    const stats = playerStats?.[playerId] || {};
    const isDefense = isDefenseId(playerId);
    const sleeperScore = round(Number(startersPoints[index] ?? playersPoints[playerId] ?? 0));
    const score = isDefense && playerId === dstTeam ? round(customDst.points) : sleeperScore;
    const position = player.position || player.fantasy_positions?.[0] || (isDefense ? "DEF" : "");
    return {
      playerId,
      slot: rosterPositions[index] || position || "STARTER",
      name: playerName(player, playerId),
      shortName: shortPlayerName(player, playerId),
      firstName: player.first_name || "",
      lastName: player.last_name || "",
      position,
      team: player.team || playerId,
      injuryStatus: player.injury_status || "",
      status: player.status || "",
      score,
      sleeperScore,
      customScore: isDefense ? round(customDst.points) : null,
      isDefense,
      statsLine: playerStatsLine(position, stats),
      detail: playerDetail(player)
    };
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

  const rushAtt = statValue(stats, "rush_att");
  if (rushAtt != null) {
    parts.push(`${formatStat(rushAtt)} CAR`);
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
  const number = Number(value || 0);
  return number.toLocaleString("en-US", { maximumFractionDigits: 1 });
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

function playerDetail(player) {
  return {
    yearsExp: player.years_exp ?? null,
    depthChartPosition: player.depth_chart_position || "",
    depthChartOrder: player.depth_chart_order ?? null,
    number: player.number ?? null
  };
}

function reconcileOldDstComponents(components, sleeperDstPoints, estimatedPoints) {
  const rows = [...components];
  if (!rows.length) {
    return [
      {
        kind: "sleeper_dst_total",
        label: "Sleeper D/ST total",
        points: round(sleeperDstPoints),
        description: "Sleeper's live old-scoring total for this starting D/ST."
      }
    ];
  }

  const diff = round(Number(sleeperDstPoints || 0) - Number(estimatedPoints || 0));
  if (diff !== 0) {
    rows.push({
      kind: "sleeper_reconciliation",
      label: "Sleeper live adjustment",
      points: diff,
      description: "Reconciles ESPN-derived scoring state to Sleeper's authoritative live D/ST total."
    });
  }
  return rows;
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
    .map(([id, matchupTeams]) => ({
      id,
      teams: matchupTeams.sort((a, b) => Number(a.rosterId) - Number(b.rosterId))
    }))
    .sort((a, b) => {
      const aTop = a.teams[0]?.projectedCustomTotal || 0;
      const bTop = b.teams[0]?.projectedCustomTotal || 0;
      return bTop - aTop;
    });
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

async function fetchJson(url, options = {}) {
  const ttlMs = options.ttlMs ?? 30_000;
  const cached = cache.get(url);
  if (cached && Date.now() - cached.time < ttlMs) return cached.value;

  try {
    const response = await fetch(url, {
      headers: { "accept": "application/json", "user-agent": "dst-live-scoreboard/0.1" }
    });
    if (options.allow404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`Fetch failed ${response.status}`);
    const value = await response.json();
    cache.set(url, { time: Date.now(), value });
    return value;
  } catch (error) {
    if (cached) {
      noteStaleFallback(options.requestState, options.label || url, cached.time, error);
      return cached.value;
    }
    throw new Error(`${options.label || url} unavailable: ${error.message}`);
  }
}

function noteStaleFallback(requestState, label, fetchedAt, error) {
  if (!requestState) return;
  requestState.warnings.push({
    label,
    fetchedAt: new Date(fetchedAt).toISOString(),
    ageSeconds: Math.round((Date.now() - fetchedAt) / 1000),
    message: `Using cached data because live fetch failed: ${error.message}`
  });
}

function dashboardCacheKey(url) {
  const season = url.searchParams.get("season") || "default";
  const week = url.searchParams.get("week") || "default";
  return `${season}:${week}`;
}

function latestDashboard() {
  return [...dashboardCache.values()].sort((a, b) => b.time - a.time)[0];
}

function markDashboardStale(dashboard, error) {
  const warning = {
    label: "Dashboard",
    fetchedAt: dashboard.generatedAt,
    ageSeconds: Math.round((Date.now() - new Date(dashboard.generatedAt).getTime()) / 1000),
    message: `Using last successful dashboard because refresh failed: ${error.message}`
  };
  return {
    ...dashboard,
    servedAt: new Date().toISOString(),
    health: {
      ...(dashboard.health || {}),
      ok: false,
      stale: true,
      pollIntervalMs: NORMAL_POLL_INTERVAL_MS,
      warnings: [...(dashboard.health?.warnings || []), warning]
    }
  };
}

async function serveStatic(pathname, res) {
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC, safePath);
  if (!filePath.startsWith(PUBLIC)) {
    notFound(res);
    return;
  }
  const body = await readFile(filePath);
  res.writeHead(200, { "content-type": contentType(filePath), "cache-control": "no-store" });
  res.end(body);
}

function contentType(pathname) {
  switch (extname(pathname)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "text/html; charset=utf-8";
  }
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

function notFound(res) {
  json(res, { error: "Not found" }, 404);
}

function json(res, value, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
