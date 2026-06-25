# Architecture

This repo is a small read-only Node web app. It exists to show a Sleeper league's matchup scores under a custom DST drive-scoring regime.

## Runtime Shape

- `src/server.js`
  - Serves static files from `public/`.
  - Exposes `/api/dashboard`.
  - Fetches Sleeper and ESPN data.
  - Caches upstream responses in memory.
  - Builds team totals and matchup cards.
- `src/scoring.js`
  - Converts ESPN NFL game/summary data into custom DST points.
  - Estimates old D/ST scoring components for audit display.
- `public/index.html`
  - Shell markup for the single-page app.
- `public/assets/app.js`
  - Browser state, refresh loop, selector sync, matchup rendering, and audit dialog.
- `public/assets/styles.css`
  - Dark UI styling.

## Data Sources

### Sleeper API

Base URL:

```text
https://api.sleeper.app/v1
```

Used endpoints:

- `/state/nfl`
- `/league/:league_id`
- `/league/:league_id/rosters`
- `/league/:league_id/users`
- `/league/:league_id/matchups/:week`

Sleeper provides:

- League name and season metadata.
- Rosters and owner/user metadata.
- Weekly matchup ids.
- Starters.
- Live platform points, including non-DST player scoring.
- Sleeper's live old-scoring D/ST total.

### ESPN Site APIs

Used endpoints:

```text
https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard
https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary
```

ESPN provides:

- NFL games for the selected season/week.
- Game status.
- Drives and game summary information used to estimate custom DST scoring.

ESPN is unofficial for this app. Scores should be treated as provisional until weekly corrections have settled.

## Dashboard Build Flow

1. Browser requests `/api/dashboard`.
2. Server fetches Sleeper state and league metadata.
3. Server decides the selected season/week.
4. Server fetches rosters, users, matchups, and ESPN scoreboard in parallel.
5. Server fetches ESPN summaries for games with useful play/drive data.
6. `scoreWeekFromEspn()` converts ESPN game state into custom DST scores.
7. Server combines:
   - Sleeper total score
   - Sleeper D/ST points
   - ESPN-derived custom D/ST points
8. Server returns matchup cards, audit details, selector options, correction status, and refresh guidance.

## Cache Policy

The cache is in-memory only. It resets when the process restarts or redeploys.

Current upstream TTLs:

- Sleeper NFL state: 60 seconds
- Sleeper league, rosters, users: 5 minutes
- Sleeper matchups: 30 seconds
- ESPN scoreboard: 20 seconds
- ESPN summaries: 20 seconds

If a fetch fails and an older cached value exists, the server returns the cached value and adds a warning in `health.warnings`.

If a full dashboard refresh fails but a prior dashboard exists, the server returns the last successful dashboard with `health.stale = true`.

## Refresh Policy

The server returns `health.pollIntervalMs`.

- 15 seconds when at least one selected-week NFL game is live.
- 30 seconds otherwise.

The browser schedules the next refresh from that value. Manual Refresh always triggers an immediate `/api/dashboard` call.

## Season And Week Selectors

The frontend does not hardcode the selected season/week. On first load it calls `/api/dashboard` with no query parameters and lets the server choose the latest available dashboard.

The server currently:

- Supports seasons starting in 2025.
- Reads the latest available season from Sleeper state/league metadata.
- Returns every season from 2025 through the latest available season.
- Returns all 17 fantasy weeks for prior seasons.
- Returns weeks through the active/default week for the latest season.

Week 18 is intentionally excluded.

## Correction Status

For completed NFL weeks, the server computes the first Wednesday midnight Eastern after the last selected-week NFL game. Until that timestamp, the dashboard is marked provisional. After that timestamp, it is marked finalized.

This is a status mode, not persistent storage. The app does not yet write finalized score snapshots to a database.
