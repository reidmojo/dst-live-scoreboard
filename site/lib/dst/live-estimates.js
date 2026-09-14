// Independently expressed from Sleeper's public web client's NFL model.
// See docs/dst-live-estimates.md for provenance, parity checks and guardrails.
export const LIVE_ESTIMATE_VERSION = "sleeper-style-2026-09-13.1";
export const LIVE_ESTIMATE_NOTE = "Sleeper-style estimate using our actual scores. D/ST uses Sleeper’s standard projection as a temporary baseline; this is not an official Sleeper win probability.";

const number = value => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function sleeperLiveProjection(actual, baseline, secondsRemaining, isDefense = false) {
  actual = number(actual);
  baseline = number(baseline);
  secondsRemaining = number(secondsRemaining);
  if (secondsRemaining == null) return null;
  const remaining = clamp(secondsRemaining, 0, 3600) / 3600;
  if (remaining === 0) return actual;
  if (remaining === 1) return baseline;
  if (actual == null || baseline == null) return null;
  const elapsedMinutes = 60 * (1 - remaining);
  const pace = actual + actual / elapsedMinutes * (60 * remaining) * remaining;
  const paceWeight = isDefense ? 0.25 + 0.05 * remaining : 1;
  const anchor = Math.max(baseline, actual);
  const target = Math.max(pace * paceWeight, actual);
  return anchor + (1 - remaining) * (target - anchor);
}

export function nflProjectionClock(game) {
  if (!game) return { state: "unavailable", remaining: null };
  const status = String(game.status || "");
  if (/cancel|postpon|suspend/i.test(status)) return { state: "unavailable", remaining: null };
  if (game.completed === true && game.statusState === "post") return { state: "final", remaining: 0 };
  if (game.statusState === "pre") return { state: "pregame", remaining: 3600 };
  if (game.statusState !== "in") return { state: "unavailable", remaining: null };
  if (/half/i.test(status)) return { state: "live", remaining: 1800 };
  const period = Number(game.period);
  // Sleeper uses zero regulation time remaining in OT. It is not a final result.
  if (period > 4 || /overtime/i.test(status)) return { state: "live", remaining: 0 };
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(String(game.clock || ""));
  if (!clock || period < 1 || period > 4 || !Number.isInteger(period)) return { state: "unavailable", remaining: null };
  const seconds = Number(clock[1]) * 60 + Number(clock[2]);
  if (seconds > 900) return { state: "unavailable", remaining: null };
  return { state: "live", remaining: (4 - period) * 900 + seconds };
}

export function withLiveProjection(player, game, { bye = false } = {}) {
  const clock = player.playerId === "0" || bye ? { state: "final", remaining: 0 } : nflProjectionClock(game);
  return { ...player, liveProjectedScore: sleeperLiveProjection(player.score, player.projectedScore, clock.remaining, player.isDefense),
    projectionStatus: clock.state, projectionSecondsRemaining: clock.remaining };
}

export function displayedProjection(player) {
  return Object.hasOwn(player, "liveProjectedScore") ? player.liveProjectedScore : player.projectedScore;
}

// Player-card reference only. Team totals and win odds must keep using the live
// estimate (which equals actual points after completion), never this baseline.
export function playerDisplayProjection(player, final = false) {
  return final ? player.projectedScore : displayedProjection(player);
}

export function teamLiveEstimate(team) {
  const starters = (team?.starters || []).filter(player => player.playerId !== "0");
  const actual = number(team?.projectedCustomTotal);
  const unavailable = { actual, projected: null, complete: false };
  if (!starters.length || actual == null) return unavailable;
  let projected = actual;
  for (const player of starters) {
    const score = number(player.score), estimate = number(displayedProjection(player));
    if (score == null || estimate == null) return unavailable;
    // Start from the authoritative team total to retain commissioner adjustments.
    projected += estimate - score;
  }
  return { actual, projected, complete: !team.scoringProvisional && starters.every(player => player.projectionStatus === "final") };
}

// Normal CDF via the standard error-function approximation (absolute error < 1e-7).
function normalCdf(z) {
  if (z === 0) return 0.5;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + Math.sign(z) * erf);
}

function sleeperVariance(actual, projected) {
  const denominator = 1 + 10 * (1 - actual / projected);
  const variance = (actual - projected) ** 2 / denominator;
  // The original model is undefined for some zero/negative totals. Do not invent odds.
  if (projected === 0) return actual === 0 ? 0.1 : null;
  if (!Number.isFinite(variance) || variance < 0 || denominator <= 0) return null;
  return variance || 0.1;
}

export function sleeperStyleWinProbability(left, right) {
  if (![left?.actual, left?.projected, right?.actual, right?.projected].every(value => number(value) != null)) return null;
  if (left.complete && right.complete) {
    const difference = Math.round(left.actual * 100) - Math.round(right.actual * 100);
    return difference === 0 ? { left: 0.5, right: 0.5, tied: true, final: true }
      : { left: difference > 0 ? 1 : 0, right: difference > 0 ? 0 : 1, tied: false, final: true };
  }
  const leftVariance = sleeperVariance(left.actual, left.projected);
  const rightVariance = sleeperVariance(right.actual, right.projected);
  if (leftVariance == null || rightVariance == null) return null;
  const probability = clamp(normalCdf((left.projected - right.projected) / Math.sqrt(leftVariance + rightVariance)), 0.01, 0.99);
  return { left: probability, right: 1 - probability, tied: false, final: false };
}

export function matchupWinEstimate(teams) {
  return teams?.length === 2 ? sleeperStyleWinProbability(teamLiveEstimate(teams[0]), teamLiveEstimate(teams[1])) : null;
}
