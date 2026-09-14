import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as presentation from "../lib/dst/presentation.js";
import * as liveEstimates from "../lib/dst/live-estimates.js";
import * as health from "../lib/dst/health.js";

const require = createRequire(import.meta.url);
const cssModule = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
const source = await readFile(new URL("../app/fantasy_football/dst/games-view.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
runInNewContext(compiled, { exports, require: name => name.endsWith(".css") ? cssModule : name.endsWith("presentation.js") ? presentation : name.endsWith("live-estimates.js") ? liveEstimates : require(name), Intl, Date, Set, Map });

const trackerSource = await readFile(new URL("../app/fantasy_football/dst/dst-tracker.tsx", import.meta.url), "utf8");
const trackerCompiled = ts.transpileModule(`${trackerSource}\nexport { MatchupCard, PlayerCard, ScoreNotices };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const tracker = {};
runInNewContext(trackerCompiled, { exports: tracker, require: name => name.endsWith(".css") ? cssModule : name.endsWith("presentation.js") ? presentation : name.endsWith("live-estimates.js") ? liveEstimates : name.endsWith("health.js") ? health : name === "./games-view" ? exports : require(name), Intl, Date, Set, Map });

const game = { id: "one", date: "2026-09-13T00:20:00Z", status: "Scheduled", statusState: "pre", period: 0, clock: "",
  teams: [{ abbreviation: "PHI", homeAway: "home", displayName: "Philadelphia Eagles", score: 0 }, { abbreviation: "WAS", homeAway: "away", displayName: "Washington Commanders", score: 0 }],
  positionGroups: [{ position: "QB", away: [], home: [{ playerId: "qb", name: "Test Quarterback", shortName: "T. Quarterback", position: "QB", team: "PHI", owner: "owner", score: 4, projectedScore: 12.5, injuryStatus: "", isDefense: false, compactStats: [], components: [] }] }],
};
test("game list renders local kickoff days in order and makes each game an accessible action", () => {
  const later = { ...game, id: "two", date: "2026-09-14T17:00:00Z" };
  const html = renderToStaticMarkup(React.createElement(exports.GameList, { games: [later, game], timeZone: "America/Los_Angeles", onOpen() {} }));
  assert.ok(html.indexOf("Saturday, Sep 12") < html.indexOf("Monday, Sep 14"));
  assert.match(html, /5:20 PM PDT/);
  assert.match(html, /Washington Commanders at Philadelphia Eagles/);
  assert.equal((html.match(/<button /g) || []).length, 2);
  assert.match(html, /class="gameCardTeam" data-side="away"/);
  assert.match(html, /class="gameCardTeam" data-side="home"/);
});
test("pregame detail renders mirrored groups, owner handles and projections with blank actuals", () => {
  const html = renderToStaticMarkup(React.createElement(exports.GameDetail, { game, timeZone: "America/New_York", myManager: "owner", week: 1 }));
  assert.doesNotMatch(html, /4\.00 fantasy points/);
  assert.match(html, /<strong aria-hidden="true"><\/strong>/);
  assert.match(html, /Proj\. 12\.50/);
  assert.match(html, /@owner/);
  assert.match(html, /data-side="home"/);
  assert.match(html, /Scoring begins at kickoff/);
  assert.doesNotMatch(html, /View this game’s drives/);
});

test("shared matchup summary renders actual then projected totals without CUSTOM badges in list and detail", () => {
  const team = { rosterId: 1, manager: "owner", teamName: "Test team", projectedCustomTotal: 4, sleeperDefaultTotal: 7,
    wins: 0, losses: 0, ties: 0, starters: [{ playerId: "qb", score: 4, projectedScore: 12.5 }, { playerId: "BAL", score: 0, projectedScore: 6.5 }] };
  for (const onOpen of [undefined, () => {}]) {
    const html = renderToStaticMarkup(React.createElement(tracker.MatchupCard, { matchup: { id: "1", teams: [team, { ...team, rosterId: 2 }] }, isMine: true, onOpen }));
    assert.equal((html.match(/Proj\. 19\.00/g) || []).length, 2);
    assert.match(html, /<strong>4\.00<\/strong><span[^>]+>Proj\. 19\.00<\/span>/);
    assert.doesNotMatch(html, />custom<|>CUSTOM</);
  }
});

test("matchup odds are mirrored and Games prefers live projections without replacing actual scores", () => {
  const makeTeam = (id, projection) => ({ rosterId: id, manager: `owner${id}`, teamName: `Team ${id}`, projectedCustomTotal: 0,
    wins: 0, losses: 0, ties: 0, starters: [{ playerId: `qb${id}`, score: 0, projectedScore: projection, liveProjectedScore: projection, projectionStatus: "pregame" }] });
  const teams = [makeTeam(1, 123.23), makeTeam(2, 108.2)];
  const html = renderToStaticMarkup(React.createElement(tracker.MatchupCard, { matchup: { id: "1", teams }, isMine: true }));
  assert.match(html, /width:62%/);
  assert.match(html, /width:38%/);
  assert.match(html, /Estimated win chance: 62%/);
  const liveGame = structuredClone(game);
  liveGame.statusState = "in";
  liveGame.positionGroups[0].home[0].liveProjectedScore = 9;
  const detail = renderToStaticMarkup(React.createElement(exports.GameDetail, { game: liveGame, timeZone: "UTC", myManager: "owner", week: 1 }));
  assert.match(detail, /Proj\. 9\.00/);
  assert.match(detail, /4\.00 fantasy points/);
  assert.match(detail, /Pregame projection: 12\.50/);
});

test("both player views distinguish upcoming, live zero, overtime and final references", () => {
  for (const isDefense of [false, true]) {
    for (const [state, completed, actual, expectedProjection] of [["pre", false, 0, "12.50"], ["in", false, 0, "9.00"], ["in", false, 4, "9.00"], ["post", true, 4, "12.50"]]) {
      const player = { ...game.positionGroups[0].home[0], playerId: isDefense ? "PHI" : "qb", isDefense,
        score: actual, sleeperDefaultScore: 0, defaultScore: 0, projectedScore: 12.5, liveProjectedScore: state === "pre" ? 12.5 : completed ? actual : 9,
        gameStatusState: state, gameCompleted: completed, gameStatus: completed ? "Final" : "", gamePeriod: 5, gameClock: "8:30",
        gameStart: game.date, slot: "QB", opponent: "WAS", statsLine: "", compactStats: [{ label: "YDS", value: "100" }] };
      const localGame = { ...game, statusState: state, completed, period: 5, positionGroups: [{ position: isDefense ? "DEF" : "QB", away: [], home: [player] }] };
      const views = [
        renderToStaticMarkup(React.createElement(exports.GameDetail, { game: localGame, timeZone: "UTC", myManager: "owner", week: 1 })),
        renderToStaticMarkup(React.createElement(tracker.PlayerCard, { player, team: {}, side: "right", homeAway: "home", timeZone: "UTC", onSelectDefense() {} })),
      ];
      for (const html of views) {
        assert.ok(html.includes(`Proj. ${expectedProjection}`));
        if (state === "pre") {
          assert.match(html, /<strong aria-hidden="true"><\/strong>/);
          assert.doesNotMatch(html, /0\.00 fantasy points|Default 0\.00/);
        } else assert.ok(html.includes(`<strong>${actual.toFixed(2)}</strong>`));
        if (completed) {
          assert.match(html, /data-completed="true"/);
          assert.match(html, /Final/);
          assert.match(html, /reference only; team estimates use the final score/);
        } else assert.doesNotMatch(html, /data-completed="true"/);
      }
    }
  }
});

test("scoring notices are compact and matchup-specific while actual update failures stay prominent", () => {
  const data = { generatedAt: "2026-09-14T01:50:11Z", health: { stale: true, warnings: [
    { label: "CHI drive scoring", message: "Possession awaiting confirmation" },
    { kind: "scoring", teams: ["CIN"], label: "CIN drive scoring", message: "Return awaiting confirmation" },
  ] } };
  const render = (teams, error = "") => renderToStaticMarkup(React.createElement(tracker.ScoreNotices, { data, teams, error }));
  assert.equal(render(["PHI", "BAL"]), "");
  const all = render();
  assert.match(all, /<details/);
  assert.match(all, /D\/ST scoring checks \(2\) · CHI, CIN/);
  assert.doesNotMatch(all, / open|role="status"|Score update interrupted|delayed/);
  assert.match(render(["CHI"]), /D\/ST scoring checks \(1\) · CHI/);
  assert.doesNotMatch(render(["CHI"]), /CIN/);
  assert.match(render(["PHI"], "Request timed out"), /role="status"/);
  assert.match(render(["PHI"], "Request timed out"), /Retrying automatically/);
});

test("populated matchup stat lines keep each value and label together without truncating the row", async () => {
  const player = { ...game.positionGroups[0].home[0], score: 24.72, projectedScore: 20.85, gameStatusState: "post", gameCompleted: true,
    statsLine: "14/25 CMP, 203 YD, 3 TD, 7 CAR, 46 YD", opponent: "WAS", slot: "QB" };
  for (const side of ["left", "right"]) {
    const html = renderToStaticMarkup(React.createElement(tracker.PlayerCard, { player, team: {}, side, homeAway: "home", timeZone: "UTC", onSelectDefense() {} }));
    assert.match(html, /class="playerStat">7 CAR<\/span>/);
    assert.match(html, /class="playerStat">14\/25 CMP<\/span>/);
    assert.match(html, /class="playerStat">46 YD<\/span>/);
  }
  const css = await readFile(new URL("../app/fantasy_football/dst/dst.module.css", import.meta.url), "utf8");
  assert.match(css, /\.playerStat\s*{\s*white-space: nowrap/);
  assert.match(css, /grid-template-rows: subgrid/);
  assert.match(css, /\.playerScore, \.defenseCard \.playerScore { grid-column: 1; grid-row: 2/);
});

test("portrait score blocks face the center without changing desktop or landscape layouts", async () => {
  const css = await readFile(new URL("../app/fantasy_football/dst/dst.module.css", import.meta.url), "utf8");
  assert.match(css, /\.scoreBlock, \.right \.scoreBlock {[^}]*width: max-content;[^}]*justify-self: start;[^}]*justify-items: center/);
  assert.match(css, /\.right \.scoreBlock { justify-self: end; }/);
  assert.match(css, /\.playerScore, \.playerRight \.playerScore {[^}]*width: max-content;[^}]*justify-self: start;[^}]*justify-items: center/);
  assert.match(css, /\.playerRight \.playerScore { justify-self: end; }/);
  const portrait = css.slice(css.indexOf("@media (max-width: 680px) and (orientation: portrait)"));
  assert.match(portrait, /^@media \(max-width: 680px\) and \(orientation: portrait\) \{\s*\.scoreBlock, \.playerScore \{ justify-self: end; \}\s*\.right \.scoreBlock, \.playerRight \.playerScore \{ justify-self: start; \}\s*\}/);
  assert.ok(css.indexOf(portrait) > css.lastIndexOf(".playerRight .playerScore { justify-self: end; }"));
  assert.match(css, /\.gameCardTeam\[data-side="home"\] {[^}]*grid-template-areas: "score identity logo"; text-align: right/);
  assert.match(css, /\.gameCardTeam {[^}]*grid-template-areas: "logo identity score"/);
  assert.match(css, /--game-card-logo-size: 32px/);
});
