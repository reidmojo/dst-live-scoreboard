const SCORING = {
  touchdownAllowed: -1,
  fieldGoalAllowed: -0.5,
  defenseLt20: 1,
  defense20To50: 1.5,
  offense49To20: 2.5,
  offenseLt20: 3.5,
  dstTouchdown: 6,
  safety: 2,
};

export const SCORING_VERSION = "2026-09-09.2";
const TAKEOVER_RESULTS = /PUNT|INTERCEPT|^INT$|FUMBLE|DOWNS|MISSED|BLOCKED/;
const NO_BUCKET_RESULTS = new Set(["END OF HALF", "END OF GAME", "END OF REGULATION"]);

export function teamAbbr(team) {
  return team?.abbreviation || team?.team?.abbreviation || "";
}

export function scoreWeekFromEspn(events, summaries, oldScoring = {}) {
  const games = [];
  const byTeam = new Map();

  for (const event of events) {
    const summary = summaries.get(event.id);
    const game = normalizeGame(event, summary, oldScoring);
    games.push(game);

    for (const score of game.teamScores) {
      const current = byTeam.get(score.team) || emptyTeamScore(score.team);
      current.points += score.points;
      current.components.push(...score.components);
      current.issues.push(...(score.issues || []));
      current.oldComponents.push(...(score.oldAudit?.components || []));
      current.oldEstimatedPoints += score.oldAudit?.estimatedPoints || 0;
      current.games.push({
        gameId: game.id,
        opponent: score.opponent,
        status: game.status,
        points: round(score.points),
      });
      byTeam.set(score.team, current);
    }
  }

  for (const score of byTeam.values()) {
    score.points = round(score.points);
    score.oldEstimatedPoints = round(score.oldEstimatedPoints);
    score.components.sort((a, b) => String(a.gameId).localeCompare(String(b.gameId)) || (a.period || 0) - (b.period || 0) || clockSeconds(b.clock) - clockSeconds(a.clock) || a.sequence - b.sequence);
  }

  return {
    games,
    dstScores: Object.fromEntries([...byTeam.entries()].sort()),
  };
}

function emptyTeamScore(team) {
  return {
    team,
    points: 0,
    components: [],
    issues: [],
    oldComponents: [],
    oldEstimatedPoints: 0,
    games: [],
  };
}

