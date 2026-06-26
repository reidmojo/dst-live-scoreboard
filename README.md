# DST Live Scoreboard

Live custom DST scoring dashboard for a Sleeper fantasy league.

The app combines:

- Sleeper league rosters, starters, and live non-DST scoring
- ESPN site API data for live NFL game and drive state
- A custom drive-result DST scoring model

It is intentionally read-only: no auth, no league edits, and no write actions.

## What Users See

- A matchup-first league view.
- Each team shows the custom total as the primary score.
- The normal Sleeper total is shown smaller underneath.
- Matchup cards are presented left-vs-right, similar to the Sleeper league view.
- Clicking a matchup opens starter-by-starter scoring for both teams.
- Clicking a starter expands basic player context. Clicking a DEF starter also exposes the new-vs-old DST scoring audit.
- The page refreshes automatically: every 15 seconds while NFL games are live, every 30 seconds otherwise.

## Reliability Behavior

The server keeps an in-memory cache of upstream ESPN and Sleeper responses. If a refresh fails but prior data exists, the page keeps showing the last usable dashboard and marks the status as stale instead of going blank.

Completed weeks are treated as provisional until the Wednesday midnight Eastern correction window after the last NFL game in the selected week. After that, the dashboard marks the week as finalized. The app still recomputes from current ESPN/Sleeper data on request; it does not yet persist a frozen historical archive.

## Run Locally

```bash
npm install
SLEEPER_LEAGUE_ID=1239299227176157184 npm start
```

Then open:

```text
http://localhost:3000/is-it-whiskey-dst-live
```

## Environment

- `SLEEPER_LEAGUE_ID`: Sleeper league id to display
- `PUBLIC_PATH`: optional obscure public path, defaults to `/is-it-whiskey-dst-live`
- `PORT`: optional server port, defaults to `3000`

## Deploy

This repo includes `render.yaml` for Render Blueprint deploys. A manual Render web service also works with:

- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `npm start`
- `SLEEPER_LEAGUE_ID=1239299227176157184`
- `PUBLIC_PATH=/is-it-whiskey-dst-live`

## Notes

ESPN data is provisional and may differ from later corrections. Sleeper provides league rosters, starters, and live platform scoring.

## More Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Operations](docs/OPERATIONS.md)
- [Custom DST scoring](docs/SCORING.md)
