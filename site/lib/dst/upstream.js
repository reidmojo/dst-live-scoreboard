// Per-worker coalescing: simultaneous viewers share each upstream request.
export function createUpstreamClient({ fetcher = (...args) => fetch(...args), now = Date.now, timeoutMs = 8000 } = {}) {
  const cache = new Map();
  const pending = new Map();
  return async function fetchJson(url, options = {}) {
    const cached = cache.get(url);
    let entry;
    let failure;
    if (cached && now() - cached.time < (options.ttlMs ?? 30000)) entry = cached;
    else {
      if (!pending.has(url)) {
        pending.set(url, (async () => {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const headers = { accept: 'application/json' };
              // ESPN's public site API requires the same client header used by production.
              if (url.startsWith('https://site.')) headers['user-agent'] = 'curl/8.7.1';
              const response = await fetcher(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
              if (!response.ok) {
                const error = new Error(`HTTP ${response.status}`);
                error.retryable = response.status >= 500;
                throw error;
              }
              const value = await response.json();
              if (options.validate && !options.validate(value)) throw new Error('Incomplete or invalid response');
              const valueEntry = { value, time: now() };
              cache.set(url, valueEntry);
              return valueEntry;
            } catch (error) {
              if (attempt || error.retryable === false) throw error;
            }
          }
        })().finally(() => pending.delete(url)));
      }
      try { entry = await pending.get(url); }
      catch (error) { failure = error; entry = cached; }
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
  };
}
