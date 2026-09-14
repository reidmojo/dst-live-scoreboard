"use client";

import { useState } from "react";
import { formatProjection } from "../../../lib/dst/presentation.js";
import { playerDisplayProjection, LIVE_ESTIMATE_NOTE } from "../../../lib/dst/live-estimates.js";
import styles from "./dst.module.css";

type NflTeam = { id?: string; abbreviation: string; displayName?: string; shortName?: string; homeAway?: string; logo?: string; score?: number };
type ScoreComponent = { key: string; label: string; points: number; count?: number; unit?: number; description?: string };
type GamePlayer = {
  playerId: string; name: string; shortName: string; position: string; team: string; owner: string | null;
  score: number | null; projectedScore: number | null; injuryStatus: string; isDefense: boolean; defaultScore?: number | null;
  liveProjectedScore?: number | null;
  compactStats: Array<{ value: string; label: string }>; components: ScoreComponent[];
};
type Drive = { id: string; team: string; result: string; summary: string; period: number | null; clock: string;
  plays: Array<{ id: string; text: string; period: number | null; clock: string; downDistance: string; isScore: boolean }> };
export type NflGame = {
  id: string; date: string; status: string; statusState: string; completed?: boolean; period: number; clock: string;
  teams: NflTeam[]; activeDrive?: { team: string; description: string; start: string; end: string } | null;
  positionGroups?: Array<{ position: string; away: GamePlayer[]; home: GamePlayer[] }>;
  latestPlay?: string | null; driveResults?: Drive[];
};

function gameTeams(game: NflGame) {
  return [game.teams.find(team => team.homeAway === "away") || game.teams[0], game.teams.find(team => team.homeAway === "home") || game.teams[1]];
}
function kickoff(game: NflGame, timeZone: string, full = false) {
  if (!timeZone || !Number.isFinite(Date.parse(game.date))) return "Kickoff TBD";
  return new Intl.DateTimeFormat(undefined, { timeZone, weekday: "short", ...(full ? { month: "short", day: "numeric" } as const : {}), hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(game.date));
}
function gameStatus(game: NflGame, timeZone: string) {
  if (game.statusState === "pre") return kickoff(game, timeZone);
  if (game.statusState === "in") {
    if (/half/i.test(game.status)) return "Halftime";
    return `${game.period > 4 ? "OT" : game.period ? `Q${game.period}` : "Live"}${game.clock ? ` · ${game.clock}` : ""}`;
  }
  return game.status || (game.completed ? "Final" : "Status unavailable");
}
function score(value: number | null | undefined) { return value == null ? "—" : formatProjection(value); }
function signed(value: number) { return `${value > 0 ? "+" : ""}${score(value)}`; }
function TeamLogo({ team }: { team?: NflTeam }) {
  return <span className={styles.nflLogo} aria-hidden="true"><span>{team?.abbreviation}</span>{team?.logo ? <img src={team.logo} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true; }} /> : null}</span>;
}

export function GameList({ games, timeZone, onOpen }: { games: NflGame[]; timeZone: string; onOpen: (game: NflGame) => void }) {
  const ordered = [...games].sort((a, b) => (Date.parse(a.date) || Infinity) - (Date.parse(b.date) || Infinity) || a.id.localeCompare(b.id));
  const days = new Map<string, NflGame[]>();
  for (const game of ordered) {
    const date = timeZone && Number.isFinite(Date.parse(game.date))
      ? new Intl.DateTimeFormat(undefined, { timeZone, weekday: "long", month: "short", day: "numeric" }).format(new Date(game.date)) : "This week";
    days.set(date, [...(days.get(date) || []), game]);
  }
  if (!games.length) return <div className={styles.empty}>No NFL games are available for this week yet.</div>;
  return <div className={styles.gameSchedule}>{[...days.entries()].map(([day, entries]) => (
    <section key={day} aria-label={day}>
      <h2 className={styles.gameDayHeading}>{day}</h2>
      <div className={styles.gameGrid}>{entries.map(game => {
        const [away, home] = gameTeams(game);
        const leaguePlayers = (game.positionGroups || []).flatMap(group => [...group.away, ...group.home]).filter(player => player.owner).length;
        return <button type="button" className={styles.nflGameCard} key={game.id} onClick={() => onOpen(game)} aria-label={`${away?.displayName || away?.abbreviation} at ${home?.displayName || home?.abbreviation}. ${gameStatus(game, timeZone)}. View player performances`}>
          <span className={styles.gameCardStatus} data-live={game.statusState === "in"}>{game.statusState === "in" ? <span className={styles.liveMarker}>LIVE</span> : null}{gameStatus(game, timeZone)}</span>
          <span className={styles.gameCardTeams}>
            {[away, home].map((team, index) => <span className={styles.gameCardTeam} key={team?.abbreviation || index}>
              <TeamLogo team={team} /><span><strong>{team?.abbreviation || "TBD"}</strong><small>{team?.shortName || team?.displayName}</small></span>
              <b>{game.statusState === "pre" ? "—" : team?.score ?? "—"}</b>
            </span>)}
          </span>
          <span className={styles.gameCardFooter}><span>{leaguePlayers ? `${leaguePlayers} league players` : "Fantasy performances"}</span><span>View game <span aria-hidden="true">›</span></span></span>
        </button>;
      })}</div>
    </section>
  ))}</div>;
}

