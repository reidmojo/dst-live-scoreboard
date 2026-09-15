// Leave room for the server's bounded calculation plus a mobile transfer.
export const DASHBOARD_REQUEST_TIMEOUT_MS = 14_000;
export const INITIAL_LOADING_HINT_MS = 4000;
export const scoreRetryDelay = failures => Math.min(30_000, 3000 * 2 ** Math.max(0, Math.min(4, failures - 1)));
export const selectionKey = selection => `${selection.season || "latest"}:${selection.week || "latest"}`;
