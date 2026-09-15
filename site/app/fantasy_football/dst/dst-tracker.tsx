"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { finalGameResult, gameViewHref, playerGameForWeek, starterSchedule } from "../../../lib/dst/presentation.js";
import { playerDisplayProjection, teamLiveEstimate, matchupWinEstimate, LIVE_ESTIMATE_NOTE } from "../../../lib/dst/live-estimates.js";
import { warningGroups } from "../../../lib/dst/health.js";
import { DASHBOARD_REQUEST_TIMEOUT_MS, INITIAL_LOADING_HINT_MS, scoreRetryDelay, selectionKey } from "../../../lib/dst/loading-policy.js";
import { GameList, GameDetail, type NflGame } from "./games-view";
import styles from "./dst.module.css";

type AuditEvent = {
  kind?: string;
  label: string;
  offense?: string;
  period?: number | null;
  clock?: string;
  points: number;
  description?: string;
  result?: string;
  takeover?: string;
  count?: number;
  unit?: number;
};

type Audit = { total: number | null; components: AuditEvent[]; status?: string; issues?: string[] };

type Starter = {
  playerId: string;
  slot: string;
  name: string;
  shortName: string;
  position: string;
  team: string;
  injuryStatus: string;
  score: number;
  sleeperScore: number;
  sleeperDefaultScore: number | null;
  projectedScore: number | null;
  liveProjectedScore?: number | null;
  projectionStatus?: string;
  isDefense: boolean;
  statsLine: string;
  gameStart: string;
  gameStatus: string;
  gameStatusState: string;
  gameCompleted?: boolean;
  gameClock: string;
  gamePeriod: number;
  opponent: string;
};

type Team = {
  rosterId: number | string;
  matchupId: number | string | null;
  manager: string;
  teamName: string;
  avatar: string;
  wins: number;
  losses: number;
  ties: number;
  sleeperTotal: number;
  sleeperDefaultTotal: number | null;
  projectedCustomTotal: number;
  dstTeam: string;
  sleeperDstPoints: number;
  customDstPoints: number;
  customDstDelta: number | null;
  scoringProvisional?: boolean;
  newDstAudit: Audit;
  oldDstAudit: Audit;
  starters: Starter[];
};

type Matchup = { id: string; teams: Team[] };

type Dashboard = {
  generatedAt: string;
  servedAt?: string;
  health: {
    ok: boolean;
    stale: boolean;
    refreshing?: boolean;
    warnings: Array<{ kind?: string; label?: string; message?: string; teams?: string[] }>;
    sources?: Array<{ stale?: boolean }>;
    liveGameCount: number;
    pollIntervalMs: number;
    dataAsOf?: string;
  };
  source: { snapshot?: boolean };
  league: { id: string; name: string; avatar: string; season: string; status: string };
  selected: { season: string; week: number };
  seasons: number[];
  weeks: number[];
  correction: { status: string; label: string; finalizesAt: string | null };
  teams: Team[];
  matchups: Matchup[];
  nflGames: NflGame[];
  emptyState?: string;
};

type Selection = { season?: string; week?: string };
const API_PATH = "/fantasy_football/dst/api/dashboard";
const MY_TEAM_KEY = "r31d-dst-my-manager";
const MY_TEAM_COOKIE = "r31d_dst_my_manager";

function savedMyManager() {
  try {
    const saved = window.localStorage.getItem(MY_TEAM_KEY);
    if (saved) return saved;
  } catch {
    // Cookie fallback covers browsers that restrict local storage.
  }
  const cookie = document.cookie.split("; ").find((part) => part.startsWith(`${MY_TEAM_COOKIE}=`));
  if (!cookie) return "r31d";
  try {
    return decodeURIComponent(cookie.slice(MY_TEAM_COOKIE.length + 1));
  } catch {
    return "r31d";
  }
}