function normalizeGame(event, summary, oldScoring) {
  const competition = event.competitions?.[0] || summary?.header?.competitions?.[0] || {};
  const competitors = competition.competitors || [];
  const teamInfo = competitors.map((competitor) => ({
    id: String(competitor.id || competitor.team?.id || ""),
    abbreviation: competitor.team?.abbreviation || "",
    displayName: competitor.team?.displayName || "",
    shortName: competitor.team?.shortDisplayName || competitor.team?.name || "",
    logo: competitor.team?.logo || competitor.team?.logos?.[0]?.href || "",
    color: competitor.team?.color || "1f2937",
    homeAway: competitor.homeAway || "",
    score: Number(competitor.score || 0),
  }));
  const teamsById = new Map(teamInfo.map((team) => [team.id, team]));
  const teamsByAbbr = new Map(teamInfo.map((team) => [team.abbreviation, team]));
  const activeDrive = summary?.drives?.current;
  const drives = uniqueById([...(summary?.drives?.previous || []), ...(activeDrive ? [activeDrive] : [])]);
  const scoringPlays = uniqueById([
    ...drives.flatMap((drive) => (drive.plays || []).filter((play) => play.scoringPlay)),
    ...(summary?.scoringPlays || []).map((play) => ({ ...play, scoringPlay: true })),
  ]);
  const resolveTeam = (team) => teamsById.get(String(team?.id || ""))?.abbreviation || team?.abbreviation || "";
  const teamScores = teamInfo.map((team) => ({
    team: team.abbreviation,
    opponent: teamInfo.find((other) => other.abbreviation !== team.abbreviation)?.abbreviation || "",
    points: 0,
    components: [],
    issues: [],
  }));
  const scoreByTeam = new Map(teamScores.map((score) => [score.team, score]));

  drives.forEach((drive, index) => {
    const offense = resolveTeam(drive.team);
    const defense = teamInfo.find((team) => team.abbreviation && team.abbreviation !== offense)?.abbreviation || "";
    if (!teamsByAbbr.has(offense) || !defense) {
      for (const score of teamScores) score.issues.push("Drive awaiting team confirmation");
      return;
    }
    if (!drive.result && !drive.shortDisplayResult && !drive.displayResult) return;

    const component = scoreDrive({
      drive,
      nextDrive: drives[index + 1] ? { ...drives[index + 1], team: { abbreviation: resolveTeam(drives[index + 1].team) } } : null,
      scoringPlays,
      offense,
      defense,
      teamsByAbbr,
      sequence: index + 1,
    });

    if (!component) return;
    const defenseScore = scoreByTeam.get(defense);
    if (!defenseScore) return;
    defenseScore.points += component.points;
    defenseScore.components.push({ ...component, gameId: event.id });
    if (component.pending) defenseScore.issues.push(component.label);
  });

  // Special-team returns may be absent from the drive list or belong to the receiving team.
  // Credit the scoring team once, using the play id shared by the two ESPN collections.
  for (const play of scoringPlays) {
    if (!isReturnTouchdown(play)) continue;
    const team = resolveTeam(play.team || play.end?.team);
    const score = scoreByTeam.get(team);
    if (!score) {
      for (const candidate of teamScores) candidate.issues.push("Return touchdown awaiting scoring-team confirmation");
      continue;
    }
    score.points += SCORING.dstTouchdown;
    score.components.push({ kind: "dst_touchdown", label: "D/ST touchdown", points: SCORING.dstTouchdown,
      gameId: event.id, playId: play.id, sequence: Number(play.sequenceNumber || play.id) || 1000,
      period: play.period?.number, clock: play.clock?.displayValue || "", description: play.text || "", source: "ESPN" });
  }

  for (const score of teamScores) {
    // A structurally valid but incomplete feed must never be frozen as final.
    if (event.status?.type?.state !== "pre" && !summary?.drives) score.issues.push("Drive feed unavailable");
    if (Array.isArray(summary?.scoringPlays)) {
      const allowed = summary.scoringPlays.filter((play) => resolveTeam(play.team) === score.opponent);
      const touchdowns = allowed.filter((play) => isTouchdown({ ...play, scoringPlay: true }) && !isReturnTouchdown({ ...play, scoringPlay: true })).length;
      const fieldGoals = allowed.filter((play) => play.scoringType?.name === "field-goal" || play.type?.text === "Field Goal Good").length;
      if (touchdowns !== score.components.filter((row) => row.kind === "touchdown_allowed").length
        || fieldGoals !== score.components.filter((row) => row.kind === "field_goal_allowed").length) {
        score.issues.push("Scoring plays and drive results are awaiting reconciliation");
      }
    }
    score.points = round(score.points);
    score.oldAudit = buildOldDstAudit({
      team: score.team,
      opponent: score.opponent,
      teamInfo,
      drives,
      teamsByAbbr,
      oldScoring,
    });
  }

  return {
    id: event.id,
    shortName: event.shortName,
    name: event.name,
    date: event.date,
    status: event.status?.type?.description || competition.status?.type?.description || "",
    statusState: event.status?.type?.state || competition.status?.type?.state || "",
    clock: event.status?.displayClock || competition.status?.displayClock || "",
    period: event.status?.period || competition.status?.period || 0,
    teams: teamInfo,
    activeDrive: activeDrive ? summarizeDrive(activeDrive, teamsById) : null,
    teamScores,
  };
}

