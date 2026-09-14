import { nameKey, weeklyPlayerTeams } from "./audit.js";
import { compactInjuryStatus } from "./presentation.js";
import { leagueProjectionPoints, sleeperDstProjection } from "./projections.js";
import { withLiveProjection } from "./live-estimates.js";
import { sleeperDefaultDstAudit } from "./sleeper-default.js";

export const GAME_VIEW_VERSION = "2026-09-11.2";
const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const LABELS = {
  pass_yd: "Passing yards", pass_td: "Passing TDs", pass_int: "Interceptions thrown", pass_2pt: "Passing 2PT",
  rush_yd: "Rushing yards", rush_td: "Rushing TDs", rush_2pt: "Rushing 2PT", rec: "Receptions",
  rec_yd: "Receiving yards", rec_td: "Receiving TDs", rec_2pt: "Receiving 2PT", fum_lost: "Fumbles lost",
  bonus_rec_te: "TE reception premium", xpm: "Extra points made", xpmiss: "Extra points missed",
  fgm_0_19: "Field goals 0–19 yd", fgm_20_29: "Field goals 20–29 yd", fgm_30_39: "Field goals 30–39 yd",
  fgm_40_49: "Field goals 40–49 yd", fgm_50p: "Field goals 50+ yd", fgm: "Field goals made",
  fgmiss_0_19: "Missed FG 0–19 yd", fgmiss_20_29: "Missed FG 20–29 yd", fgmiss_30_39: "Missed FG 30–39 yd",
  fgmiss_40_49: "Missed FG 40–49 yd", fgmiss_50p: "Missed FG 50+ yd",
};
export function canonicalNflTeam(value) {
  const team = String(value || "").toUpperCase();
  return ({ WAS: "WSH", JAC: "JAX", LA: "LAR", OAK: "LV", SD: "LAC", STL: "LAR" })[team] || team;
}
const finite = (value) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const round = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export function playerScoringDetails(stats, settings, authoritative = null) {
  const components = Object.entries(settings).flatMap(([key, rate]) => {
    const count = finite(stats?.[key]), multiplier = finite(rate);
    if (count == null || multiplier == null || !count || !multiplier) return [];
    return [{ key, label: LABELS[key] || key.replaceAll("_", " "), count, unit: multiplier, points: round(count * multiplier) }];
  });
  const calculated = round(components.reduce((sum, entry) => sum + entry.points, 0));
  const delta = authoritative == null ? 0 : round(authoritative - calculated);
  if (delta) components.push({ key: "sleeper_adjustment", label: "Sleeper adjustment", count: 1, unit: delta, points: delta });
  return { total: authoritative ?? (stats && Object.keys(stats).length ? calculated : null), components };
}

export function compactGameStats(stats = {}) {
  const parts = [];
  const add = (key, label) => { if (finite(stats[key])) parts.push({ value: String(stats[key]), label }); };
  if (finite(stats.pass_att)) parts.push({ value: `${stats.pass_cmp || 0}/${stats.pass_att}`, label: "CMP" });
  add("pass_yd", "PASS YD"); add("pass_td", "PASS TD"); add("pass_int", "INT");
  add("rush_att", "CAR"); add("rush_yd", "RUSH YD"); add("rush_td", "RUSH TD");
  if (finite(stats.rec_tgt) || finite(stats.rec)) parts.push({ value: `${stats.rec || 0}/${stats.rec_tgt ?? stats.rec}`, label: "REC" });
  add("rec_yd", "REC YD"); add("rec_td", "REC TD"); add("fum_lost", "FUM LOST");
  if (finite(stats.fga) || finite(stats.fgm)) parts.push({ value: `${stats.fgm || 0}/${stats.fga ?? stats.fgm}`, label: "FG" });
  if (finite(stats.xpa) || finite(stats.xpm)) parts.push({ value: `${stats.xpm || 0}/${stats.xpa ?? stats.xpm}`, label: "XP" });
  add("sack", "SACK"); add("int", "INT"); add("fum_rec", "FR"); add("pts_allow", "PA");
  return parts;
}

