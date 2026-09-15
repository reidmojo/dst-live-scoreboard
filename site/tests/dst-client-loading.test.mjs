import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as presentation from "../lib/dst/presentation.js";
import * as estimates from "../lib/dst/live-estimates.js";
import * as health from "../lib/dst/health.js";
import * as policy from "../lib/dst/loading-policy.js";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../app/fantasy_football/dst/dst-tracker.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const sample = (week = 1, refreshing = false) => ({ generatedAt: "2026-09-14T10:00:00Z", selected: { season: "2026", week },
  league: { id: "league", name: "Test league" }, seasons: [2026], weeks: [1, 2], teams: [], matchups: [], nflGames: [], source: {}, correction: {},
  health: { ok: true, stale: refreshing, refreshing, warnings: [], pollIntervalMs: refreshing ? 1000 : 15000 },
});

// Small deterministic hook harness: test the actual loading/effect code without
// a browser or another test framework. Network responses and timers are explicit.
function harness(search = "?season=2026&week=1") {
  const hooks = [], effects = [], timers = new Map(), listeners = new Map(), requests = [];
  let index = 0, now = 0, timerId = 0, dirty = true, tree;
  const slot = init => { const id = index++; return hooks[id] ||= init(); };
  const same = (a, b) => a?.length === b?.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const h = slot(() => ({ value: initial })); return [h.value, value => { const next = typeof value === "function" ? value(h.value) : value; if (!Object.is(next, h.value)) { h.value = next; dirty = true; } }]; },
    useRef(initial) { return slot(() => ({ current: initial })); },
    useMemo(fn, deps) { const h = slot(() => ({})); if (!same(h.deps, deps)) { h.value = fn(); h.deps = deps; } return h.value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const h = slot(() => ({})); if (!same(h.deps, deps)) { h.deps = deps; effects.push(() => { h.cleanup?.(); h.cleanup = fn(); }); } },
  };
  const window = { location: new URL(`https://test.invalid/fantasy_football/dst${search}`), localStorage: { getItem: () => null },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { at: now + delay, fn }); return id; }, clearTimeout(id) { timers.delete(id); },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
  };
  const history = [{ state: {}, url: window.location.href }];
  let historyIndex = 0;
  window.history = { state: {},
    replaceState(state, _title, url) { this.state = state; window.location = new URL(url, window.location); history[historyIndex] = { state, url: window.location.href }; },
    pushState(state, title, url) { history.splice(++historyIndex); this.replaceState(state, title, url); },
    back() { if (!historyIndex) return; const saved = history[--historyIndex]; this.state = saved.state; window.location = new URL(saved.url); listeners.get("popstate")?.(); },
    forward() { if (historyIndex >= history.length - 1) return; const saved = history[++historyIndex]; this.state = saved.state; window.location = new URL(saved.url); listeners.get("popstate")?.(); },
  };
  const document = { cookie: "", hidden: false, addEventListener: window.addEventListener, removeEventListener: window.removeEventListener };
  const exports = {};
  runInNewContext(compiled, { exports, window, document, URL, URLSearchParams, Intl, Date, Set, Map, Error, DOMException, AbortController,
    fetch(url, { signal }) { return new Promise((resolve, reject) => {
      const row = { url, signal, resolve: data => resolve({ ok: true, json: async () => data }) };
      requests.push(row);
      // Safari may reject with AbortError even when signal.reason is TimeoutError.
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }); },
    require: name => name === "react" ? react : name.endsWith(".css") ? { __esModule: true, default: {} }
      : name.endsWith("presentation.js") ? presentation : name.endsWith("live-estimates.js") ? estimates
      : name.endsWith("health.js") ? health : name.endsWith("loading-policy.js") ? policy : name === "./games-view" ? {} : require(name),
  });
  const render = () => { let count = 0; while (dirty) { assert.ok(count++ < 20, "render loop"); dirty = false; index = 0; tree = exports.default(); while (effects.length) effects.shift()(); } };
  const flush = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); render(); } };
  const advance = async ms => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now && timers.delete(id)) timer.fn(); await flush(); };
  render();
  return { requests, window, hooks, flush, advance, tree: () => tree, event: name => listeners.get(name)?.(),
    state: () => ({ data: hooks[0].value, loading: hooks[1].value, error: hooks[2].value, slow: hooks[3].value }),
  };
}

