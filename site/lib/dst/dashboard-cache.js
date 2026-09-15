import { withDeadline } from "./request-runtime.js";

export function usableDashboard(value) {
  return !!value?.league?.id && !!value?.selected?.season && Number.isInteger(value?.selected?.week)
    && Number.isFinite(Date.parse(value.generatedAt)) && typeof value?.health?.stale === "boolean"
    && Array.isArray(value.health.warnings) && Array.isArray(value.teams)
    && Array.isArray(value.matchups) && Array.isArray(value.nflGames);
}

export function savedDashboard(dashboard, { refreshing = false, error } = {}) {
  return { ...dashboard, servedAt: new Date().toISOString(), health: { ...dashboard.health,
    ok: false, stale: true, refreshing, pollIntervalMs: refreshing ? 1000 : 5000,
    warnings: error ? [...dashboard.health.warnings, { kind: "upstream", label: "Score update",
      message: "The latest update could not finish. Showing saved scores while we retry." }] : dashboard.health.warnings,
  } };
}

export function createDashboardCache({ ttlMs = 10_000, buildTimeoutMs = 10_000, storageTimeoutMs = 1200, now = Date.now } = {}) {
  // Keep only a few completed weeks in this memory-limited Worker. D1 is durable.
  const completed = new Map();
  const pending = new Map();
  const remember = (key, value) => {
    if (completed.get(key)?.generatedAt > value.generatedAt) return;
    completed.delete(key);
    completed.set(key, value);
    while (completed.size > 4) completed.delete(completed.keys().next().value);
  };
  return async function getCachedDashboard(key, db, build, { waitUntil, preferFresh = false, trace, accepts = usableDashboard } = {}) {
    const stage = (label, task) => trace ? trace.run(label, task) : task();
    let cached = completed.get(key);
    if (!cached) {
      try {
        const row = await stage("cache_read", () => withDeadline(() => db.prepare("SELECT dashboard FROM dst_live_cache WHERE cache_key = ?")
          .bind(key).first(), { timeoutMs: storageTimeoutMs, label: "Saved scoreboard" }));
        const stored = row?.dashboard ? JSON.parse(row.dashboard) : null;
        if (accepts(stored)) { cached = stored; remember(key, stored); }
      } catch { /* A slow or unavailable cache must not block a live calculation. */ }
    }
    if (cached && now() - Date.parse(cached.generatedAt) < ttlMs) {
      trace?.report("response", { cache: "fresh" });
      return cached;
    }

    let entry = pending.get(key);
    // Timers belong to their request context. Also expire entries by age so a
    // canceled context cannot leave a shared promise blocking future visitors.
    if (entry && now() - entry.startedAt >= buildTimeoutMs + storageTimeoutMs) {
      entry.controller.abort(new DOMException("Expired score update", "TimeoutError"));
      pending.delete(key);
      entry = null;
    }
    if (!entry) {
      const controller = new AbortController();
      entry = { startedAt: now(), controller, promise: null };
      const ownEntry = entry;
      const work = (async () => {
        try {
          const dashboard = await withDeadline(() => build(cached, controller.signal), {
            timeoutMs: buildTimeoutMs, signal: controller.signal, label: "Score calculation",
            onTimeout: error => controller.abort(error),
          });
          if (!accepts(dashboard)) throw new Error("Incomplete scoreboard");
          // Scoring/comparison warnings affect finalization, not cache usability.
          // Never promote stale provider data or an old fallback to a fresh cache.
          if (!dashboard.health.stale && !dashboard.health.sources?.some(source => source.stale)) {
            remember(key, dashboard);
            try {
              await stage("cache_write", () => withDeadline(() => db.prepare(`INSERT INTO dst_live_cache (cache_key, dashboard, generated_at)
                VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET dashboard = excluded.dashboard, generated_at = excluded.generated_at
                WHERE excluded.generated_at >= dst_live_cache.generated_at`)
                .bind(key, JSON.stringify(dashboard), dashboard.generatedAt).run(), { timeoutMs: storageTimeoutMs, label: "Saving scoreboard" }));
            } catch {
              dashboard.health.warnings.push({ kind: "storage", label: "Backup storage", message: "Live scores loaded; durable backup temporarily unavailable" });
              dashboard.health.ok = false;
              dashboard.health.pollIntervalMs = Math.min(dashboard.health.pollIntervalMs || 60_000, 60_000);
            }
          }
          trace?.report("refresh_complete", { warningCount: dashboard.health.warnings.length });
          return dashboard;
        } catch (error) {
          trace?.report("refresh_failed", { errorType: error?.name || "Error" });
          throw error;
        } finally {
          if (pending.get(key) === ownEntry) pending.delete(key);
        }
      })();
      entry.promise = work;
      pending.set(key, entry);
    }
    // Register before returning (including cold loads), so the calculation and
    // cache save survive a browser disconnect or a stale-while-revalidate reply.
    waitUntil?.(entry.promise.catch(() => {}));
    if (cached && waitUntil && !preferFresh) {
      trace?.report("response", { cache: "saved_refreshing" });
      return savedDashboard(cached, { refreshing: true });
    }
    try {
      const result = await stage("refresh_wait", () => withDeadline(entry.promise, {
        timeoutMs: buildTimeoutMs + storageTimeoutMs, label: "Score update",
      }));
      trace?.report("response", { cache: "updated" });
      return result;
    } catch (error) {
      if (pending.get(key) === entry) {
        entry.controller.abort(error);
        pending.delete(key);
      }
      trace?.report("response", { cache: cached ? "fallback" : "miss", errorType: error?.name || "Error" });
      if (!cached) throw error;
      return savedDashboard(cached, { error });
    }
  };
}