function buildOldDstAudit({ team, opponent, teamInfo, drives, teamsByAbbr, oldScoring }) {
  const opponentInfo = teamInfo.find((candidate) => candidate.abbreviation === opponent) || {};
  const pointsAllowed = Number(opponentInfo.score || 0);
  const components = [];
  const add = (kind, label, count, unit, description = "") => {
    if (!count || !unit) return;
    components.push({ kind, label, count, unit, points: round(count * unit), description });
  };

  const pointsAllowedPoints = pointsAllowedComponent(pointsAllowed, oldScoring);
  components.push({
    kind: "points_allowed",
    label: `Points allowed: ${pointsAllowed}`,
    count: 1,
    unit: pointsAllowedPoints,
    points: pointsAllowedPoints,
    description: `${opponent} scoreboard points against ${team}.`,
  });

  const counts = {
    sacks: 0,
    interceptions: 0,
    forcedFumbles: 0,
    fumbleRecoveries: 0,
    touchdowns: 0,
    safeties: 0,
    blockedKicks: 0,
  };

  for (const drive of drives) {
    const offense = drive.team?.abbreviation || "";
    const defense = teamInfo.find((candidate) => candidate.abbreviation && candidate.abbreviation !== offense)?.abbreviation || "";
    if (defense !== team) continue;

    const result = String(drive.result || drive.shortDisplayResult || drive.displayResult || "").toUpperCase();
    if (result.includes("SAFETY")) counts.safeties += 1;
    if (hasDstTouchdown(drive, team, teamsByAbbr)) counts.touchdowns += 1;

    for (const play of drive.plays || []) {
      const text = `${play.type?.text || ""} ${play.text || ""}`.toUpperCase();
      if (/\bSACKED\b|\bSACK\b/.test(text)) counts.sacks += 1;
      if (text.includes("INTERCEPTED")) counts.interceptions += 1;
      if (text.includes("FUMBLES")) counts.forcedFumbles += 1;
      if (text.includes("FUMBLES") && recoveredByDefense(text, team, offense)) counts.fumbleRecoveries += 1;
      if (text.includes("BLOCKED")) counts.blockedKicks += 1;
    }
  }

  add("sacks", "Sacks", counts.sacks, numberSetting(oldScoring, "sack", 1));
  add("interceptions", "Interceptions", counts.interceptions, numberSetting(oldScoring, "int", 2));
  add("forced_fumbles", "Forced fumbles", counts.forcedFumbles, numberSetting(oldScoring, "ff", 1));
  add("fumble_recoveries", "Fumble recoveries", counts.fumbleRecoveries, numberSetting(oldScoring, "fum_rec", 2));
  add("dst_touchdowns", "D/ST touchdowns", counts.touchdowns, numberSetting(oldScoring, "def_td", 6));
  add("safeties", "Safeties", counts.safeties, numberSetting(oldScoring, "safe", 2));
  add("blocked_kicks", "Blocked kicks", counts.blockedKicks, numberSetting(oldScoring, "blk_kick", 2));

  return {
    estimatedPoints: round(components.reduce((sum, component) => sum + Number(component.points || 0), 0)),
    components,
  };
}

function pointsAllowedComponent(pointsAllowed, oldScoring) {
  if (pointsAllowed === 0) return numberSetting(oldScoring, "pts_allow_0", 10);
  if (pointsAllowed <= 6) return numberSetting(oldScoring, "pts_allow_1_6", 7);
  if (pointsAllowed <= 13) return numberSetting(oldScoring, "pts_allow_7_13", 4);
  if (pointsAllowed <= 20) return numberSetting(oldScoring, "pts_allow_14_20", 1);
  if (pointsAllowed <= 27) return numberSetting(oldScoring, "pts_allow_21_27", 0);
  if (pointsAllowed <= 34) return numberSetting(oldScoring, "pts_allow_28_34", -1);
  return numberSetting(oldScoring, "pts_allow_35p", -4);
}

