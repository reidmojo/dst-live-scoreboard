import test from "node:test";
import assert from "node:assert/strict";
import { healthFlags, warningGroups } from "../lib/dst/health.js";

const pending = { kind: "scoring", teams: ["CHI"], label: "CHI drive scoring", message: "Possession awaiting confirmation" };

test("fresh but unresolved scoring stays provisional without claiming the feed is stale", () => {
  assert.deepEqual(healthFlags({ warnings: [pending], sources: [{ stale: false }] }), { ok: false, stale: false });
  assert.deepEqual(healthFlags({ warnings: [{ label: "CHI drive scoring", message: pending.message }] }), { ok: false, stale: false });
  assert.deepEqual(healthFlags({ warnings: [{ kind: "storage" }] }), { ok: false, stale: false });
  assert.deepEqual(healthFlags({ warnings: [{ kind: "comparison" }] }), { ok: false, stale: false });
  assert.deepEqual(healthFlags(), { ok: true, stale: false });
});

test("real upstream failures and stale sources remain explicit", () => {
  assert.deepEqual(healthFlags({ warnings: [{ kind: "upstream" }] }), { ok: false, stale: true });
  assert.deepEqual(healthFlags({ sources: [{ stale: true }] }), { ok: false, stale: true });
  assert.equal(warningGroups({ stale: true }).upstream.length, 1);
  assert.equal(warningGroups({ warnings: [pending], sources: [{ stale: true }] }, ["BAL"]).upstream.length, 1);
});

test("team-scoped checks preserve aliases, deduplicate, and never suppress global failures", () => {
  const warnings = [pending, pending, { kind: "scoring", teams: ["WSH"], label: "WSH drive scoring" }, { kind: "upstream", label: "Sleeper matchups", message: "Timeout" }];
  const all = warningGroups({ warnings });
  assert.equal(all.scoring.length, 2);
  const scoped = warningGroups({ warnings }, ["WAS"]);
  assert.equal(scoped.scoring.length, 1);
  assert.equal(scoped.scoring[0].label, "WSH drive scoring");
  assert.equal(scoped.upstream.length, 1);
  assert.equal(warningGroups({ warnings }, []).scoring.length, 0);
});