export function buildGameViews({ games, summaries = new Map(), playersById = {}, playerStats = {}, playerProjections = {},
  scoringSettings = {}, rosters = [], users = [], matchups = [], historical = false }) {
  const gamePlayers = new Map(games.map(game => [String(game.id), []]));
  const gamesByTeam = new Map(games.flatMap(game => game.teams.map(team => [canonicalNflTeam(team.abbreviation), game])));
  const weeklyTeams = weeklyPlayerTeams(summaries);
  const owners = new Map(), points = new Map();
  const usersById = new Map(users.map(user => [user.user_id, user]));
  for (const roster of rosters) {
    const user = usersById.get(roster.owner_id);
    const owner = user?.username || user?.display_name || null;
    for (const id of new Set([...(roster.players || []), ...(roster.reserve || []), ...(roster.taxi || [])].map(String))) {
      owners.set(id, owners.has(id) ? null : owner);
    }
  }
  for (const matchup of matchups) {
    const values = { ...(matchup.players_points || {}) };
    for (const [index, id] of (matchup.starters || []).entries()) {
      if (finite(matchup.starters_points?.[index]) != null) values[id] = matchup.starters_points[index];
    }
    for (const [id, raw] of Object.entries(values)) {
      const value = finite(raw);
      if (value != null) points.set(id, points.has(id) && points.get(id) !== value ? null : value);
    }
  }
  const candidates = new Set([...Object.keys(playerStats), ...Object.keys(playerProjections), ...owners.keys(), ...points.keys()]);
  for (const id of candidates) {
    const player = playersById[id];
    const position = player?.position || player?.fantasy_positions?.[0];
    if (!player || !POSITIONS.slice(0, -1).includes(position)) continue;
    const name = player.full_name || `${player.first_name || ""} ${player.last_name || ""}`.trim() || id;
    const team = canonicalNflTeam(weeklyTeams[nameKey(name)] || (historical ? "" : player.team));
    const game = gamesByTeam.get(team);
    if (!game) continue;
    const stats = playerStats[id];
    const projection = leagueProjectionPoints(playerProjections[id] || {}, scoringSettings);
    const compactStats = compactGameStats(stats);
    if (!compactStats.length && !(projection > 0) && !owners.has(id) && !(points.get(id))) continue;
    const pregame = game.statusState === "pre";
    const details = playerScoringDetails(pregame ? undefined : stats, scoringSettings, pregame ? 0 : points.get(id) ?? null);
    gamePlayers.get(String(game.id)).push({
      playerId: id, name, shortName: player.first_name && player.last_name ? `${player.first_name[0]}. ${player.last_name}` : name,
      position, team, owner: owners.get(id) || null, injuryStatus: historical ? "" : compactInjuryStatus(player.injury_status),
      score: details.total, projectedScore: projection, compactStats: pregame ? [] : compactStats,
      components: details.components, isDefense: false,
    });
  }
  return [...games].sort((a, b) => (Date.parse(a.date) || Infinity) - (Date.parse(b.date) || Infinity) || String(a.id).localeCompare(String(b.id)))
    .map(game => {
      let players = gamePlayers.get(String(game.id));
      for (const team of game.teams) {
        const key = canonicalNflTeam(team.abbreviation), id = key === "WSH" ? "WAS" : key;
        const score = game.teamScores?.find(entry => canonicalNflTeam(entry.team) === key);
        const stats = playerStats[id] || playerStats[key];
        const defaultAudit = sleeperDefaultDstAudit(stats, [game]);
        players.push({ playerId: id, name: `${team.displayName || key} D/ST`, shortName: `${id} D/ST`, position: "DEF", team: key,
          owner: owners.get(id) || owners.get(key) || null, injuryStatus: "", score: score?.points ?? null,
          projectedScore: sleeperDstProjection(playerProjections[id] || playerProjections[key] || {}),
          compactStats: game.statusState === "pre" ? [] : compactGameStats(stats), isDefense: true,
          defaultScore: defaultAudit.total, components: (score?.components || []).map((entry, index) => ({ ...entry, key: `${entry.kind}-${index}` })),
        });
      }
      players = players.map(player => withLiveProjection(player, game));
      const away = game.teams.find(team => team.homeAway === "away") || game.teams[0];
      const home = game.teams.find(team => team.homeAway === "home") || game.teams[1];
      const rank = (a, b) => (game.statusState === "pre" ? (b.projectedScore ?? -Infinity) - (a.projectedScore ?? -Infinity)
        : (b.score ?? -Infinity) - (a.score ?? -Infinity)) || a.name.localeCompare(b.name);
      return { ...game, positionGroups: POSITIONS.map(position => ({ position,
        away: players.filter(player => player.position === position && player.team === canonicalNflTeam(away?.abbreviation)).sort(rank),
        home: players.filter(player => player.position === position && player.team === canonicalNflTeam(home?.abbreviation)).sort(rank),
      })).filter(group => group.away.length || group.home.length),
      ...gameDriveDetails(summaries.get(game.id), game) };
    });
}

export function gameDriveDetails(summary, game) {
  const current = summary?.drives?.current;
  const drives = new Map();
  for (const drive of [...(summary?.drives?.previous || []), ...(current ? [current] : [])]) {
    if (!drive.id) continue;
    const existing = drives.get(String(drive.id));
    const plays = new Map((existing?.plays || []).map(play => [String(play.id), play]));
    for (const [index, play] of (drive.plays || []).entries()) plays.set(String(play.id || `${drive.id}-${index}`), play);
    const orderedPlays = [...plays.values()];
    if (orderedPlays.every(play => finite(play.sequenceNumber) != null)) orderedPlays.sort((a, b) => Number(a.sequenceNumber) - Number(b.sequenceNumber));
    drives.set(String(drive.id), { ...existing, ...drive, plays: orderedPlays });
  }
  const rows = [...drives.values()].map(drive => ({
    id: String(drive.id), team: drive.team?.abbreviation || game.teams.find(team => String(team.id) === String(drive.team?.id))?.abbreviation || "",
    result: String(drive.id) === String(current?.id) && game.statusState === "in" ? "In progress" : drive.displayResult || drive.result || "Drive",
    summary: [drive.offensivePlays != null ? `${drive.offensivePlays} plays` : null, drive.yards != null ? `${drive.yards} yd` : null,
      drive.timeElapsed?.displayValue].filter(Boolean).join(" · "),
    period: drive.end?.period?.number || drive.start?.period?.number || null,
    clock: drive.end?.clock?.displayValue || drive.start?.clock?.displayValue || "",
    plays: drive.plays.map((play, index) => ({ id: String(play.id || `${drive.id}-${index}`), text: play.text || play.shortText || "Play details unavailable",
      period: play.period?.number || null, clock: play.clock?.displayValue || "", downDistance: play.start?.shortDownDistanceText || "", isScore: !!play.scoringPlay })),
  }));
  const lastPlay = rows.flatMap(drive => drive.plays).at(-1);
  return { latestPlay: lastPlay?.text || null, driveResults: rows.reverse() };
}
