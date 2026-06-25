const state = {
  data: null,
  selectedTeam: null,
  timer: null,
  hasLoaded: false
};

const els = {
  leagueName: document.querySelector("#leagueName"),
  updatedAt: document.querySelector("#updatedAt"),
  statusDetail: document.querySelector("#statusDetail"),
  seasonSelect: document.querySelector("#seasonSelect"),
  weekSelect: document.querySelector("#weekSelect"),
  refreshButton: document.querySelector("#refreshButton"),
  matchups: document.querySelector("#matchups"),
  auditDialog: document.querySelector("#auditDialog"),
  auditTitle: document.querySelector("#auditTitle"),
  auditBody: document.querySelector("#auditBody"),
  closeDialog: document.querySelector("#closeDialog")
};

boot();

async function boot() {
  els.refreshButton.addEventListener("click", loadDashboard);
  els.weekSelect.addEventListener("change", loadDashboard);
  els.seasonSelect.addEventListener("change", loadDashboard);
  els.closeDialog.addEventListener("click", () => els.auditDialog.close());

  await loadDashboard();
}

async function loadDashboard() {
  setLoading(true);
  try {
    const response = await fetch(dashboardUrl());
    if (!response.ok) throw new Error(`Dashboard request failed: ${response.status}`);
    state.data = await response.json();
    state.hasLoaded = true;
    render();
  } catch (error) {
    renderError(error);
  } finally {
    setLoading(false);
    scheduleRefresh(state.data?.health?.pollIntervalMs || 30_000);
  }
}

function dashboardUrl() {
  const params = new URLSearchParams();
  if (state.hasLoaded && els.seasonSelect.value) params.set("season", els.seasonSelect.value);
  if (state.hasLoaded && els.weekSelect.value) params.set("week", els.weekSelect.value);
  const query = params.toString();
  return query ? `/api/dashboard?${query}` : "/api/dashboard";
}

function render() {
  const data = state.data;
  if (!data) return;

  els.leagueName.textContent = data.league.name || "League";
  syncSeasonOptions(data.seasons, data.selected.season);
  syncWeekOptions(data.weeks, data.selected.week);
  els.seasonSelect.value = data.selected.season;
  els.weekSelect.value = String(data.selected.week);
  els.updatedAt.textContent = formatDateTime(data.servedAt || data.generatedAt);
  els.statusDetail.textContent = statusDetail(data);
  els.statusDetail.className = `status-detail ${data.health?.stale ? "stale" : ""}`;

  renderMatchups(data.matchups);
}

function scheduleRefresh(delayMs) {
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(loadDashboard, Number(delayMs || 30_000));
}

function statusDetail(data) {
  const bits = [];
  const pollSeconds = Math.round((data.health?.pollIntervalMs || 30_000) / 1000);
  bits.push(data.health?.stale ? "Stale cache" : "Live refresh");
  bits.push(`${pollSeconds}s`);
  if (data.correction?.status) bits.push(data.correction.label);
  return bits.join(" · ");
}

function renderMatchups(matchups) {
  els.matchups.innerHTML = "";
  for (const matchup of matchups) {
    const card = document.createElement("article");
    card.className = "matchup-card";
    const highScore = Math.max(...matchup.teams.map((team) => Number(team.projectedCustomTotal || 0)));
    const rows = matchup.teams.map((team) => matchupTeamHtml(team, highScore)).join("");
    card.innerHTML = `
      <div class="matchup-teams">${rows}</div>
    `;
    card.querySelectorAll("[data-roster-id]").forEach((button) => {
      const team = matchup.teams.find((candidate) => String(candidate.rosterId) === button.dataset.rosterId);
      button.addEventListener("click", () => openAudit(team));
    });
    els.matchups.append(card);
  }
}

function matchupTeamHtml(team, highScore) {
  const isLeader = Number(team.projectedCustomTotal || 0) === highScore;
  return `
    <button class="matchup-team ${isLeader ? "leader" : ""}" type="button" data-roster-id="${team.rosterId}">
      ${avatarHtml(team)}
      <div class="matchup-main">
        <strong>${escapeHtml(team.teamName)}</strong>
        <span>${escapeHtml(team.manager)} · ${team.dstTeam || "No DEF"} ${signed(team.customDstPoints)} DST</span>
      </div>
      <div class="score-block">
        <strong>${fmt(team.projectedCustomTotal)}</strong>
        <span>${fmt(team.sleeperTotal)}</span>
      </div>
    </button>
  `;
}

