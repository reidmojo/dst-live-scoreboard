import { round } from './scoring.js';

// Pinned to Sleeper's NFL preset, verified in its public app on 2026-09-09.
// See docs/SLEEPER-DEFAULT-DST.md and the captured preset fixture. These are
// independent of league settings and of Sleeper's precomputed pts_std values.
export const SLEEPER_DEFAULT_SCORING_VERSION = 'sleeper-default-2026-09-09.1';
export const SLEEPER_DEFAULT_DST_SETTINGS = Object.freeze({
  sack: 1, int: 2, fum_rec: 2, ff: 1, safe: 2, blk_kick: 2,
  def_td: 6, def_st_td: 6, def_st_ff: 1, def_st_fum_rec: 1,
  pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4,
  pts_allow_14_20: 1, pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4,
});
const LABELS = {
  sack: 'Sacks', int: 'Interceptions', fum_rec: 'Fumble recoveries', ff: 'Forced fumbles',
  safe: 'Safeties', blk_kick: 'Blocked kicks', def_td: 'Defensive touchdowns',
  def_st_td: 'Special teams touchdowns', def_st_ff: 'Special teams forced fumbles',
  def_st_fum_rec: 'Special teams fumble recoveries',
};
const TIERS = [
  [0, 'pts_allow_0', '0'], [6, 'pts_allow_1_6', '1–6'], [13, 'pts_allow_7_13', '7–13'],
  [20, 'pts_allow_14_20', '14–20'], [27, 'pts_allow_21_27', '21–27'],
  [34, 'pts_allow_28_34', '28–34'], [Infinity, 'pts_allow_35p', '35+'],
];
const unavailable = (message) => ({ total: null, components: [], status: 'unavailable', issues: [message] });
const validCount = (value) => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
  && Number.isFinite(Number(value)) && Number(value) >= 0;

export function sleeperDefaultDstAudit(stats, games = []) {
  const started = games.filter((game) => game.statusState === 'in' || game.statusState === 'post' || game.completed);
  if (!started.length) return { total: 0, components: [], status: 'not_started', issues: [] };
  if (started.length > 1) return unavailable('Sleeper default comparison needs per-game stats for multiple games in one week.');
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return unavailable('Sleeper D/ST stats have not arrived for this game.');

  // Missing event counts are zero in Sleeper's sparse stat payloads. A missing
  // points-allowed measure is not a shutout: require its raw stat or one tier.
  const tierFlags = TIERS.filter(([, key]) => Number(stats[key]) > 0);
  if (TIERS.some(([, key]) => stats[key] !== undefined && (!validCount(stats[key]) || ![0, 1].includes(Number(stats[key]))))
    || tierFlags.length > 1) return unavailable('Sleeper points-allowed tiers are incomplete or conflicting.');
  let tier;
  if (stats.pts_allow !== undefined) {
    if (!validCount(stats.pts_allow) || !Number.isInteger(Number(stats.pts_allow))) return unavailable('Sleeper points allowed is invalid.');
    tier = TIERS.find(([max]) => Number(stats.pts_allow) <= max);
    if (tierFlags.length && tierFlags[0][1] !== tier[1]) return unavailable('Sleeper points allowed and its scoring tier disagree.');
  } else {
    tier = tierFlags[0];
    if (!tier) return unavailable('Sleeper points-allowed stats have not arrived for this game.');
  }

  const components = [];
  for (const [key, label] of Object.entries(LABELS)) {
    if (stats[key] !== undefined && !validCount(stats[key])) return unavailable(`Sleeper ${label.toLowerCase()} stat is invalid.`);
    const count = Number(stats[key] || 0), unit = SLEEPER_DEFAULT_DST_SETTINGS[key];
    if (count) components.push({ kind: key, label, count, unit, points: round(count * unit),
      description: 'Sleeper weekly stat × fixed Sleeper default rate.' });
  }
  const [, key, range] = tier, unit = SLEEPER_DEFAULT_DST_SETTINGS[key];
  components.push({ kind: key, label: `Points allowed: ${range}`, count: 1, unit, points: unit,
    description: stats.pts_allow === undefined ? 'Sleeper-reported points-allowed tier.' : `${Number(stats.pts_allow)} points allowed under Sleeper’s D/ST definition.` });
  return { total: round(components.reduce((sum, row) => sum + row.points, 0)), components, status: 'available', issues: [] };
}
