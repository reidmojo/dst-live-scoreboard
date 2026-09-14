import assert from "node:assert/strict";
import test from "node:test";
import { scoreWeekFromEspn } from "../lib/dst/scoring.js";

function event(id = "game-1") {
  return {
    id,
    date: "2025-09-07T17:00:00Z",
    status: { type: { state: "post", description: "Final" } },
    competitions: [{
      competitors: [
        { id: "1", team: { id: "1", abbreviation: "BAL" }, score: 0 },
        { id: "2", team: { id: "2", abbreviation: "IND" }, score: 0 },
      ],
    }],
  };
}

test("awards the original own-field takeover bucket", () => {
  const game = event();
  const summaries = new Map([[game.id, {
    drives: { previous: [
      { team: { id: "2", abbreviation: "IND" }, result: "PUNT", displayResult: "Punt", start: { text: "IND 25" }, end: { text: "BAL 45" }, plays: [] },
      { team: { id: "1", abbreviation: "BAL" }, result: "END OF GAME", start: { text: "BAL 10" }, plays: [] },
    ] },
  }]]);

  const scored = scoreWeekFromEspn([game], summaries);
  assert.equal(scored.dstScores.BAL.points, 1);
  assert.equal(scored.dstScores.BAL.components[0].kind, "takeover");
});

test("charges an offensive touchdown to the defending DST", () => {
  const game = event("game-2");
  const summaries = new Map([[game.id, {
    drives: { previous: [
      { team: { id: "2", abbreviation: "IND" }, result: "TD", displayResult: "Touchdown", plays: [{ scoringPlay: true, end: { team: { id: "2" } }, text: "Offensive touchdown" }] },
      { team: { id: "1", abbreviation: "BAL" }, result: "END OF GAME", start: { text: "BAL 25" }, plays: [] },
    ] },
  }]]);

  const scored = scoreWeekFromEspn([game], summaries);
  assert.equal(scored.dstScores.BAL.points, -1);
  assert.equal(scored.dstScores.BAL.components[0].kind, "touchdown_allowed");
});