function numberSetting(settings, key, fallback) {
  const value = Number(settings?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function recoveredByDefense(text, defense, offense) {
  if (text.includes(`RECOVERED BY ${defense}-`)) return true;
  if (text.includes(`RECOVERED BY ${offense}-`)) return false;
  return text.includes("RECOVERED BY") && !text.includes("RECOVERED BY TEAM");
}

function scoreDrive({ drive, nextDrive, offense, defense, teamsByAbbr, sequence, scoringPlays }) {
  const result = String(drive.result || drive.shortDisplayResult || drive.displayResult || "").toUpperCase();
  const displayResult = drive.displayResult || drive.shortDisplayResult || drive.result || "Drive";
  const base = {
    sequence,
    driveId: drive.id || null,
    offense,
    defense,
    result: displayResult,
    description: drive.description || "",
    start: drive.start?.text || "",
    end: drive.end?.text || "",
    period: drive.end?.period?.number || drive.start?.period?.number || null,
    clock: drive.end?.clock?.displayValue || drive.start?.clock?.displayValue || "",
    source: "ESPN",
  };
  const drivePlays = (drive.plays || []).map((play) => scoringPlays.find((candidate) => candidate.id && candidate.id === play.id) || play);
  const touchdown = drivePlays.find(isTouchdown);
  const returnResult = /(?:INT|INTERCEPTION|FUMBLE|PUNT|KICKOFF|BLOCKED).*?(?:TD|TOUCHDOWN)/.test(result);
  if (returnResult || drivePlays.some(isReturnTouchdown)) {
    // Return points are credited separately to the scoring team, never charged as an offensive TD.
    if (!drivePlays.some(isReturnTouchdown)) return { ...base, kind: "pending", points: 0, pending: true, label: "Return touchdown awaiting play confirmation" };
    return null;
  }
  if (result === "TD" || result === "TOUCHDOWN") {
    if (touchdown && String((touchdown.team || touchdown.end?.team)?.id || "") === String(teamsByAbbr.get(defense)?.id)) return null;
    return { ...base, kind: "touchdown_allowed", label: "TD allowed", points: SCORING.touchdownAllowed };
  }
  if (["FG", "FIELD GOAL", "FIELD GOAL GOOD"].includes(result)) {
    return { ...base, kind: "field_goal_allowed", label: "FG allowed", points: SCORING.fieldGoalAllowed };
  }
  if (NO_BUCKET_RESULTS.has(result)) return null;
  const safety = result.includes("SAFETY");
  if (!safety && !TAKEOVER_RESULTS.test(result)) {
    return { ...base, kind: "pending", label: `Unrecognized drive result: ${displayResult}`, points: 0, pending: true };
  }
  const endPeriod = drive.end?.period?.number;
  const nextPeriod = nextDrive?.start?.period?.number;
  // A halftime/overtime kickoff is not the takeover from the preceding possession.
  const crossesBreak = (endPeriod <= 2 && nextPeriod >= 3) || (endPeriod <= 4 && nextPeriod >= 5);
  const bucket = crossesBreak ? null : takeoverBucket(nextDrive, offense, defense, teamsByAbbr);
  const pending = !crossesBreak && nextDrive?.team?.abbreviation === defense && !bucket;
  if (!bucket && !safety && !pending) return null;
  return {
    ...base,
    kind: safety ? "safety" : pending ? "pending" : "takeover",
    label: safety ? `Safety${bucket ? ` + ${bucket.label}` : ""}` : pending ? "Takeover awaiting field position" : bucket.label,
    points: round((safety ? SCORING.safety : 0) + (bucket?.points || 0)),
    pending,
    bucket: bucket?.name || null,
    takeover: bucket?.takeover || "",
  };
}

function uniqueById(items) {
  const result = new Map();
  for (const [index, item] of items.entries()) {
    const key = item.id ? String(item.id) : `anonymous-${index}`;
    result.set(key, { ...result.get(key), ...item });
  }
  return [...result.values()];
}

function clockSeconds(clock) {
  const [minutes, seconds] = String(clock || "0:00").split(":").map(Number);
  return minutes * 60 + seconds;
}

function isTouchdown(play) {
  if (!play?.scoringPlay) return false;
  const type = String(play.type?.text || "").toUpperCase();
  if (/EXTRA POINT|TWO.POINT|CONVERSION|SAFETY|FIELD GOAL/.test(type)) return false;
  if (play.scoringType?.name) return play.scoringType.name === "touchdown";
  return /TOUCHDOWN/.test(type) || /TOUCHDOWN/.test(String(play.text || "").split(/TWO-POINT|EXTRA POINT/i)[0]);
}

function isReturnTouchdown(play) {
  if (!isTouchdown(play)) return false;
  const type = String(play.type?.text || "").toUpperCase();
  if (/PASSING|RUSHING|OFFENSIVE/.test(type)) return false;
  if (/INTERCEPTION|FUMBLE RETURN|FUMBLE RECOVERY \(OPPONENT\)|DEFENSIVE|PUNT|KICKOFF|KICK RETURN|BLOCKED/.test(type)) return true;
  const text = String(play.text || "").toUpperCase().split(/TWO-POINT|EXTRA POINT/)[0];
  return /INTERCEPTED|INTERCEPTION RETURN|KICKOFF RETURN|PUNT RETURN|BLOCKED.*TOUCHDOWN/.test(text);
}

function hasDstTouchdown(drive, defense, teamsByAbbr) {
  const defenseId = teamsByAbbr.get(defense)?.id;
  return (drive.plays || []).some((play) => isReturnTouchdown(play)
    && String((play.team || play.end?.team)?.id || "") === String(defenseId));
}

function takeoverBucket(nextDrive, offense, defense, teamsByAbbr) {
  const nextOffense = nextDrive?.team?.abbreviation || "";
  if (!nextDrive || nextOffense !== defense) return null;

  const takeoverText = nextDrive.start?.text || "";
  const y100ForOriginalOffense = yardline100(takeoverText, offense, defense);
  if (!Number.isFinite(y100ForOriginalOffense)) return null;
  const defenseTeam = teamsByAbbr.get(defense);
  const offenseTeam = teamsByAbbr.get(offense);

  if (y100ForOriginalOffense < 20) {
    return { name: "defense_lt_20", label: `${defense} takes over inside own 20`, points: SCORING.defenseLt20, takeover: takeoverText, color: defenseTeam?.color };
  }
  if (y100ForOriginalOffense <= 50) {
    return { name: "defense_20_to_50", label: `${defense} takes over own 20-50`, points: SCORING.defense20To50, takeover: takeoverText, color: defenseTeam?.color };
  }
  if (y100ForOriginalOffense <= 80) {
    return { name: "offense_49_to_20", label: `${defense} takes over at ${offense} 49-20`, points: SCORING.offense49To20, takeover: takeoverText, color: offenseTeam?.color };
  }
  return { name: "offense_lt_20", label: `${defense} takes over inside ${offense} 20`, points: SCORING.offenseLt20, takeover: takeoverText, color: offenseTeam?.color };
}

function yardline100(text, offense, defense) {
  const clean = String(text || "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!clean) return null;
  if (clean === "50" || clean.startsWith("MID ")) return 50;
  const match = clean.match(/^([A-Z]{2,3})\s+(\d{1,2})$/);
  if (!match) return null;
  const [, side, yardText] = match;
  const yard = Number(yardText);
  if (!Number.isInteger(yard) || yard < 1 || yard > 50) return null;
  if (side === offense) return 100 - yard;
  if (side === defense) return yard;
  return null;
}

function summarizeDrive(drive, teamsById) {
  const team = drive.team?.abbreviation || teamsById.get(String(drive.team?.id || ""))?.abbreviation || "";
  return {
    team,
    description: drive.description || "",
    result: drive.displayResult || drive.shortDisplayResult || drive.result || "",
    start: drive.start?.text || "",
    end: drive.end?.text || "",
  };
}

export function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
