const state = {
  data: null,
  selectedTeam: null,
  timer: null,
  hasLoaded: false
};

const els = {
  leagueName: document.querySelector("#leagueName"),
  leagueAvatar: document.querySelector("#leagueAvatar"),
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
  els.leagueAvatar?.addEventListener("error", () => {
    els.leagueAvatar.removeAttribute("src");
    els.leagueAvatar.parentElement.dataset.fallback = "IW";
  });

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
  renderLeagueAvatar(data.league);
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
  if (data.health?.stale) bits.push("Using cached data");
  if (data.correction?.label) bits.push(data.correction.label);
  return bits.join(" · ");
}

function renderLeagueAvatar(league) {
  if (!els.leagueAvatar) return;
  if (league?.avatar) {
    els.leagueAvatar.src = league.avatar;
    delete els.leagueAvatar.parentElement.dataset.fallback;
    return;
  }
  els.leagueAvatar.removeAttribute("src");
  els.leagueAvatar.parentElement.dataset.fallback = "IW";
}

function renderMatchups(matchups) {
  els.matchups.innerHTML = "";
  for (const matchup of matchups) {
    const card = document.createElement("article");
    card.className = "matchup-card";
    const highScore = Math.max(...matchup.teams.map((team) => Number(team.projectedCustomTotal || 0)));
    const [leftTeam, rightTeam] = matchup.teams;
    card.innerHTML = `
      <button class="matchup-card-button" type="button" data-matchup-id="${escapeAttribute(matchup.id)}">
        ${matchupSideHtml(leftTeam, highScore, "left")}
        <span class="vs-pill">VS</span>
        ${matchupSideHtml(rightTeam, highScore, "right")}
      </button>
    `;
    card.querySelector("[data-matchup-id]").addEventListener("click", () => openMatchup(matchup));
    els.matchups.append(card);
  }
  attachAvatarFallbacks(els.matchups);
}

function matchupSideHtml(team, highScore, side) {
  if (!team) return `<div class="matchup-side ${side} empty-side"></div>`;
  const isLeader = Number(team.projectedCustomTotal || 0) === highScore;
  const meterClass = isLeader ? "winner" : "loser";
  const record = recordSummary(team);
  return `
    <div class="matchup-side ${side} ${isLeader ? "leader" : ""}">
      <div class="matchup-head">
        ${avatarHtml(team)}
        <div class="score-block">
          <strong>${fmt(team.projectedCustomTotal)}</strong>
          <span>${fmt(team.sleeperTotal)}</span>
        </div>
      </div>
      <div class="matchup-meter ${meterClass}"><span style="width:${isLeader ? 100 : 0}%"></span></div>
      <div class="matchup-main">
        <strong>${escapeHtml(team.teamName)}</strong>
        <span>${escapeHtml(record)} · ${escapeHtml(team.manager)}</span>
        <small>${team.dstTeam || "No DEF"} ${signed(team.customDstPoints)} DST</small>
      </div>
    </div>
  `;
}

function openMatchup(matchup) {
  const [leftTeam, rightTeam] = matchup.teams;
  els.auditTitle.textContent = `${state.data?.selected?.season || ""} Week ${state.data?.selected?.week || ""} Matchup`;
  els.auditBody.innerHTML = `
    <div class="matchup-detail-scoreboard">
      ${detailTeamHtml(leftTeam, "left")}
      <span class="vs-pill detail">VS</span>
      ${detailTeamHtml(rightTeam, "right")}
    </div>
    <div class="starter-section-title">Starters</div>
    <div class="starter-board">
      ${starterRowsHtml(leftTeam, rightTeam)}
    </div>
  `;
  els.auditBody.querySelectorAll("[data-player-card]").forEach((card) => {
    card.addEventListener("click", () => card.classList.toggle("expanded"));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        card.classList.toggle("expanded");
      }
    });
  });
  els.auditDialog.showModal();
  attachAvatarFallbacks(els.auditDialog);
}

function attachAvatarFallbacks(root) {
  root.querySelectorAll("img.avatar").forEach((img) => {
    img.addEventListener("error", () => {
      const fallback = document.createElement("div");
      fallback.className = "avatar";
      fallback.textContent = img.dataset.initials || "?";
      img.replaceWith(fallback);
    }, { once: true });
  });
}

