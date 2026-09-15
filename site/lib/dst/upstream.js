import { withDeadline } from "./request-runtime.js";

// Completed values and bounded in-flight work are shared within a Worker.
export function createUpstreamClient({ fetcher = (...args) => fetch(...args), now = Date.now, timeoutMs = 3500 } = {}) {
  const cache = new Map();
  const pending = new Map();
  async function fetchJson(url, options = {}) {
    const signal = options.requestState?.signal;
    signal?.throwIfAborted();
    const cached = cache.get(url);
    let entry;
    let failure;
    if (cached && now() - cached.time < (options.ttlMs ?? 30000)) entry = cached;
    else {
      let active = pending.get(url);
      if (active && now() - active.startedAt >= timeoutMs * 2) {
        pending.delete(url);
        active = null;
      }
      if (!active) {
        active = { startedAt: now(), promise: null };
        const ownEntry = active;
        active.promise = (async () => {
          for (let attempt = 0; attempt < 2; attempt++) {
            const controller = new AbortController();
            try {
              const headers = { accept: 'application/json' };
              // ESPN's public site API requires the same client header used by production.
              if (url.startsWith('https://site.')) headers['user-agent'] = 'curl/8.7.1';
              const value = await withDeadline(async () => {
                const response = await fetcher(url, { headers, signal: controller.signal });
                if (!response.ok) {
                  const error = new Error(`HTTP ${response.status}`);
                  error.retryable = response.status >= 500;
                  throw error;
                }
                return response.json();
              }, { timeoutMs, label: options.label || "Provider", onTimeout: error => controller.abort(error) });
              if (options.validate && !options.validate(value)) throw new Error('Incomplete or invalid response');
              const valueEntry = { value, time: now() };
              cache.set(url, valueEntry);
              while (cache.size > 64) cache.delete(cache.keys().next().value);
              return valueEntry;
            } catch (error) {
              if (attempt || error.retryable === false) throw error;
            }
          }
        })().finally(() => { if (pending.get(url) === ownEntry) pending.delete(url); });
        pending.set(url, active);
      }
      try { entry = await withDeadline(active.promise, { timeoutMs: timeoutMs * 2 + 100, signal, label: options.label || "Provider" }); }
      catch (error) { signal?.throwIfAborted(); failure = error; entry = cached; }
    }
    const label = options.label || new URL(url).hostname;
    if (failure) {
      options.requestState?.warnings.push({ kind: "upstream", label, fetchedAt: entry ? new Date(entry.time).toISOString() : null,
        ageSeconds: entry ? Math.floor((now() - entry.time) / 1000) : null,
        message: entry ? `${label}: showing last received data (${failure.message})` : `${label}: unavailable (${failure.message})` });
      if (!entry) {
        if (options.optional) return null;
        throw new Error(`${label} unavailable: ${failure.message}`);
      }
    }
    if (entry) options.requestState?.sources.push({ label, fetchedAt: new Date(entry.time).toISOString(), stale: Boolean(failure) });
    return entry?.value;
  }
  return (url, options = {}) => options.requestState?.trace
    ? options.requestState.trace.run(options.label || "Provider", () => fetchJson(url, options))
    : fetchJson(url, options);
}
