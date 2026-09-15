import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardCache, savedDashboard } from "../lib/dst/dashboard-cache.js";
import { createRequestTrace, withDeadline } from "../lib/dst/request-runtime.js";
import { createUpstreamClient } from "../lib/dst/upstream.js";
import { scoreRetryDelay, selectionKey } from "../lib/dst/loading-policy.js";
import { warningGroups } from "../lib/dst/health.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const dashboard = (age = 0) => ({ generatedAt: new Date(Date.now() - age).toISOString(),
  league: { id: "league" }, selected: { season: "2026", week: 1 }, source: { snapshot: false },
  health: { ok: false, stale: false, warnings: [{ kind: "scoring", label: "CHI drive scoring", message: "Play needs confirmation" }], pollIntervalMs: 15000 },
  correction: { status: "provisional" }, teams: [{ score: 12.34 }], matchups: [], nflGames: [],
});
function database() {
  const rows = new Map(), writes = [];
  return { rows, writes, prepare(sql) {
    let args;
    return { bind(...values) { args = values; return this; },
      async first() { return rows.has(args[0]) ? { dashboard: JSON.stringify(rows.get(args[0])) } : null; },
      async run() { writes.push(sql); rows.set(args[0], JSON.parse(args[1])); return {}; },
    };
  } };
}

test("provisional scores cache across worker restarts without changing audit/finalization flags", async () => {
  const db = database();
  const expected = dashboard();
  const cache = createDashboardCache();
  let builds = 0;
  const build = async () => { builds++; return expected; };
  await cache("week1", db, build);
  assert.deepEqual(await cache("week1", db, build), expected);
  const cold = createDashboardCache();
  assert.deepEqual(await cold("week1", db, build), expected);
  assert.equal(builds, 1);
  assert.equal(db.writes.length, 1);
  assert.ok(db.writes.every(sql => sql.includes("dst_live_cache") && !sql.includes("dst_snapshots")));
  assert.equal(db.rows.get("week1").health.ok, false);
  assert.equal(db.rows.get("week1").correction.status, "provisional");
});

test("saved response returns before refresh; refresh survives its response and is shared with the next fetch", async () => {
  const db = database();
  const old = dashboard(60000);
  db.rows.set("week1", old);
  const cache = createDashboardCache();
  const refresh = deferred();
  const background = [];
  let builds = 0;
  const build = () => { builds++; return refresh.promise; };
  const saved = await withDeadline(cache("week1", db, build, { waitUntil: task => background.push(task) }), { timeoutMs: 100 });
  assert.equal(saved.generatedAt, old.generatedAt);
  assert.equal(saved.health.refreshing, true);
  assert.deepEqual(saved.health.warnings, old.health.warnings);
  assert.equal(background.length, 1);
  assert.equal(warningGroups(saved.health).upstream.length, 0);
  const freshWaiter = cache("week1", db, build, { preferFresh: true, waitUntil: task => background.push(task) });
  const fresh = dashboard();
  refresh.resolve(fresh);
  assert.deepEqual(await freshWaiter, fresh);
  await Promise.all(background);
  assert.equal(builds, 1);
  assert.equal(db.rows.get("week1").generatedAt, fresh.generatedAt);
});

test("a hung cache read is bounded and does not prevent a live response", async () => {
  const db = database();
  const prepare = db.prepare;
  db.prepare = sql => { const statement = prepare(sql); if (sql.startsWith("SELECT")) statement.first = () => new Promise(() => {}); return statement; };
  const cache = createDashboardCache({ storageTimeoutMs: 10 });
  const expected = dashboard();
  assert.deepEqual(await withDeadline(cache("week1", db, async () => expected), { timeoutMs: 200 }), expected);
});

test("a stuck calculation times out, aborts work, and never poisons the next visitor or caches a late result", async () => {
  const cache = createDashboardCache({ buildTimeoutMs: 15, storageTimeoutMs: 10 });
  const db = database();
  const stuck = deferred();
  let signal;
  await assert.rejects(cache("week1", db, (_old, s) => { signal = s; return stuck.promise; }), { name: "TimeoutError" });
  assert.equal(signal.aborted, true);
  const expected = dashboard();
  const next = await cache("week1", db, async () => expected);
  assert.deepEqual(next, expected);
  const late = dashboard(); late.teams[0].score = 999;
  stuck.resolve(late);
  await Promise.resolve();
  assert.equal((await cache("week1", db, async () => late)).teams[0].score, 12.34);
});