function openAudit(team) {
  els.auditTitle.textContent = `${team.dstTeam || "No DEF"} · ${team.teamName}`;
  const newAudit = team.newDstAudit || { total: team.customDstPoints, components: team.dstComponents || [] };
  const oldAudit = team.oldDstAudit || { total: team.sleeperDstPoints, components: [] };
  const impact = Number(newAudit.total || 0) - Number(oldAudit.total || 0);
  els.auditBody.innerHTML = `
    <div class="audit-total-row">
      <div>
        <span>New DST</span>
        <strong>${signed(newAudit.total)}</strong>
      </div>
      <div>
        <span>Old DST</span>
        <strong>${signed(oldAudit.total)}</strong>
      </div>
      <div>
        <span>Team impact</span>
        <strong class="${impact >= 0 ? "positive" : "negative"}">${signed(impact)}</strong>
      </div>
    </div>
    <div class="audit-columns">
      <section class="audit-column">
        <div class="audit-column-head">
          <span>New scoring</span>
          <strong>${signed(newAudit.total)}</strong>
        </div>
        ${newScoringRows(newAudit.components)}
      </section>
      <section class="audit-column">
        <div class="audit-column-head">
          <span>Old scoring (Sleeper)</span>
          <strong>${signed(oldAudit.total)}</strong>
        </div>
        <p class="audit-note">Rows are an ESPN state estimate reconciled to Sleeper's live D/ST total.</p>
        ${oldScoringRows(oldAudit.components)}
      </section>
    </div>
  `;
  els.auditDialog.showModal();
}

function syncWeekOptions(weeks, selectedWeek) {
  if (!Array.isArray(weeks) || !weeks.length) return;
  const currentValues = [...els.weekSelect.options].map((option) => Number(option.value));
  if (currentValues.join(",") === weeks.join(",")) return;
  els.weekSelect.innerHTML = "";
  for (const week of weeks) {
    const option = document.createElement("option");
    option.value = String(week);
    option.textContent = `Week ${week}`;
    els.weekSelect.append(option);
  }
  els.weekSelect.value = String(selectedWeek);
}

function syncSeasonOptions(seasons, selectedSeason) {
  if (!Array.isArray(seasons) || !seasons.length) return;
  const normalized = seasons.map((season) => String(season));
  const currentValues = [...els.seasonSelect.options].map((option) => option.value);
  if (currentValues.join(",") === normalized.join(",")) return;
  els.seasonSelect.innerHTML = "";
  for (const season of normalized) {
    const option = document.createElement("option");
    option.value = season;
    option.textContent = season;
    els.seasonSelect.append(option);
  }
  els.seasonSelect.value = String(selectedSeason);
}

function newScoringRows(components) {
  if (!components?.length) {
    return `<div class="empty">No custom DST drive events have been scored for this selected week.</div>`;
  }
  return components.map((event) => `
    <article class="audit-event">
      <div>
        <strong>${escapeHtml(event.label)}</strong>
        <span>${escapeHtml(event.offense)} drive · Q${event.period || "-"} ${escapeHtml(event.clock || "")}</span>
      </div>
      <b>${signed(event.points)}</b>
      <p>${escapeHtml(event.description || event.result || "")}</p>
      ${event.takeover ? `<small>Takeover: ${escapeHtml(event.takeover)}</small>` : ""}
    </article>
  `).join("");
}

function oldScoringRows(components) {
  if (!components?.length) {
    return `<div class="empty">No old-scoring state is available for this selected week.</div>`;
  }
  return components.map((event) => `
    <article class="audit-event old-event">
      <div>
        <strong>${escapeHtml(event.label)}</strong>
        <span>${oldEventDetail(event)}</span>
      </div>
      <b>${signed(event.points)}</b>
      ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ""}
    </article>
  `).join("");
}

function oldEventDetail(event) {
  if (event.kind === "points_allowed") return "Score tier";
  if (event.kind === "sleeper_reconciliation") return "Reconciles estimate to Sleeper";
  if (event.kind === "sleeper_dst_total") return "Sleeper live scoring";
  if (event.count && event.unit !== undefined) {
    return `${fmt(event.count)} × ${signed(event.unit)}`;
  }
  return "Sleeper scoring";
}

function avatarHtml(team) {
  const initials = (team.teamName || team.manager || "?").slice(0, 2).toUpperCase();
  if (!team.avatar) return `<div class="avatar">${escapeHtml(initials)}</div>`;
  return `<img class="avatar" src="${escapeAttribute(team.avatar)}" alt="">`;
}

function recordText(record) {
  if (!record) return "record unavailable";
  const wins = [...record].filter((char) => char === "W").length;
  const losses = [...record].filter((char) => char === "L").length;
  return `${wins}-${losses}`;
}

function setLoading(isLoading) {
  els.refreshButton.disabled = isLoading;
  els.refreshButton.textContent = isLoading ? "Refreshing" : "Refresh";
}

function renderError(error) {
  const message = `<div class="empty error">${escapeHtml(error.message)}</div>`;
  els.matchups.innerHTML = message;
  els.statusDetail.textContent = "Refresh failed; retrying";
  els.statusDetail.className = "status-detail stale";
}

function fmt(value) {
  const number = Number(value || 0);
  return number.toLocaleString(undefined, { minimumFractionDigits: number % 1 ? 1 : 0, maximumFractionDigits: 2 });
}

function formatDateTime(value) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
}

function signed(value) {
  const number = Number(value || 0);
  return `${number > 0 ? "+" : ""}${fmt(number)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