function detailTeamHtml(team, side) {
  if (!team) return `<div class="detail-team ${side}"></div>`;
  return `
    <div class="detail-team ${side}">
      ${avatarHtml(team)}
      <div>
        <strong>${escapeHtml(team.teamName)}</strong>
        <span>${escapeHtml(recordSummary(team))} · ${escapeHtml(team.manager)}</span>
      </div>
      <div class="score-block">
        <strong>${fmt(team.projectedCustomTotal)}</strong>
        <span>${fmt(team.sleeperTotal)}</span>
      </div>
    </div>
  `;
}

function starterRowsHtml(leftTeam, rightTeam) {
  const maxRows = Math.max(leftTeam?.starters?.length || 0, rightTeam?.starters?.length || 0);
  if (!maxRows) return `<div class="empty">No starters available for this matchup.</div>`;
  return Array.from({ length: maxRows }, (_, index) => {
    const leftPlayer = leftTeam?.starters?.[index] || null;
    const rightPlayer = rightTeam?.starters?.[index] || null;
    const slot = leftPlayer?.slot || rightPlayer?.slot || "STARTER";
    return `
      <div class="starter-row">
        ${playerCardHtml(leftPlayer, leftTeam, "left")}
        <span class="slot-pill ${positionClass(slot)}">${escapeHtml(slot)}</span>
        ${playerCardHtml(rightPlayer, rightTeam, "right")}
      </div>
    `;
  }).join("");
}

function playerCardHtml(player, team, side) {
  if (!player || !team) return `<div class="player-card empty-player ${side}"></div>`;
  const subScore = player.isDefense ? `Sleeper ${fmt(player.sleeperScore)}` : player.team || "";
  const injury = player.injuryStatus ? `<b class="injury">${escapeHtml(player.injuryStatus)}</b>` : "";
  return `
    <div class="player-card ${side}" data-player-card role="button" tabindex="0">
      <div class="player-main">
        <strong>${escapeHtml(player.shortName || player.name)}</strong>
        <span>${escapeHtml(player.position || player.slot)} · ${escapeHtml(player.team || "")} ${injury}</span>
      </div>
      <div class="player-score">
        <strong>${fmt(player.score)}</strong>
        <span>${escapeHtml(subScore)}</span>
      </div>
      <div class="player-extra">
        <p>${escapeHtml(player.statsLine || "No scoring details available yet.")}</p>
        ${player.isDefense ? defenseAuditHtml(team) : ""}
      </div>
    </div>
  `;
}

function defenseAuditHtml(team) {
  const newAudit = team.newDstAudit || { total: team.customDstPoints, components: team.dstComponents || [] };
  const oldAudit = team.oldDstAudit || { total: team.sleeperDstPoints, components: [] };
  const impact = Number(newAudit.total || 0) - Number(oldAudit.total || 0);
  return `
    <div class="audit-total-row compact">
      <div><span>New DST</span><strong>${signed(newAudit.total)}</strong></div>
      <div><span>Old DST</span><strong>${signed(oldAudit.total)}</strong></div>
      <div><span>Impact</span><strong class="${impact >= 0 ? "positive" : "negative"}">${signed(impact)}</strong></div>
    </div>
    <div class="audit-columns compact">
      <section class="audit-column">
        <div class="audit-column-head"><span>New scoring</span><strong>${signed(newAudit.total)}</strong></div>
        ${newScoringRows(newAudit.components)}
      </section>
      <section class="audit-column">
        <div class="audit-column-head"><span>Old scoring</span><strong>${signed(oldAudit.total)}</strong></div>
        <p class="audit-note">ESPN estimate reconciled to Sleeper's live D/ST total.</p>
        ${oldScoringRows(oldAudit.components)}
      </section>
    </div>
  `;
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
  return `<img class="avatar" src="${escapeAttribute(team.avatar)}" alt="" data-initials="${escapeAttribute(initials)}">`;
}

function recordText(record) {
  if (!record) return "record unavailable";
  const wins = [...record].filter((char) => char === "W").length;
  const losses = [...record].filter((char) => char === "L").length;
  return `${wins}-${losses}`;
}

function recordSummary(team) {
  const base = `${team.wins || 0}-${team.losses || 0}${team.ties ? `-${team.ties}` : ""}`;
  return team.record ? `${base}` : base;
}

function positionClass(position) {
  return String(position || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
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