test("failed refresh preserves original timestamps/warnings and never leaks saved scores to another key", async () => {
  const cache = createDashboardCache({ buildTimeoutMs: 10, storageTimeoutMs: 10 });
  const db = database();
  const old = dashboard(60000); db.rows.set("week1", old);
  const fail = async () => { throw new Error("Offline"); };
  const fallback = await cache("week1", db, fail);
  assert.equal(fallback.generatedAt, old.generatedAt);
  assert.equal(fallback.health.stale, true);
  assert.equal(fallback.health.refreshing, false);
  assert.equal(fallback.health.warnings[0].kind, "scoring");
  assert.equal(fallback.health.warnings[1].kind, "upstream");
  assert.deepEqual(db.rows.get("week1"), old);
  await assert.rejects(cache("week2", db, fail), /Offline/);
});

test("stale provider data does not overwrite a fresher backup; storage failures do not discard live scores", async () => {
  const db = database();
  const old = dashboard(60000); db.rows.set("week1", old);
  const stale = dashboard(); stale.health.stale = true;
  const cache = createDashboardCache();
  await cache("week1", db, async () => stale);
  assert.equal(db.rows.get("week1").generatedAt, old.generatedAt);
  const prepare = db.prepare;
  db.prepare = sql => { const statement = prepare(sql); statement.run = () => new Promise(() => {}); return statement; };
  const otherCache = createDashboardCache({ storageTimeoutMs: 10 });
  const result = await otherCache("week1", db, async () => dashboard());
  assert.equal(result.teams[0].score, 12.34);
  assert.equal(result.health.stale, false);
  assert.equal(result.health.warnings.at(-1).kind, "storage");
});

test("upstream adapters ignoring abort and stalled JSON bodies are bounded and can recover", async () => {
  for (const hangInBody of [false, true]) {
    let hang = true, calls = 0;
    const client = createUpstreamClient({ timeoutMs: 10, fetcher: async () => {
      calls++;
      if (!hang) return Response.json({ score: 7 });
      if (hangInBody) return { ok: true, json: () => new Promise(() => {}) };
      return new Promise(() => {});
    } });
    const state = { warnings: [], sources: [] };
    assert.equal(await withDeadline(client("https://test.invalid/score", { optional: true, requestState: state }), { timeoutMs: 200 }), null);
    assert.equal(calls, 2);
    assert.equal(state.warnings.length, 1);
    hang = false;
    assert.equal((await client("https://test.invalid/score")).score, 7);
  }
});

test("diagnostics report the stalled stage without logging request data", async () => {
  const entries = [];
  const trace = createRequestTrace("test-request", entry => entries.push(entry));
  const cache = createDashboardCache({ buildTimeoutMs: 10, storageTimeoutMs: 10 });
  await assert.rejects(cache("week1", database(), () => trace.run("Sleeper player stats", () => new Promise(() => {})), { trace }));
  const failure = entries.find(entry => entry.outcome === "refresh_failed");
  assert.ok(failure.pending.includes("Sleeper player stats"));
  assert.equal(failure.requestId, "test-request");
  assert.equal(failure.errorType, "TimeoutError");
  assert.doesNotMatch(JSON.stringify(entries), /cookie|headers|roster|https:/);
});

test("retry backoff is quick initially but bounded during a long outage, with week-scoped selection keys", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 100].map(scoreRetryDelay), [3000, 6000, 12000, 24000, 30000, 30000]);
  assert.notEqual(selectionKey({ season: "2026", week: "1" }), selectionKey({ season: "2026", week: "2" }));
  const cached = savedDashboard({ ...dashboard(), health: { ok: true, stale: false, warnings: [] } }, { refreshing: true });
  assert.equal(warningGroups(cached.health).upstream.length, 0);
});
