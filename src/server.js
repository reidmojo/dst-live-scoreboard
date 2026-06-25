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

const cache = new Map();

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
  const sleeperState = await fetchJson(`${SLEEPER_BASE}/state/nfl`, { ttlMs: 60_000 });
  const league = await fetchJson(`${SLEEPER_BASE}/league/${LEAGUE_ID}`, { ttlMs: 300_000 });
  const season = url.searchParams.get("season") || league.season || sleeperState.league_season || sleeperState.season;
  const requestedWeek = Number(url.searchParams.get("week") || 0);
  const week = clampWeek(requestedWeek || defaultWeek(sleeperState, league));
  const [rosters, users, matchups, scoreboard] = await Promise.all([
    fetchJson(`${SLEEPER_BASE}/league/${LEAGUE_ID}/rosters`, { ttlMs: 300_000 }),
    fetchJson(`${SLEEPER_BASE}/league/${LEAGUE_ID}/users`, { ttlMs: 300_000 }),
    fetchJson(`${SLEEPER_BASE}/league/${LEAGUE_ID}/matchups/${week}`, { ttlMs: 30_000, allow404: true }),
    fetchJson(`${ESPN_SCOREBOARD}?seasontype=2&week=${week}&dates=${season}`, { ttlMs: 20_000 })
  ]);

  const events = scoreboard.events || [];
  const summaries = new Map();
  await Promise.all(
    events.map(async (event) => {
      if (!event.competitions?.[0]?.playByPlayAvailable && event.status?.type?.state === "pre") return;
      const summary = await fetchJson(`${ESPN_SUMMARY}?event=${event.id}`, { ttlMs: 20_000, allow404: true });
      if (summary) summaries.set(event.id, summary);
    })
  );

  const espnScores = scoreWeekFromEspn(events, summaries, league.scoring_settings || {});
  const teams = buildLeagueTeams({ rosters, users, matchups: matchups || [], espnScores });
  const matchupsView = buildMatchups(teams);

  json(res, {
    generatedAt: new Date().toISOString(),
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
    weeks: Array.from({ length: MAX_FANTASY_WEEK }, (_, index) => index + 1),
    teams,
    matchups: matchupsView,
    nflGames: espnScores.games,
    dstScores: espnScores.dstScores
  });
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

function buildLeagueTeams({ rosters, users, matchups, espnScores }) {
  const usersById = new Map(users.map((user) => [user.user_id, user]));
  const matchupsByRoster = new Map(matchups.map((matchup) => [matchup.roster_id, matchup]));
  return rosters
    .map((roster) => {
      const user = usersById.get(roster.owner_id) || {};
      const matchup = matchupsByRoster.get(roster.roster_id) || {};
      const starters = matchup.starters || roster.starters || [];
      const startersPoints = matchup.starters_points || [];
      const dstStarterIndex = starters.findIndex((playerId) => isDefenseId(playerId));
      const dstTeam = dstStarterIndex >= 0 ? starters[dstStarterIndex] : "";
      const sleeperDstPoints = dstStarterIndex >= 0 ? Number(startersPoints[dstStarterIndex] || 0) : 0;
      const customDst = espnScores.dstScores[dstTeam] || { points: 0, components: [], games: [], oldComponents: [], oldEstimatedPoints: 0 };
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
        avatar: user.metadata?.avatar || sleeperAvatar(user.avatar),
        record: roster.metadata?.record || "",
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
        dstGames: customDst.games || []
      };
    })
    .sort((a, b) => b.projectedCustomTotal - a.projectedCustomTotal);
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
      teams: matchupTeams.sort((a, b) => b.projectedCustomTotal - a.projectedCustomTotal)
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

function sleeperAvatar(id) {
  return id ? `https://sleepercdn.com/avatars/thumbs/${id}` : "";
}

async function fetchJson(url, options = {}) {
  const ttlMs = options.ttlMs ?? 30_000;
  const cached = cache.get(url);
  if (cached && Date.now() - cached.time < ttlMs) return cached.value;

  const response = await fetch(url, {
    headers: { "accept": "application/json", "user-agent": "dst-live-scoreboard/0.1" }
  });
  if (options.allow404 && response.status === 404) return null;
  if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${url}`);
  const value = await response.json();
  cache.set(url, { time: Date.now(), value });
  return value;
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