function saveMyManager(manager: string) {
  try {
    window.localStorage.setItem(MY_TEAM_KEY, manager);
  } catch {
    // Persist the preference with the cookie below when local storage is unavailable.
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${MY_TEAM_COOKIE}=${encodeURIComponent(manager)}; Max-Age=31536000; Path=/fantasy_football; SameSite=Lax${secure}`;
}

function readLocationSelection(): Selection & { matchup?: string; game?: string; view?: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    season: params.get("season") || undefined,
    week: params.get("week") || undefined,
    matchup: params.get("matchup") || undefined,
    game: params.get("game") || undefined,
    view: params.get("view") || undefined,
  };
}

function writeLocation(
  values: { season?: string | null; week?: string | null; matchup?: string | null; game?: string | null; view?: string | null },
  mode: "push" | "replace",
  state: Record<string, unknown> = {},
) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value == null || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.history[mode === "push" ? "pushState" : "replaceState"](state, "", `${url.pathname}${url.search}`);
}

export default function DstTracker() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [slowInitialLoad, setSlowInitialLoad] = useState(false);
  const [activeMatchupId, setActiveMatchupId] = useState<string | null>(null);
  const [view, setView] = useState<"matchups" | "games">("matchups");
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [defenseSelection, setDefenseSelection] = useState<{ rosterId: string; trigger: HTMLButtonElement } | null>(null);
  const [myManager, setMyManager] = useState("r31d");
  const [userTimeZone, setUserTimeZone] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const dataRef = useRef<Dashboard | null>(null);
  const pendingSelectionRef = useRef<string | null>(null);
  const requestedSelectionRef = useRef<Selection>({});
  const failureCountRef = useRef(0);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const gameHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const gameOriginRef = useRef<{ matchupId: string; triggerId: string; scrollTop: number } | null>(null);
  const auditRef = useRef<HTMLElement | null>(null);

  const loadDashboard = useCallback(async (selection: Selection = {}, canonicalize = true, preferFresh = true) => {
    const key = selectionKey(selection);
    // Safari visibility/resume events must not restart an initial load.
    if (pendingSelectionRef.current === key) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;
    pendingSelectionRef.current = key;
    const previousSelectionKey = selectionKey(requestedSelectionRef.current);
    requestedSelectionRef.current = selection;
    const timeout = window.setTimeout(() => controller.abort(new DOMException("The score update timed out. Retrying shortly.", "TimeoutError")), DASHBOARD_REQUEST_TIMEOUT_MS);
    const current = dataRef.current;
    if (current && key !== previousSelectionKey) {
      // Never show one week's scores beneath a different week's URL/selection.
      dataRef.current = null;
      setData(null);
      failureCountRef.current = 0;
    }
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (selection.season) params.set("season", selection.season);
    if (selection.week) params.set("week", selection.week);
    if (preferFresh) params.set("refresh", "1");

    try {
      const response = await fetch(`${API_PATH}${params.size ? `?${params}` : ""}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `Dashboard request failed: ${response.status}`);
      }
      const nextData = await response.json() as Dashboard;
      if (requestId !== requestIdRef.current) return;
      setUserTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
      dataRef.current = nextData;
      setData(nextData);
      failureCountRef.current = nextData.health.stale && !nextData.health.refreshing ? failureCountRef.current + 1 : 0;

      const locationState = readLocationSelection();
      // A saved default-week result may be from before a week/season rollover.
      // Resolve the default with fresh data before replacing its URL.
      if (canonicalize && (!nextData.health.stale || (selection.season && selection.week))) {
        requestedSelectionRef.current = { season: nextData.selected.season, week: String(nextData.selected.week) };
        const matchupStillExists = locationState.matchup && nextData.matchups.some((matchup) => matchup.id === locationState.matchup);
        const gameStillExists = locationState.game && nextData.nflGames.some((game) => game.id === locationState.game);
        const nextView = gameStillExists || locationState.view === "games" ? "games" : "matchups";
        writeLocation({
          season: nextData.selected.season,
          week: String(nextData.selected.week),
          matchup: nextView === "matchups" && matchupStillExists ? locationState.matchup : null,
          game: gameStillExists ? locationState.game : null,
          view: nextView === "games" ? "games" : null,
        }, "replace", window.history.state || {});
        setView(nextView);
        setActiveGameId(gameStillExists ? locationState.game || null : null);
        setActiveMatchupId(nextView === "matchups" && matchupStillExists ? locationState.matchup || null : null);
      }

      const managers = new Set(nextData.teams.map((team) => team.manager));
      const savedManager = savedMyManager();
      const preferred = managers.has(savedManager)
        ? savedManager
        : nextData.teams.find((team) => team.manager.toLowerCase() === "r31d")?.manager || savedManager;
      setMyManager(preferred);
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      if (controller.signal.aborted && controller.signal.reason?.name !== "TimeoutError") return;
      failureCountRef.current += 1;
      const reason = controller.signal.aborted ? controller.signal.reason : loadError;
      setError(reason instanceof Error ? reason.message : "Could not load the scoreboard.");
    } finally {
      window.clearTimeout(timeout);
      if (requestId === requestIdRef.current) {
        pendingSelectionRef.current = null;
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const initial = readLocationSelection();
    const start = window.setTimeout(() => void loadDashboard({ season: initial.season, week: initial.week }, true, false), 0);

    const onPopState = () => {
      const locationState = readLocationSelection();
      const current = dataRef.current;
      if (!current || locationState.season !== current.selected.season || locationState.week !== String(current.selected.week)) {
        void loadDashboard({ season: locationState.season, week: locationState.week });
        return;
      }
      const exists = current.matchups.some((matchup) => matchup.id === locationState.matchup);
      const gameExists = current.nflGames.some((game) => game.id === locationState.game);
      const nextView = gameExists || locationState.view === "games" ? "games" : "matchups";
      setView(nextView);
      setActiveGameId(gameExists ? locationState.game || null : null);
      setActiveMatchupId(nextView === "matchups" && exists ? locationState.matchup || null : null);
      setDefenseSelection(null);
    };

    window.addEventListener("popstate", onPopState);
    return () => {
      window.clearTimeout(start);
      window.removeEventListener("popstate", onPopState);
      requestIdRef.current += 1;
      abortRef.current?.abort();
      pendingSelectionRef.current = null;
    };
  }, [loadDashboard]);

  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const delay = error || !data || (data.health.stale && !data.health.refreshing)
      ? scoreRetryDelay(failureCountRef.current) : Number(data.health.pollIntervalMs || 0);
    if (loading || delay <= 0) return;
    timerRef.current = window.setTimeout(() => {
      if (!document.hidden) {
        void loadDashboard(requestedSelectionRef.current);
      }
    }, delay);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [data, error, loading, loadDashboard]);

  useEffect(() => {
    if (!loading || data) { setSlowInitialLoad(false); return; }
    const timer = window.setTimeout(() => setSlowInitialLoad(true), INITIAL_LOADING_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [loading, data]);

  useEffect(() => {
    const onVisibilityChange = () => {
      const current = dataRef.current;
      if (!document.hidden && !pendingSelectionRef.current && (!current || current.health.pollIntervalMs > 0)) {
        void loadDashboard(readLocationSelection(), true, !!current);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [loadDashboard]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if ((activeMatchupId || activeGameId) && !dialog.open) dialog.showModal();
    if (!activeMatchupId && !activeGameId && dialog.open) dialog.close();
  }, [activeMatchupId, activeGameId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (activeGameId && dialog) {
      dialog.scrollTop = 0;
      gameHeadingRef.current?.focus({ preventScroll: true });
    } else if (activeMatchupId && gameOriginRef.current?.matchupId === activeMatchupId && dialog) {
      const origin = gameOriginRef.current;
      dialog.scrollTop = origin.scrollTop;
      document.getElementById(origin.triggerId)?.focus({ preventScroll: true });
      gameOriginRef.current = null;
    }
  }, [activeGameId, activeMatchupId]);

  useEffect(() => {
    if (!defenseSelection || !auditRef.current) return;
    // Only move on an explicit card selection, never on a live score refresh.
    auditRef.current.focus({ preventScroll: true });
    auditRef.current.scrollIntoView({ block: "start", behavior: "instant" });
  }, [defenseSelection]);

  function closeDefenseAudit() {
    const trigger = defenseSelection?.trigger;
    setDefenseSelection(null);
    trigger?.focus({ preventScroll: true });
    trigger?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }

  const managers = useMemo(() => {
    if (!data) return [];
    return [...new Map(data.teams.map((team) => [team.manager, team])).values()]
      .sort((a, b) => a.teamName.localeCompare(b.teamName));
  }, [data]);

  const sortedMatchups = useMemo(() => {
    if (!data) return [];
    return data.matchups.map((matchup) => ({
      ...matchup,
      teams: [...matchup.teams].sort((a, b) => Number(b.manager === myManager) - Number(a.manager === myManager)),
    })).sort((a, b) => {
      const aMine = a.teams.some((team) => team.manager === myManager) ? 1 : 0;
      const bMine = b.teams.some((team) => team.manager === myManager) ? 1 : 0;
      return bMine - aMine;
    });
  }, [data, myManager]);

  const activeMatchup = sortedMatchups.find((matchup) => matchup.id === activeMatchupId) || null;
  const activeGame = data?.nflGames.find((game) => game.id === activeGameId) || null;
  const selectedDefense = activeMatchup?.teams.find((team) => String(team.rosterId) === defenseSelection?.rosterId) || null;

  function changeSeason(season: string) {
    writeLocation({ season, week: null, matchup: null, game: null }, "push");
    setActiveGameId(null);
    setActiveMatchupId(null);
    setDefenseSelection(null);
    void loadDashboard({ season });
  }

  function changeWeek(week: string) {
    if (!data) return;
    writeLocation({ season: data.selected.season, week, matchup: null, game: null }, "push");
    setActiveGameId(null);
    setActiveMatchupId(null);
    setDefenseSelection(null);
    void loadDashboard({ season: data.selected.season, week });
  }

  function chooseMyManager(manager: string) {
    setMyManager(manager);
    saveMyManager(manager);
  }

  function openMatchup(matchup: Matchup) {
    setDefenseSelection(null);
    setActiveMatchupId(matchup.id);
    setActiveGameId(null);
    writeLocation({ matchup: matchup.id, game: null }, "push", { ...(window.history.state || {}), dstModal: true });
  }

  function changeView(next: "matchups" | "games") {
    setView(next);
    setActiveMatchupId(null);
    setActiveGameId(null);
    setDefenseSelection(null);
    writeLocation({ view: next === "games" ? "games" : null, matchup: null, game: null }, "push");
  }

  function openGame(game: NflGame, trigger?: HTMLAnchorElement) {
    if (!data || !data.nflGames.some(candidate => candidate.id === game.id)) return;
    gameOriginRef.current = activeMatchupId && trigger
      ? { matchupId: activeMatchupId, triggerId: trigger.id, scrollTop: dialogRef.current?.scrollTop || 0 } : null;
    setView("games");
    setActiveMatchupId(null);
    setActiveGameId(game.id);
    setDefenseSelection(null);
    writeLocation({ season: data.selected.season, week: String(data.selected.week), view: "games", game: game.id, matchup: null }, "push", { ...(window.history.state || {}), dstModal: true });
  }

  function closeMatchup() {
    setDefenseSelection(null);
    if (window.history.state?.dstModal) {
      window.history.back();
      return;
    }
    setActiveMatchupId(null);
    setActiveGameId(null);
    writeLocation({ matchup: null, game: null }, "replace", window.history.state || {});
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <a className={styles.brand} href="/fantasy_football" aria-label="Back to fantasy football tools">
            <span className={styles.brandMark} aria-hidden="true">
              {data?.league.avatar ? <img src={data.league.avatar} alt="" /> : "IW"}
            </span>
            <span>
              <span className={styles.eyebrow}>Drive scoring liveboard</span>
              <strong className={styles.title}>{data?.league.name || "Is It Whiskey"}</strong>
            </span>
          </a>
          <div className={styles.controls}>
            <label>
              Season
              <select value={data?.selected.season || ""} onChange={(event) => changeSeason(event.target.value)} disabled={!data || loading}>
                {(data?.seasons || []).map((season) => <option key={season} value={season}>{season}</option>)}
              </select>
            </label>
            <label>
              Week
              <select value={data?.selected.week || ""} onChange={(event) => changeWeek(event.target.value)} disabled={!data || loading}>
                {(data?.weeks || []).map((week) => <option key={week} value={week}>WK. {week}</option>)}
              </select>
            </label>
            <label className={styles.myTeamControl}>
              My team
              <select value={myManager} onChange={(event) => chooseMyManager(event.target.value)} disabled={!managers.length}>
                {managers.map((team) => <option key={team.manager} value={team.manager}>{team.teamName}</option>)}
              </select>
            </label>
            <button
              className={styles.refreshButton}
              type="button"
              onClick={() => void loadDashboard(readLocationSelection())}
              disabled={loading}
            >
              {loading ? "Refreshing" : "Refresh"}
            </button>
          </div>
        </header>

        <section>
          <div className={styles.sectionTitle}>
            <div className={styles.viewPills} role="tablist" aria-label="Scoreboard view">
              {(["matchups", "games"] as const).map(option => <button key={option} type="button" role="tab" id={`${option}-tab`} aria-selected={view === option} aria-controls={`${option}-panel`} tabIndex={view === option ? 0 : -1} onClick={() => changeView(option)} onKeyDown={event => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === "Home" ? "matchups" : event.key === "End" ? "games" : option === "matchups" ? "games" : "matchups";
                changeView(next);
                document.getElementById(`${next}-tab`)?.focus();
              }}>{option === "matchups" ? "Matchups" : "Games"}</button>)}
            </div>
            <p>{view === "matchups" ? "Live projections · Estimated win chances" : "NFL games · Earliest kickoff first"}</p>
          </div>
          <p className={styles.estimateNote} title={LIVE_ESTIMATE_NOTE}>Sleeper-style estimates · D/ST uses a standard projection baseline.</p>
          <ScoreNotices data={data} error={error} />
          {!error && !data ? <div className={styles.empty} role="status">{slowInitialLoad
            ? "Still connecting to the score providers… We’ll retry automatically if this takes too long."
            : "Loading the league…"}</div> : null}
          <div role="tabpanel" id={`${view}-panel`} aria-labelledby={`${view}-tab`}>
          {!error && data && view === "matchups" && !sortedMatchups.length ? <div className={styles.empty}>{data.emptyState || "No matchups are available yet."}</div> : null}
          {view === "games" && data ? <GameList games={data.nflGames} timeZone={userTimeZone} onOpen={openGame} /> : <div className={styles.matchupGrid}>
            {sortedMatchups.map((matchup) => (
              <MatchupCard
                key={matchup.id}
                matchup={matchup}
                isMine={matchup.teams.some((team) => team.manager === myManager)}
                onOpen={() => openMatchup(matchup)}
              />
            ))}
          </div>}
          </div>
        </section>

        {data ? (
          <section className={styles.statusStrip} aria-live="polite">
            <span className={styles.statusLabel}>Updated</span>
            <strong>{formatDateTime(data.health.dataAsOf || data.generatedAt)}</strong>
            <span className={data.health.stale ? styles.stale : ""}>
              {data.source.snapshot ? "Saved final · " : ""}{data.correction.label}
              {data.health.pollIntervalMs <= 0 ? " · Auto-refresh paused" : ""}
            </span>
          </section>
        ) : null}

        <footer className={styles.footer}>
          <a href="/fantasy_football">Fantasy football tools</a>
          <a href="https://github.com/reidmojo/dst-live-scoreboard" target="_blank" rel="noreferrer">Scoring source</a>
        </footer>
      </div>

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-label={activeGame ? `${activeGame.teams.map(team => team.abbreviation).join(" vs ")} player performances` : "Matchup details"}
        onCancel={(event) => { event.preventDefault(); closeMatchup(); }}
        onClose={() => {
          if (activeMatchupId || activeGameId) {
            setActiveMatchupId(null);
            setActiveGameId(null);
            writeLocation({ matchup: null, game: null }, "replace", window.history.state || {});
          }
        }}
      >
        {activeGame && data ? <>
          <div className={styles.dialogHead}><div><span className={styles.eyebrow}>NFL Game · Week {data.selected.week}</span><h2 ref={gameHeadingRef} tabIndex={-1}>{(activeGame.teams.find(team => team.homeAway === "away") || activeGame.teams[0])?.abbreviation} v {(activeGame.teams.find(team => team.homeAway === "home") || activeGame.teams[1])?.abbreviation}</h2></div><button type="button" aria-label={gameOriginRef.current ? "Back to matchup" : "Close game"} onClick={closeMatchup}>{gameOriginRef.current ? "Back" : "Close"}</button></div>
          <ScoreNotices data={data} error={error} teams={activeGame.teams.map(team => team.abbreviation)} />
          <GameDetail key={`${data.selected.season}-${data.selected.week}-${activeGame.id}`} game={activeGame} timeZone={userTimeZone} myManager={myManager} week={data.selected.week} />
        </> : null}
        {activeMatchup && data ? (
          <>
            <div className={styles.dialogHead}>
              <div>
                <span className={styles.eyebrow}>Matchup</span>
                <h2>{data.selected.season} · Week {data.selected.week}</h2>
              </div>
              <button type="button" aria-label="Close matchup" onClick={closeMatchup}>Close</button>
            </div>
            <div className={styles.auditList}>
              <ScoreNotices data={data} error={error} teams={activeMatchup.teams.map(team => team.dstTeam)} />
              <p className={styles.estimateNote} title={LIVE_ESTIMATE_NOTE}>Sleeper-style estimates · D/ST uses a standard projection baseline.</p>
              <MatchupCard matchup={activeMatchup} isMine={activeMatchup.teams.some((team) => team.manager === myManager)} />
              <YetToPlaySummary matchup={activeMatchup} />
              <h3 className={styles.starterTitle}>Starters</h3>
              <div className={styles.starterBoard}>
                <StarterRows matchup={activeMatchup} nflGames={data.nflGames} selected={data.selected} onOpenGame={openGame} timeZone={userTimeZone} onSelectDefense={(team, trigger) => setDefenseSelection({ rosterId: String(team.rosterId), trigger })} />
              </div>
              {selectedDefense ? (
                <DefenseAudit team={selectedDefense} auditRef={auditRef} onClose={closeDefenseAudit} />
              ) : null}
            </div>
          </>
        ) : null}
      </dialog>
    </main>
  );
}

function ScoreNotices({ data, error, teams }: { data: Dashboard | null; error: string; teams?: string[] }) {
  const groups = warningGroups(data?.health, teams);
  const notices = [
    { title: "D/ST scoring checks", rows: groups.scoring },
    { title: "Default-score comparison checks", rows: groups.comparison },
    { title: "Saved-data notice", rows: groups.storage },
  ];
  return <>
    {data?.health.refreshing && !error ? <p className={styles.estimateNote} role="status">
      Showing saved scores from {formatDateTime(data.health.dataAsOf || data.generatedAt)}. Checking for updates…
    </p> : null}
    {error || groups.upstream.length ? <div className={`${styles.empty} ${styles.error}`} role="status">
      <strong>Score update interrupted</strong>
      <p>{error || groups.upstream.map(warning => warning.message).join(" · ")}</p>
      <span>{data ? `Last score data: ${formatDateTime(data.health.dataAsOf || data.generatedAt)}. ` : ""}Retrying automatically.</span>
    </div> : null}
    {notices.filter(notice => notice.rows.length).map(notice => <details className={styles.scoreNotice} key={notice.title}>
      <summary>{notice.title} ({notice.rows.length}){notice.rows === groups.scoring ? ` · ${[...new Set(notice.rows.flatMap(warning => warning.teams || [warning.label?.split(" ")[0]]).filter(Boolean))].join(", ")}` : ""}</summary>
      {notice.rows === groups.scoring ? <p>Some D/ST plays still need confirmation. Affected scores and win estimates may change.</p> : null}
      <ul>{notice.rows.map((warning, index) => <li key={`${warning.label}-${index}`}><strong>{warning.label}:</strong> {warning.message}</li>)}</ul>
    </details>)}
  </>;
}

function MatchupCard({ matchup, isMine, onOpen }: { matchup: Matchup; isMine: boolean; onOpen?: () => void }) {
  const highScore = Math.max(...matchup.teams.map((team) => Number(team.projectedCustomTotal || 0)));
  const odds = matchupWinEstimate(matchup.teams);
  const leftPercent = odds ? Math.round(100 * odds.left) : null;
  const rightPercent = leftPercent == null ? null : 100 - leftPercent;
  const [leftTeam, rightTeam] = matchup.teams;
  const content = (
    <>
      <div className={styles.comparison}>
        <MatchupSide team={leftTeam} highScore={highScore} side="left" winPercent={leftPercent} tied={odds?.tied} final={odds?.final} />
        <span className={styles.vsPill}>VS</span>
        <MatchupSide team={rightTeam} highScore={highScore} side="right" winPercent={rightPercent} tied={odds?.tied} final={odds?.final} />
      </div>
    </>
  );
  return (
    <article className={`${styles.matchupCard} ${isMine ? styles.myMatchup : ""}`}>
      {onOpen ? (
        <button
          className={styles.matchupButton}
          type="button"
          onClick={onOpen}
          aria-label={`${leftTeam?.teamName || "Team"} ${fmt(leftTeam?.projectedCustomTotal)} versus ${rightTeam?.teamName || "Team"} ${fmt(rightTeam?.projectedCustomTotal)}`}
        >
          {content}
        </button>
      ) : <div className={`${styles.matchupButton} ${styles.staticCard}`}>{content}</div>}
    </article>
  );
}

function MatchupSide({ team, highScore, side, winPercent, tied, final }: { team?: Team; highScore: number; side: "left" | "right"; winPercent: number | null; tied?: boolean; final?: boolean }) {
  if (!team) return <div className={styles.matchupSide} />;
  const leader = winPercent == null ? Number(team.projectedCustomTotal || 0) === highScore : winPercent >= 50;
  const projection = teamLiveEstimate(team).projected;
  const oddsLabel = tied ? "Final tie" : winPercent == null ? "Win estimate unavailable" : final ? (winPercent === 100 ? "Final winner" : "Final loser") : `Estimated win chance: ${winPercent}%`;
  return (
    <div className={`${styles.matchupSide} ${side === "right" ? styles.right : ""} ${leader ? styles.leader : ""}`}>
      <Avatar team={team} />
      <div className={styles.teamContent}>
        <span className={styles.managerHandle}>@{team.manager.replace(/^@/, "")}</span>
        <div className={styles.teamNameRow}>
          <strong className={styles.teamName} title={team.teamName}>{team.teamName}</strong>
          <div className={styles.scoreBlock}>
            <strong>{fmt(team.projectedCustomTotal)}</strong>
            <span title={LIVE_ESTIMATE_NOTE}>Proj. {comparisonScore(projection)}</span>
          </div>
        </div>
        <div className={`${styles.matchupMeter} ${leader ? "" : styles.loser}`} aria-hidden="true">
          <span style={{ width: `${winPercent ?? 0}%` }} />
        </div>
        <div className={styles.matchupMeta}>
          <span className={styles.matchupRecord}><strong className={styles.winChance} aria-label={oddsLabel} title={LIVE_ESTIMATE_NOTE}>{tied ? "Tie" : winPercent == null ? "—" : `${winPercent}%`}</strong><span>{recordSummary(team)}</span></span>
          <span title="Team total with Sleeper default DST scoring" aria-label={`Sleeper default total: ${team.sleeperDefaultTotal == null ? 'unavailable' : fmt(team.sleeperDefaultTotal)}`}>Default {comparisonScore(team.sleeperDefaultTotal)}</span>
        </div>
      </div>
    </div>
  );
}

function Avatar({ team }: { team: Team }) {
  const initials = (team.teamName || team.manager || "?").slice(0, 2).toUpperCase();
  return (
    <span className={styles.avatar} aria-hidden="true">
      <span>{initials}</span>
      {team.avatar ? <img key={team.avatar} src={team.avatar} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} /> : null}
    </span>
  );
}

function YetToPlaySummary({ matchup }: { matchup: Matchup }) {
  const [leftTeam, rightTeam] = matchup.teams;
  const left = yetToPlayDetails(leftTeam);
  const right = yetToPlayDetails(rightTeam);
  return (
    <section className={styles.yetToPlay} aria-label={`${left.count + right.count} starters yet to play across this matchup`}>
      <div className={styles.yetToPlayTeam}>
        <strong>Yet to play ({left.count})</strong>
        <span>{left.summary}</span>
      </div>
      <span className={styles.yetToPlaySpacer} aria-hidden="true" />
      <div className={`${styles.yetToPlayTeam} ${styles.yetToPlayRight}`}>
        <strong>Yet to play ({right.count})</strong>
        <span>{right.summary}</span>
      </div>
    </section>
  );
}

function yetToPlayDetails(team?: Team) {
  const yetToPlay = (team?.starters || []).filter((player) => player.gameStatusState === "pre");
  const counts = new Map<string, number>();
  for (const player of yetToPlay) {
    const position = (player.position || player.slot || "STARTER").toUpperCase();
    counts.set(position, (counts.get(position) || 0) + 1);
  }
  const positionOrder = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const summary = [...counts.entries()]
    .sort(([a], [b]) => {
      const aIndex = positionOrder.indexOf(a);
      const bIndex = positionOrder.indexOf(b);
      return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex) || a.localeCompare(b);
    })
    .map(([position, count]) => `${count} ${position}`)
    .join(", ");
  return { count: yetToPlay.length, summary: summary || "All starters have played" };
}

