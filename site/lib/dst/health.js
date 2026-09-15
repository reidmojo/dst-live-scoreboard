// Scoring uncertainty is not a transport outage. Keep both visible, but never
// advertise fresh feeds as delayed or hide uncertainty from finalization checks.
export function warningKind(warning) {
  if (warning.kind) return warning.kind;
  // Compatibility with a saved dashboard from before warnings were classified.
  if (/drive scoring/.test(warning.label || "")) return "scoring";
  if (/default comparison/.test(warning.label || "")) return "comparison";
  if (/Backup storage|Saved results|Finalized snapshot/.test(warning.label || "")) return "storage";
  return "upstream";
}

export function healthFlags({ warnings = [], sources = [] } = {}) {
  return { ok: warnings.length === 0 && !sources.some(source => source.stale),
    stale: warnings.some(warning => warningKind(warning) === "upstream") || sources.some(source => source.stale) };
}

const canonicalTeam = value => String(value || "").toUpperCase().replace(/^WAS$/, "WSH");
/** @typedef {{kind?: string, label?: string, message?: string, teams?: string[]}} HealthWarning */
export function warningGroups(health = {}, teams) {
  /** @type {{upstream: HealthWarning[], scoring: HealthWarning[], comparison: HealthWarning[], storage: HealthWarning[]}} */
  const groups = { upstream: [], scoring: [], comparison: [], storage: [] };
  const selected = teams == null ? null : new Set(teams.map(canonicalTeam));
  for (const warning of health.warnings || []) {
    const kind = warningKind(warning);
    const affected = warning.teams || (/drive scoring|default comparison/.test(warning.label || "") ? [warning.label.split(" ")[0]] : []);
    if (selected && ["scoring", "comparison"].includes(kind) && affected.length && !affected.some(team => selected.has(canonicalTeam(team)))) continue;
    const group = groups[kind] || groups.upstream;
    if (!group.some(existing => existing.label === warning.label && existing.message === warning.message)) group.push(warning);
  }
  // Preserve a genuine last-good-data fallback even if it has no warning details.
  if (!groups.upstream.length && (health.sources?.some(source => source.stale) || (health.stale && !health.refreshing && !health.warnings?.length))) {
    groups.upstream.push({ label: "Score update", message: "Showing last received data while updates recover." });
  }
  return groups;
}
