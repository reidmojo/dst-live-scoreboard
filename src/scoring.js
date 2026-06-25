const SCORING = {
  touchdownAllowed: -1,
  fieldGoalAllowed: -0.5,
  defenseLt20: 1,
  defense20To50: 1.5,
  offense49To20: 2.5,
  offenseLt20: 3.5,
  dstTouchdown: 6,
  safety: 2
};

const SCORING_RESULTS = new Set(["TD", "TOUCHDOWN", "FG", "FIELD GOAL"]);
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
      current.oldComponents.push(...(score.oldAudit?.components || []));
      current.oldEstimatedPoints += score.oldAudit?.estimatedPoints || 0;
      current.games.push({
        gameId: game.id,
        opponent: score.opponent,
        status: game.status,
        points: round(score.points)
      });
      byTeam.set(score.team, current);
    }
  }

  for (const score of byTeam.values()) {
    score.points = round(score.points);
    score.oldEstimatedPoints = round(score.oldEstimatedPoints);
    score.components.sort((a, b) => a.sequence - b.sequence);
  }

  return {
    games,
    dstScores: Object.fromEntries([...byTeam.entries()].sort())
  };
}

function emptyTeamScore(team) {
  return {
    team,
    points: 0,
    components: [],
    oldComponents: [],
    oldEstimatedPoints: 0,
    games: []
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
    score: Number(competitor.score || 0)
  }));
  const teamsById = new Map(teamInfo.map((team) => [team.id, team]));
  const teamsByAbbr = new Map(teamInfo.map((team) => [team.abbreviation, team]));
  const drives = summary?.drives?.previous || [];
  const activeDrive = summary?.drives?.current;
  const teamScores = teamInfo.map((team) => ({
    team: team.abbreviation,
    opponent: teamInfo.find((other) => other.abbreviation !== team.abbreviation)?.abbreviation || "",
    points: 0,
    components: []
  }));
  const scoreByTeam = new Map(teamScores.map((score) => [score.team, score]));

  drives.forEach((drive, index) => {
    const offense = drive.team?.abbreviation || teamsById.get(String(drive.team?.id || ""))?.abbreviation || "";
    const defense = teamInfo.find((team) => team.abbreviation && team.abbreviation !== offense)?.abbreviation || "";
    if (!offense || !defense) return;

    const component = scoreDrive({
      drive,
      nextDrive: drives[index + 1],
      offense,
      defense,
      teamsByAbbr,
      sequence: index + 1
    });

    if (!component || component.points === 0) return;
    const defenseScore = scoreByTeam.get(defense);
    if (!defenseScore) return;
    defenseScore.points += component.points;
    defenseScore.components.push(component);
  });

  for (const score of teamScores) {
    score.points = round(score.points);
    score.oldAudit = buildOldDstAudit({
      team: score.team,
      opponent: score.opponent,
      teamInfo,
      drives,
      teamsByAbbr,
      oldScoring
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
    teamScores
  };
}

function buildOldDstAudit({ team, opponent, teamInfo, drives, teamsByAbbr, oldScoring }) {
  const opponentInfo = teamInfo.find((candidate) => candidate.abbreviation === opponent) || {};
  const pointsAllowed = Number(opponentInfo.score || 0);
  const components = [];
  const add = (kind, label, count, unit, description = "") => {
    if (!count || !unit) return;
    components.push({
      kind,
      label,
      count,
      unit,
      points: round(count * unit),
      description
    });
  };

  const pointsAllowedPoints = pointsAllowedComponent(pointsAllowed, oldScoring);
  components.push({
    kind: "points_allowed",
    label: `Points allowed: ${pointsAllowed}`,
    count: 1,
    unit: pointsAllowedPoints,
    points: pointsAllowedPoints,
    description: `${opponent} scoreboard points against ${team}.`
  });

  const counts = {
    sacks: 0,
    interceptions: 0,
    forcedFumbles: 0,
    fumbleRecoveries: 0,
    touchdowns: 0,
    safeties: 0,
    blockedKicks: 0
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
    components
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

function scoreDrive({ drive, nextDrive, offense, defense, teamsByAbbr, sequence }) {
  const result = String(drive.result || drive.shortDisplayResult || drive.displayResult || "").toUpperCase();
  const displayResult = drive.displayResult || drive.shortDisplayResult || drive.result || "Drive";
  const base = {
    sequence,
    offense,
    defense,
    result: displayResult,
    description: drive.description || "",
    start: drive.start?.text || "",
    end: drive.end?.text || "",
    period: drive.end?.period?.number || drive.start?.period?.number || null,
    clock: drive.end?.clock?.displayValue || drive.start?.clock?.displayValue || "",
    source: "ESPN"
  };
  const dstTouchdown = hasDstTouchdown(drive, defense, teamsByAbbr);

  if (result.includes("TD") || result.includes("TOUCHDOWN")) {
    return {
      ...base,
      kind: dstTouchdown ? "dst_touchdown" : "touchdown_allowed",
      label: dstTouchdown ? "D/ST touchdown" : "TD allowed",
      points: dstTouchdown ? SCORING.dstTouchdown : SCORING.touchdownAllowed
    };
  }

  if (result === "FG" || result.includes("FIELD GOAL")) {
    return {
      ...base,
      kind: "field_goal_allowed",
      label: "FG allowed",
      points: SCORING.fieldGoalAllowed
    };
  }

  if (result.includes("SAFETY")) {
    const bucket = takeoverBucket(nextDrive, offense, defense, teamsByAbbr);
    return {
      ...base,
      kind: "safety",
      label: bucket ? `Safety + ${bucket.label}` : "Safety",
      points: round(SCORING.safety + (bucket?.points || 0)),
      bucket: bucket?.name || null,
      takeover: bucket?.takeover || ""
    };
  }

  if (NO_BUCKET_RESULTS.has(result) || SCORING_RESULTS.has(result)) {
    return null;
  }

  const bucket = takeoverBucket(nextDrive, offense, defense, teamsByAbbr);
  if (!bucket && !dstTouchdown) return null;

  return {
    ...base,
    kind: dstTouchdown ? "dst_touchdown" : "takeover",
    label: dstTouchdown && bucket ? `D/ST touchdown + ${bucket.label}` : dstTouchdown ? "D/ST touchdown" : bucket.label,
    points: round((dstTouchdown ? SCORING.dstTouchdown : 0) + (bucket?.points || 0)),
    bucket: bucket?.name || null,
    takeover: bucket?.takeover || ""
  };
}

function hasDstTouchdown(drive, defense, teamsByAbbr) {
  const defenseId = teamsByAbbr.get(defense)?.id;
  if (!defenseId || !Array.isArray(drive.plays)) return false;
  return drive.plays.some((play) => {
    if (!play?.scoringPlay || Number(play.scoreValue || 0) < 6) return false;
    if (String(play.end?.team?.id || "") === String(defenseId)) return true;
    const text = `${play.type?.text || ""} ${play.text || ""}`.toUpperCase();
    return /INTERCEPTION|FUMBLE|BLOCK|PUNT|KICKOFF/.test(text) && /TOUCHDOWN| TD\b/.test(text);
  });
}

function takeoverBucket(nextDrive, offense, defense, teamsByAbbr) {
  const nextOffense = nextDrive?.team?.abbreviation || "";
  if (!nextDrive || nextOffense !== defense) return null;

  const nextStart = nextDrive.start || {};
  const takeoverText = nextStart.text || "";
  const y100ForOriginalOffense = yardline100(takeoverText, offense, defense);
  if (!Number.isFinite(y100ForOriginalOffense)) return null;
  const defenseTeam = teamsByAbbr.get(defense);
  const offenseTeam = teamsByAbbr.get(offense);

  if (y100ForOriginalOffense < 20) {
    return {
      name: "defense_lt_20",
      label: `${defense} takes over inside own 20`,
      points: SCORING.defenseLt20,
      takeover: takeoverText,
      color: defenseTeam?.color
    };
  }
  if (y100ForOriginalOffense <= 50) {
    return {
      name: "defense_20_to_50",
      label: `${defense} takes over own 20-50`,
      points: SCORING.defense20To50,
      takeover: takeoverText,
      color: defenseTeam?.color
    };
  }
  if (y100ForOriginalOffense <= 80) {
    return {
      name: "offense_49_to_20",
      label: `${defense} takes over at ${offense} 49-20`,
      points: SCORING.offense49To20,
      takeover: takeoverText,
      color: offenseTeam?.color
    };
  }
  return {
    name: "offense_lt_20",
    label: `${defense} takes over inside ${offense} 20`,
    points: SCORING.offenseLt20,
    takeover: takeoverText,
    color: offenseTeam?.color
  };
}

function yardline100(text, offense, defense) {
  const clean = String(text || "").trim();
  if (!clean) return null;
  if (clean === "50" || clean.startsWith("MID ")) return 50;
  const match = clean.match(/^([A-Z]{2,3})\s+(\d{1,2})$/);
  if (!match) return null;
  const [, side, yardText] = match;
  const yard = Number(yardText);
  if (!Number.isFinite(yard)) return null;
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
    end: drive.end?.text || ""
  };
}

export function round(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