function StarterRows({ matchup, nflGames, selected, onOpenGame, timeZone, onSelectDefense }: { matchup: Matchup; nflGames: NflGame[]; selected?: Dashboard["selected"]; onOpenGame?: (game: NflGame, trigger: HTMLAnchorElement) => void; timeZone: string; onSelectDefense: (team: Team, trigger: HTMLButtonElement) => void }) {
  const [leftTeam, rightTeam] = matchup.teams;
  const count = Math.max(leftTeam?.starters.length || 0, rightTeam?.starters.length || 0);
  if (!count) return <div className={styles.empty}>No starters are available for this matchup.</div>;
  return Array.from({ length: count }, (_, index) => {
    const left = leftTeam?.starters[index];
    const right = rightTeam?.starters[index];
    const slot = left?.slot || right?.slot || "STARTER";
    return (
      <div className={styles.starterRow} key={`${slot}-${index}`}>
        <PlayerCard player={left} team={leftTeam} side="left" homeAway={starterSchedule(left?.team, nflGames).homeAway} nflGames={nflGames} selected={selected} onOpenGame={onOpenGame} timeZone={timeZone} onSelectDefense={onSelectDefense} />
        <span className={styles.slotPill} data-slot={slot.toUpperCase()}>{slotLabel(slot)}</span>
        <PlayerCard player={right} team={rightTeam} side="right" homeAway={starterSchedule(right?.team, nflGames).homeAway} nflGames={nflGames} selected={selected} onOpenGame={onOpenGame} timeZone={timeZone} onSelectDefense={onSelectDefense} />
      </div>
    );
  });
}

