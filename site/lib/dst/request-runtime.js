// Bound the await itself: an adapter that ignores AbortSignal must not strand
// callers. Always observe the original promise and clean up our timer/listener.
export function withDeadline(task, { timeoutMs, signal, label = "Score update", onTimeout } = {}) {
  const existing = typeof task === "function" ? null : Promise.resolve(task);
  // A caller may already be canceled; still consume a shared task's rejection.
  existing?.catch(() => {});
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      fn(value);
    };
    const abort = () => finish(reject, signal.reason || new DOMException("Canceled", "AbortError"));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      const error = new DOMException(`${label} timed out`, "TimeoutError");
      finish(reject, error);
      onTimeout?.(error);
    }, timeoutMs);
    const work = existing || Promise.resolve().then(() => {
      signal?.throwIfAborted();
      return task();
    });
    work.then(value => finish(resolve, value), error => finish(reject, error));
  });
}

export function createRequestTrace(requestId = crypto.randomUUID(), log = entry => console.info(JSON.stringify(entry))) {
  const startedAt = Date.now();
  const pending = new Map();
  const stages = [];
  return {
    async run(stage, task) {
      const token = Symbol(stage);
      const started = Date.now();
      pending.set(token, stage);
      let outcome = "ok";
      try { return await task(); }
      catch (error) { outcome = error?.name || "Error"; throw error; }
      finally {
        pending.delete(token);
        stages.push({ stage, elapsedMs: Date.now() - started, outcome });
      }
    },
    report(outcome, details = {}) {
      // Labels only: never log request headers, full URLs, league rosters or bodies.
      log({ event: "dst_dashboard", requestId, outcome, elapsedMs: Date.now() - startedAt,
        pending: [...pending.values()], stages: [...stages], ...details });
    },
  };
}
