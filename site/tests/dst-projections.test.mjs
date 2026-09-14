import test from "node:test";
import assert from "node:assert/strict";
import { leagueProjectionPoints, sleeperDstProjection, teamProjectionPoints } from "../lib/dst/projections.js";

test("team projections use the latest starters and Sleeper's published DST baseline", () => {
  const starters = [
    { playerId: "qb", score: 30, projectedScore: leagueProjectionPoints({ pass_yd: 250 }, { pass_yd: 0.04 }) },
    { playerId: "rb", score: 4, projectedScore: 12.34 },
    { playerId: "BAL", score: -2, projectedScore: sleeperDstProjection({ pts_std: 6.2, pts_ppr: 100 }) },
    { playerId: "0", projectedScore: null },
  ];
  assert.equal(teamProjectionPoints(starters), 28.54);
  assert.equal(starters[2].score, -2);
  assert.equal(sleeperDstProjection({ pts_std: 0 }), 0);
  assert.equal(sleeperDstProjection({ pts_ppr: 8 }), null);
});

test("team projection preserves zero and negative values, and never treats missing data as zero", () => {
  assert.equal(teamProjectionPoints([{ playerId: "qb", projectedScore: 0 }, { playerId: "BAL", projectedScore: -1.5 }]), -1.5);
  for (const missing of [null, undefined, NaN, ""]) {
    assert.equal(teamProjectionPoints([{ playerId: "qb", projectedScore: 20 }, { playerId: "BAL", projectedScore: missing }]), null);
  }
  assert.equal(teamProjectionPoints([]), null);
});

test("calculates quarterback projections from league scoring instead of generic points", () => {
  const projection = {
    pts_std: 21.92,
    pass_yd: 219.62,
    pass_td: 1.48,
    pass_int: 0.65,
    pass_2pt: 0.09,
    rush_yd: 27.47,
    rush_td: 0.54,
    rush_2pt: 0.03,
    fum_lost: 0.17,
    bonus_rush_td_qb: 0.54,
  };
  const scoring = {
    pass_yd: 0.04,
    pass_td: 4,
    pass_int: -1,
    pass_2pt: 2,
    rush_yd: 0.1,
    rush_td: 6,
    rush_2pt: 2,
    fum_lost: -2,
    bonus_rush_td_qb: 0,
  };
  assert.equal(leagueProjectionPoints(projection, scoring), 19.94);
});

test("includes league-specific tight end premium scoring", () => {
  const projection = {
    pts_std: 9.44,
    rec_yd: 67.1,
    rec_td: 0.43,
    rec_2pt: 0.02,
    rush_yd: 0.9,
    rush_td: 0.01,
    fum_lost: 0.03,
    bonus_rec_te: 6.59,
  };
  const scoring = {
    rec: 0,
    rec_yd: 0.1,
    rec_td: 6,
    rec_2pt: 2,
    rush_yd: 0.1,
    rush_td: 6,
    fum_lost: -2,
    bonus_rec_te: 0.5,
  };
  assert.equal(leagueProjectionPoints(projection, scoring), 12.71);
});

test("applies league kicker categories and falls back when raw stats are absent", () => {
  const kicker = {
    fgm_20_29: 0.38,
    fgm_30_39: 0.57,
    fgm_40_49: 0.51,
    fgmiss_30_39: 0.06,
    fgmiss_40_49: 0.06,
    xpm: 2.55,
    xpmiss: 0.13,
  };
  const scoring = {
    fgm_20_29: 3,
    fgm_30_39: 3,
    fgm_40_49: 4,
    fgmiss_30_39: -2,
    fgmiss_40_49: -1,
    xpm: 1,
    xpmiss: -2,
  };
  assert.equal(leagueProjectionPoints(kicker, scoring), 7);
  assert.equal(leagueProjectionPoints({ pts_std: 4 }, { rec: 0 }), 4);
});