function PlayerCard({ player, team, side, homeAway, nflGames = [], selected, onOpenGame, timeZone, onSelectDefense }: { player?: Starter; team?: Team; side: "left" | "right"; homeAway: string; nflGames?: NflGame[]; selected?: Dashboard["selected"]; onOpenGame?: (game: NflGame, trigger: HTMLAnchorElement) => void; timeZone: string; onSelectDefense: (team: Team, trigger: HTMLButtonElement) => void }) {
  if (!player || !team) return <div />;
  const nflGame = playerGameForWeek(player, nflGames);
  const gameHref = gameViewHref(nflGame, selected);
  const game = playerGameDisplay(player, timeZone, homeAway, finalGameResult(player.team, nflGames));
  const pregame = player.gameStatusState === "pre";
  const final = player.gameStatusState === "post" && player.gameCompleted === true;
  const projectionTitle = final ? `Pregame projection — reference only; team estimates use the final score.${player.isDefense ? " Standard D/ST baseline." : ""}`
    : player.isDefense ? LIVE_ESTIMATE_NOTE : `Pregame projection: ${comparisonScore(player.projectedScore)}`;
  const content = (
    <>
      <div className={styles.playerTop}>
        <PlayerAvatar player={player} />
        <div className={styles.playerMain}>
          <strong title={player.name} aria-label={player.name}>{player.isDefense ? player.team : player.shortName || player.name}</strong>
          <span>{player.isDefense ? <>D/ST · <button className={styles.playerAuditButton} type="button" aria-label={`${player.name} D/ST: Open scoring audit`} aria-controls="dst-scoring-audit" onClick={event => onSelectDefense(team, event.currentTarget)}>View audit</button></> : <><span className={styles.playerPosition} data-flex={player.position !== player.slot}>{player.position || player.slot} · </span>{player.team}</>} {player.injuryStatus ? <b className={styles.injuryTag} data-status={player.injuryStatus}>{player.injuryStatus}</b> : null}</span>
        </div>
        <div className={styles.playerScore}>
          <strong aria-hidden={pregame || undefined}>{pregame ? "" : fmt(player.score)}</strong>
          <span title={projectionTitle}>Proj. {comparisonScore(playerDisplayProjection(player, final))}</span>
          {player.isDefense && !pregame ? <span title="Sleeper default DST scoring">Default {comparisonScore(player.sleeperDefaultScore)}</span> : null}
        </div>
      </div>
      <div className={`${styles.playerGame} ${player.gameStatusState === "pre" ? styles.gamePending : ""}`}>
        {game.dateTime ? <time dateTime={game.dateTime} title={timeZone || undefined}>{game.primary}</time> : <strong>{game.primary}</strong>}
        <span className={styles.playerStats}>{game.secondary.split(/,\s*/).map((stat, index) => <span className={styles.playerStat} key={`${stat}-${index}`}>{stat}</span>)}</span>
      </div>
    </>
  );
  const className = `${styles.playerCard} ${side === "right" ? styles.playerRight : ""} ${gameHref ? styles.linkedPlayerCard : ""}`;
  return <div className={className} data-completed={final || undefined}>
    {content}
    {gameHref && nflGame ? <a id={`player-game-${encodeURIComponent(String(team.rosterId))}-${encodeURIComponent(player.playerId)}`}
      className={styles.playerGameLink} href={gameHref}
      aria-label={`${player.name}: ${pregame ? "Yet to play" : `${fmt(player.score)} fantasy points`}. View ${nflGame.teams.map((entry: { abbreviation: string }) => entry.abbreviation).join(" vs ")} game, Week ${selected?.week}`}
      onClick={event => {
        if (!onOpenGame || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpenGame(nflGame, event.currentTarget);
      }} /> : null}
  </div>;
}

function PlayerAvatar({ player }: { player: Starter }) {
  const initials = (player.shortName || player.name || player.team || "?")
    .split(/\s+/)
    .map((part) => part.replace(/[^A-Za-z]/g, "")[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || player.team.slice(0, 2);
  return (
    <span className={`${styles.playerAvatar} ${player.isDefense ? styles.defenseAvatar : ""}`} aria-hidden="true">
      <span>{player.isDefense ? player.team : initials}</span>
      <img
        key={player.playerId}
        src={player.isDefense
          ? `https://sleepercdn.com/images/team_logos/nfl/${encodeURIComponent(player.playerId.toLowerCase())}.png`
          : `https://sleepercdn.com/content/nfl/players/thumb/${encodeURIComponent(player.playerId)}.jpg`}
        alt=""
        loading="lazy"
        onError={(event) => { event.currentTarget.hidden = true; }}
      />
    </span>
  );
}

function playerGameDisplay(player: Starter, timeZone: string, homeAway: string, finalResult: string) {
  const opponent = player.opponent ? ` ${homeAway === "away" ? "@" : "vs"} ${player.opponent}` : "";
  if (player.gameStatusState === "pre") {
    return {
      primary: `${formatKickoff(player.gameStart, timeZone)}${opponent}`,
      secondary: "Yet to play",
      dateTime: player.gameStart,
    };
  }
  if (player.gameStatusState === "in") {
    const liveClock = player.gamePeriod ? `${player.gamePeriod > 4 ? "OT" : `Q${player.gamePeriod}`} ${player.gameClock || ""}`.trim() : player.gameStatus || "In progress";
    return { primary: `${liveClock}${opponent}`, secondary: player.statsLine || "In progress", dateTime: "" };
  }
  if (player.gameStatusState === "post") {
    return { primary: finalResult || `Final${opponent}`, secondary: player.statsLine || "Final", dateTime: "" };
  }
  if (player.playerId === "0") return { primary: "Empty slot", secondary: "No starter selected", dateTime: "" };
  if (!player.team) return { primary: "Team unavailable", secondary: player.statsLine || "No game data", dateTime: "" };
  return { primary: "Bye week", secondary: player.statsLine || "No game scheduled", dateTime: "" };
}

function formatKickoff(value: string, timeZone: string) {
  if (!value || !timeZone) return "Scheduled";
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function DefenseAudit({ team, auditRef, onClose }: { team: Team; auditRef: RefObject<HTMLElement | null>; onClose: () => void }) {
  const impact = team.oldDstAudit.total == null ? null : Number(team.newDstAudit.total || 0) - team.oldDstAudit.total;
  return (
    <section id="dst-scoring-audit" ref={auditRef} tabIndex={-1} className={styles.dstDrilldown} aria-label={`${team.teamName} DST scoring audit`}>
      <div className={styles.drilldownHead}>
        <div><span>D/ST Audit</span><strong>{team.teamName} · {team.dstTeam || "DEF"}</strong></div>
        <button type="button" onClick={onClose}>Close audit</button>
      </div>
      <div className={styles.auditTotals}>
        <div><span>New DST</span><strong>{signed(team.newDstAudit.total)}</strong></div>
        <div><span>Sleeper default</span><strong>{signed(team.oldDstAudit.total)}</strong></div>
        <div><span>Impact</span><strong className={impact != null && impact < 0 ? styles.negative : ""}>{signed(impact)}</strong></div>
      </div>
      <div className={styles.auditColumns}>
        <AuditColumn title="New scoring" total={team.newDstAudit.total} events={team.newDstAudit.components} empty="No custom DST drive events were scored for this week." />
        <AuditColumn title="Sleeper default" total={team.oldDstAudit.total} events={team.oldDstAudit.components} empty={team.oldDstAudit.issues?.join(' ') || "No game has started for this D/ST this week."} note="Reconstructed from Sleeper stats using its fixed default DST rules. Independent of this league’s scoring settings and manual scores." />
      </div>
    </section>
  );
}

function AuditColumn({ title, total, events, empty, note }: { title: string; total: number | null; events: AuditEvent[]; empty: string; note?: string }) {
  return (
    <section className={styles.auditColumn}>
      <div className={styles.auditColumnHead}><span>{title}</span><strong>{signed(total)}</strong></div>
      {note ? <p className={styles.auditNote}>{note}</p> : null}
      {!events.length ? <div className={styles.empty}>{empty}</div> : events.map((event, index) => (
        <article className={styles.auditEvent} key={`${event.kind || event.label}-${index}`}>
          <div>
            <strong>{event.label}</strong>
            <span>{event.offense ? `${event.offense} drive · Q${event.period || "-"} ${event.clock || ""}` : oldEventDetail(event)}</span>
          </div>
          <b>{signed(event.points)}</b>
          {event.description || event.result ? <p>{event.description || event.result}</p> : null}
          {event.takeover ? <small>Takeover: {event.takeover}</small> : null}
        </article>
      ))}
    </section>
  );
}

function oldEventDetail(event: AuditEvent) {
  if (event.kind === "final_score_floor") return "League rule · Applied after final";
  if (event.kind === "special_teams_recovery" || event.kind === "dst_touchdown" || event.kind === "special_teams_touchdown_allowed") return `ESPN · Q${event.period || "-"} ${event.clock || ""}`;
  if (event.kind === "points_allowed") return "Score tier";
  if (event.kind === "sleeper_reconciliation") return "Reconciles estimate to Sleeper";
  if (event.kind === "sleeper_dst_total") return "Sleeper live scoring";
  if (event.count && event.unit !== undefined) return `${event.count.toLocaleString()} × ${signed(event.unit)}`;
  return "Sleeper scoring";
}

function recordSummary(team: Team) {
  return `${team.wins || 0}-${team.losses || 0}${team.ties ? `-${team.ties}` : ""}`;
}

function slotLabel(position: string) {
  const normalized = position.toUpperCase();
  if (normalized === "REC_FLEX") return "WT";
  if (normalized === "SUPER_FLEX") return "WRTQ";
  return position;
}

function fmt(value: number | string | undefined) {
  const number = Number(value || 0);
  return number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function comparisonScore(value: number | null | undefined) {
  return value == null ? "—" : fmt(value);
}

function signed(value: number | null) {
  if (value == null) return "—";
  const number = Number(value || 0);
  return `${number > 0 ? "+" : ""}${fmt(number)}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
}
