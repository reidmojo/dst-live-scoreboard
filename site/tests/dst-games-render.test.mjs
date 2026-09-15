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
import * as loadingPolicy from "../lib/dst/loading-policy.js";

const require = createRequire(import.meta.url);
const cssModule = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
const source = await readFile(new URL("../app/fantasy_football/dst/games-view.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
runInNewContext(compiled, { exports, require: name => name.endsWith(".css") ? cssModule : name.endsWith("presentation.js") ? presentation : name.endsWith("live-estimates.js") ? liveEstimates : require(name), Intl, Date, Set, Map });

const trackerSource = await readFile(new URL("../app/fantasy_football/dst/dst-tracker.tsx", import.meta.url), "utf8");
const trackerCompiled = ts.transpileModule(`${trackerSource}\nexport { MatchupCard, PlayerCard, ScoreNotices, StarterRows };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const tracker = {};
runInNewContext(trackerCompiled, { exports: tracker, require: name => name.endsWith(".css") ? cssModule : name.endsWith("presentation.js") ? presentation : name.endsWith("live-estimates.js") ? liveEstimates : name.endsWith("health.js") ? health : name.endsWith("loading-policy.js") ? loadingPolicy : name === "./games-view" ? exports : require(name), Intl, Date, Set, Map });

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

test("Games compact stat lines shorten cached labels but scoring breakdowns stay descriptive", () => {
  const played = structuredClone(game);
  played.statusState = "post"; played.completed = true;
  const player = played.positionGroups[0].home[0];
  player.compactStats = [{ value: "14/25", label: "CMP" }, { value: "203", label: "PASS YD" }, { value: "3", label: "PASS TD" },
    { value: "7", label: "CAR" }, { value: "46", label: "RUSH YD" }, { value: "1", label: "RUSH TD" },
    { value: "2/3", label: "REC" }, { value: "20", label: "REC YD" }, { value: "1", label: "REC TD" }];
  player.components = [{ key: "pass_yd", label: "Passing yards", points: 8.12 }];
  const html = renderToStaticMarkup(React.createElement(exports.GameDetail, { game: played, timeZone: "UTC", myManager: "owner", week: 1 }));
  assert.doesNotMatch(html, /(?:PASS|RUSH|REC) (?:YD|TD)/);
  assert.equal((html.match(/<small>YD<\/small>/g) || []).length, 3);
  assert.equal((html.match(/<small>TD<\/small>/g) || []).length, 3);
  assert.match(html, /14\/25<\/b> <small>CMP/);
  assert.match(html, /Passing yards/);
});

test("both matchup columns link whole player cards to their selected week, with a separate D\/ST audit", () => {
  for (const side of ["left", "right"]) for (const isDefense of [false, true]) {
    const player = { ...game.positionGroups[0].home[0], playerId: isDefense ? "PHI" : "qb", isDefense, slot: isDefense ? "DEF" : "QB",
      gameStatusState: "post", gameCompleted: true, statsLine: "14/25 CMP, 203 YD" };
    let opened, audited;
    const props = { player, team: { rosterId: 1 }, side, homeAway: "home", nflGames: [game], selected: { season: "2025", week: 3 }, timeZone: "UTC",
      onOpenGame: (selected, trigger) => { opened = { selected, trigger }; }, onSelectDefense: (team, trigger) => { audited = { team, trigger }; } };
    const element = tracker.PlayerCard(props);
    const html = renderToStaticMarkup(element);
    assert.match(html, /href="\/fantasy_football\/dst\?season=2025&amp;week=3&amp;view=games&amp;game=one"/);
    assert.match(html, /View PHI vs WAS game, Week 3/);
    const link = element.props.children.find(child => child?.type === "a");
    let prevented = false;
    const target = { id: "trigger" };
    link.props.onClick({ button: 0, metaKey: true, preventDefault() { prevented = true; } });
    assert.equal(opened, undefined); assert.equal(prevented, false);
    link.props.onClick({ button: 0, currentTarget: target, preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(opened.selected.id, "one"); assert.equal(opened.trigger, target);
    assert.equal(audited, undefined);
    if (isDefense) {
      assert.match(html, /aria-controls="dst-scoring-audit"/);
      assert.doesNotMatch(html, /<a[^>]*>[^]*<button/);
    }
  }
  const bye = { ...game.positionGroups[0].home[0], playerId: "bye", team: "BAL" };
  const html = renderToStaticMarkup(React.createElement(tracker.PlayerCard, { player: bye, team: {}, side: "left", homeAway: "", nflGames: [game], selected: { season: "2026", week: 1 }, timeZone: "UTC", onSelectDefense() {} }));
  assert.doesNotMatch(html, /<a /);
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

test("background refresh labels saved scores without falsely reporting an outage or hiding audit warnings", () => {
  const html = renderToStaticMarkup(React.createElement(tracker.ScoreNotices, { error: "", data: {
    generatedAt: "2026-09-14T01:50:11Z", health: { stale: true, refreshing: true, warnings: [
      { kind: "scoring", teams: ["CHI"], label: "CHI drive scoring", message: "Possession awaiting confirmation" },
    ] },
  } }));
  assert.match(html, /Showing saved scores from/);
  assert.match(html, /Checking for updates/);
  assert.match(html, /D\/ST scoring checks/);
  assert.doesNotMatch(html, /Score update interrupted/);
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
  assert.match(css, /\.playerTop { grid-column: 1; grid-row: 1; }/);
  assert.match(css, /\.playerGame > time, \.playerGame > strong { grid-column: 1; grid-row: 2; }/);
});

test("portrait team totals face the center and player names share a mirrored row with their score", async () => {
  const css = await readFile(new URL("../app/fantasy_football/dst/dst.module.css", import.meta.url), "utf8");
  assert.match(css, /\.scoreBlock, \.right \.scoreBlock {[^}]*width: max-content;[^}]*justify-self: start;[^}]*justify-items: center/);
  assert.match(css, /\.right \.scoreBlock { justify-self: end; }/);
  assert.match(css, /\.playerTop, \.playerRight \.playerTop {[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.playerRight \.playerTop { grid-template-columns: auto minmax\(0, 1fr\); }/);
  assert.match(css, /\.playerMain { display: block; grid-column: 1; grid-row: 1; }/);
  assert.match(css, /\.playerRight \.playerMain { grid-column: 2; }/);
  assert.match(css, /\.playerScore, \.playerRight \.playerScore {[^}]*grid-column: 2; grid-row: 1;[^}]*width: max-content;[^}]*justify-self: end;/);
  assert.match(css, /\.playerRight \.playerScore { grid-column: 1; justify-self: start; }/);
  assert.match(css, /\.playerMain strong {[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  assert.match(css, /--dst-player-name-size: 1\.0625rem;/);
  for (const selector of [".playerMain strong", ".nflPlayerIdentity > strong"]) {
    const nameRules = [...css.matchAll(new RegExp(`${selector.replaceAll(".", "\\.")} \\{([^}]+)\\}`, "g"))];
    assert.equal(nameRules.length, 1, "player names must not shrink at mobile breakpoints");
    assert.match(nameRules[0][1], /font-size: var\(--dst-player-name-size\);/);
  }
  const portrait = css.slice(css.indexOf("@media (max-width: 680px) and (orientation: portrait)"));
  assert.match(portrait, /^@media \(max-width: 680px\) and \(orientation: portrait\) \{\s*\.scoreBlock \{ justify-self: end; \}\s*\.right \.scoreBlock \{ justify-self: start; \}\s*\}/);
  assert.match(css, /\.gameCardTeam\[data-side="home"\] {[^}]*grid-template-areas: "score identity logo"; text-align: right/);
  assert.match(css, /\.gameCardTeam {[^}]*grid-template-areas: "logo identity score"/);
  assert.match(css, /--game-card-logo-size: 32px/);
});

test("starter rows show final NFL results from each team's perspective and retain full player names", () => {
  const makePlayer = (team, name, shortName) => ({ ...game.positionGroups[0].home[0], team, name, shortName,
    slot: "RB", position: "RB", score: 25.9, projectedScore: 13.12, gameStatusState: "post", gameCompleted: true, statsLine: "20 CAR, 60 YD" });
  const matchup = { teams: [{ starters: [makePlayer("HOU", "David Montgomery", "D. Montgomery")] }, { starters: [makePlayer("BUF", "James Cook", "J. Cook")] }] };
  const nflGames = [{ ...game, statusState: "post", completed: true,
    teams: [{ abbreviation: "HOU", homeAway: "home", score: 31 }, { abbreviation: "BUF", homeAway: "away", score: 36 }] }];
  const html = renderToStaticMarkup(React.createElement(tracker.StarterRows, { matchup, nflGames, timeZone: "UTC", onSelectDefense() {} }));
  assert.match(html, /title="David Montgomery" aria-label="David Montgomery">D\. Montgomery/);
  assert.match(html, /Final L 31-36 vs BUF/);
  assert.match(html, /Final W 36-31 @ HOU/);
  assert.match(html, /<strong>25\.90<\/strong>/);
  assert.match(html, /Proj\. 13\.12/);
});