test("returning to a visible mobile tab does not abort or duplicate an in-progress initial load", async () => {
  const h = harness(); await h.advance(0);
  h.event("visibilitychange"); h.event("visibilitychange"); await h.flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].signal.aborted, false);
  await h.advance(4000);
  assert.equal(h.state().slow, true);
  h.requests[0].resolve(sample()); await h.flush();
  assert.equal(h.state().loading, false);
  assert.equal(h.state().slow, false);
});

test("opening a player's game keeps the selected week and returns to the original matchup with Back", async () => {
  const h = harness("?season=2026&week=1&matchup=4"); await h.advance(0);
  const data = sample();
  const game = { id: "game-for-week1", teams: [{ abbreviation: "PHI", homeAway: "home" }, { abbreviation: "WAS", homeAway: "away" }] };
  data.nflGames = [game]; data.matchups = [{ id: "4", teams: [] }];
  h.requests[0].resolve(data); await h.flush();
  const find = (tree, matches) => {
    if (!tree) return null;
    if (Array.isArray(tree)) return tree.map(child => find(child, matches)).find(Boolean);
    if (matches(tree)) return tree;
    return find(tree.props?.children, matches);
  };
  const starters = find(h.tree(), node => node.type?.name === "StarterRows");
  assert.ok(starters);
  starters.props.onOpenGame(game, { id: "player-game-1-qb" }); await h.flush();
  assert.equal(h.window.location.search, "?season=2026&week=1&view=games&game=game-for-week1");
  assert.equal(find(h.tree(), node => node.props?.id === "games-tab").props["aria-selected"], true);
  const back = find(h.tree(), node => node.props?.["aria-label"] === "Back to matchup");
  assert.ok(back); back.props.onClick(); await h.flush();
  assert.equal(h.window.location.search, "?season=2026&week=1&matchup=4");
  assert.ok(find(h.tree(), node => node.type?.name === "StarterRows"));
  assert.equal(h.requests.length, 1, "navigation uses this week's already-loaded game data");
  h.window.history.forward(); await h.flush();
  assert.match(h.window.location.search, /game=game-for-week1/);
  assert.equal(find(h.tree(), node => node.props?.id === "games-tab").props["aria-selected"], true);
});

test("Safari-style timeout exits the spinner and retries after three seconds", async () => {
  const h = harness(); await h.advance(0); await h.advance(policy.DASHBOARD_REQUEST_TIMEOUT_MS);
  assert.equal(h.state().loading, false);
  assert.match(h.state().error, /timed out/);
  await h.advance(2999); assert.equal(h.requests.length, 1);
  await h.advance(1); assert.equal(h.requests.length, 2);
  h.requests[1].resolve(sample()); await h.flush();
  assert.equal(h.state().error, "");
  assert.equal(h.state().data.selected.week, 1);
});

test("default-week saved scores remain visible during refresh without pinning an outdated week", async () => {
  const h = harness(""); await h.advance(0);
  h.requests[0].resolve(sample(1, true)); await h.flush();
  assert.equal(h.window.location.search, "");
  await h.advance(1000);
  assert.equal(h.state().data.selected.week, 1);
  assert.equal(h.state().loading, true);
  assert.match(h.requests[1].url, /refresh=1/);
  assert.doesNotMatch(h.requests[1].url, /week=/);
  h.requests[1].resolve(sample(2)); await h.flush();
  assert.equal(h.state().data.selected.week, 2);
  assert.match(h.window.location.search, /week=2/);
});

test("changing weeks cancels the old request and ignores even a late result", async () => {
  const h = harness(); await h.advance(0);
  h.window.location = new URL("https://test.invalid/fantasy_football/dst?season=2026&week=2");
  h.event("popstate"); await h.flush();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.requests.length, 2);
  h.requests[0].resolve(sample(1)); h.requests[1].resolve(sample(2)); await h.flush();
  assert.equal(h.state().data.selected.week, 2);
  assert.equal(h.state().error, "");
});