export function GameDetail({ game, timeZone, myManager, week }: { game: NflGame; timeZone: string; myManager: string; week: number }) {
  const [away, home] = gameTeams(game);
  const [expandedPlayers, setExpandedPlayers] = useState<Set<string>>(() => new Set());
  function togglePlayer(id: string) {
    setExpandedPlayers(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  return <div className={styles.gameDetailContent}>
    <section className={styles.gameScoreHeader} aria-label="NFL game score">
      <div className={styles.gameCardStatus} data-live={game.statusState === "in"}>{gameStatus(game, timeZone)}</div>
      <div className={styles.gameBigScore}><TeamLogo team={away} /><strong>{game.statusState === "pre" ? "—" : away?.score ?? "—"}</strong><span>–</span><strong>{game.statusState === "pre" ? "—" : home?.score ?? "—"}</strong><TeamLogo team={home} /></div>
      <div className={styles.gameScoreCaption}><span>{away?.displayName || away?.abbreviation}</span><span>{home?.displayName || home?.abbreviation}</span></div>
      {game.statusState !== "pre" ? <time dateTime={game.date}>{kickoff(game, timeZone, true)}</time> : null}
    </section>
    {game.statusState === "in" && game.activeDrive?.team ? <div className={styles.gamePossession}><strong>{game.activeDrive.team} possession</strong><span>{game.activeDrive.description || game.activeDrive.end || "Drive in progress"}</span></div> : null}
    {game.statusState !== "pre" ? <details className={styles.gameDrives}>
      <summary><span><small>{game.latestPlay ? "LATEST PLAY" : "DRIVE RESULTS"}</small><span className={styles.latestPlayText}>{game.latestPlay || "View this game’s drives"}</span></span><span aria-hidden="true">⌄</span></summary>
      <div className={styles.driveList}>
        <p className={styles.gameHelper}>Drive results · Newest first</p>
        {game.driveResults?.length ? game.driveResults.map(drive => <details className={styles.gameDrive} key={drive.id}>
          <summary><strong>{drive.team}</strong><span><b>{drive.result}</b><small>{drive.summary}</small></span><small>{drive.period ? `Q${drive.period}` : ""} {drive.clock}</small></summary>
          {drive.plays.length ? drive.plays.map(play => <div key={play.id} className={styles.drivePlay} data-scoring={play.isScore}><small>{[play.period ? `Q${play.period}` : "", play.clock, play.downDistance].filter(Boolean).join(" · ")}</small><p>{play.text}</p></div>) : <p className={styles.gameHelper}>Play details aren’t available for this drive yet.</p>}
        </details>) : <p className={styles.gameHelper}>Drive results aren’t available yet.</p>}
      </div>
    </details> : null}
    <div className={styles.gameFantasyHeading}><h3>Fantasy by position</h3><span>Week {week}</span></div>
    <div className={styles.gameColumnsLabel}><span>{away?.abbreviation} · Away</span><span>{home?.abbreviation} · Home</span></div>
    <p className={styles.gameHelper} title={LIVE_ESTIMATE_NOTE}>Sleeper-style projections · Standard D/ST baseline. Tap a score for its breakdown.</p>
    {game.positionGroups?.length ? game.positionGroups.map(group => <section key={group.position} className={styles.gamePositionGroup} aria-label={`${group.position} performances`}>
      <h4 className={styles.gamePositionLabel} data-position={group.position}><span>{group.position}</span></h4>
      {Array.from({ length: Math.max(group.away.length, group.home.length) }, (_, index) => <div className={styles.gamePlayerPair} key={`${group.away[index]?.playerId || "empty"}-${group.home[index]?.playerId || "empty"}`}>
        <GamePlayerRow player={group.away[index]} side="away" pregame={game.statusState === "pre"} final={game.statusState === "post" && game.completed === true} myManager={myManager} expanded={expandedPlayers.has(group.away[index]?.playerId)} onToggle={togglePlayer} />
        <GamePlayerRow player={group.home[index]} side="home" pregame={game.statusState === "pre"} final={game.statusState === "post" && game.completed === true} myManager={myManager} expanded={expandedPlayers.has(group.home[index]?.playerId)} onToggle={togglePlayer} />
      </div>)}
    </section>) : <div className={styles.empty}>Player performances aren’t available yet. They’ll appear when the next update arrives.</div>}
  </div>;
}

function GamePlayerRow({ player, side, pregame, final, myManager, expanded, onToggle }: { player?: GamePlayer; side: string; pregame: boolean; final: boolean; myManager: string; expanded: boolean; onToggle: (id: string) => void }) {
  if (!player) return <div aria-hidden="true" />;
  const projectionTitle = final ? `Pregame projection — reference only; team estimates use the final score.${player.isDefense ? " Standard D/ST baseline." : ""}`
    : player.isDefense ? LIVE_ESTIMATE_NOTE : `Pregame projection: ${score(player.projectedScore)}`;
  return <article className={styles.nflPlayer} data-side={side} data-completed={final || undefined} aria-label={`${player.name}, ${player.team}`}>
    <details className={styles.nflPlayerDetails} open={expanded}>
      <summary aria-label={`${player.name}, ${pregame ? "Yet to play" : `${score(player.score)} fantasy points${final ? ", Final" : ""}`}. ${expanded ? "Hide" : "Show"} scoring breakdown`} onClick={event => { event.preventDefault(); onToggle(player.playerId); }}>
        <span className={styles.nflPlayerIdentity}><strong title={player.name}>{player.shortName}</strong><small className={styles.nflOwner} data-mine={player.owner?.replace(/^@/, "").toLowerCase() === myManager.replace(/^@/, "").toLowerCase()} title={player.owner || undefined}>{player.owner ? `@${player.owner.replace(/^@/, "")}` : "\u00a0"}</small></span>
        <span className={styles.nflFantasyScore}><strong aria-hidden={pregame || undefined}>{pregame ? "" : score(player.score)}</strong><small title={projectionTitle}>Proj. {score(playerDisplayProjection(player, final))}</small>{player.isDefense && !pregame ? <small>Default {score(player.defaultScore)}</small> : null}</span>
      </summary>
      <div className={styles.gameScoringDetails}>
        {player.components.length ? player.components.map((entry, index) => <div key={`${entry.key}-${index}`} className={styles.gameComponent} data-adjustment={entry.key === "sleeper_adjustment"}>
          <span>{entry.label}{entry.count != null && entry.unit != null ? <small>{entry.count} × {signed(entry.unit)}</small> : null}</span><b>{signed(entry.points)}</b>
        </div>) : <p>{pregame ? "Scoring begins at kickoff." : player.score == null ? "Scoring details are unavailable." : "No scoring events recorded."}</p>}
      </div>
    </details>
    {player.compactStats.length ? <p className={styles.gameCompactStats}>{final ? <span className={styles.playerFinal}>Final</span> : null}{player.compactStats.map((stat, index) => <span key={`${stat.label}-${index}`}><b>{stat.value}</b> <small>{stat.label}</small></span>)}</p>
      : <p className={styles.gamePlayerStatus}>{final ? <><span className={styles.playerFinal}>Final</span> · </> : null}{pregame ? "Yet to play" : player.score == null ? "Stats unavailable" : "No stats recorded"}{player.injuryStatus ? <b className={styles.injuryTag} data-status={player.injuryStatus}>{player.injuryStatus}</b> : null}</p>}
  </article>;
}
