# DST Live Scoreboard

## Current live site — start here

The current app is live at [r31d.wiki/fantasy_football/dst](https://r31d.wiki/fantasy_football/dst).
Its complete, auditable source is in [`site/`](site/), including the scoring engine,
responsive UI, tests, database schema/migrations, and locked dependencies.
The root-level Node/Render app below is preserved as **legacy code**; it does not
power the current site.

### Audit the running code

- [Custom D/ST scoring engine](site/lib/dst/scoring.js)
- [Data fetching and team totals](site/lib/dst/dashboard.js)
- [Sleeper-style projections and win estimates](site/lib/dst/live-estimates.js)
- [Projection model provenance and limitations](site/docs/dst-live-estimates.md)
- [Matchups UI](site/app/fantasy_football/dst/dst-tracker.tsx) and [Games UI](site/app/fantasy_football/dst/games-view.tsx)
- [Automated tests](site/tests/)
- [Live source/deployment record](LIVE-SOURCE.md)

The app uses React/TypeScript and Vinext/Vite, a JavaScript scoring engine on
Cloudflare Workers, and Cloudflare D1 (SQLite). Sleeper supplies league/player data;
ESPN supplies game and play-by-play data. Actual D/ST scores use our custom rules.
The temporary win estimates reproduce Sleeper's public model, with a standard
D/ST projection baseline. They are not official Sleeper win probabilities.

### Run the current app locally

Use Node 22.13 or newer, then:

```bash
cd site
npm ci
npm run dev
```

Open `/fantasy_football/dst` on the local URL printed by the server. D1 is emulated
locally; apply the SQLite migrations in `site/drizzle/` to initialize durable
storage. The DST endpoint can compute from its upstream providers while its
cache/snapshot storage is unavailable. Do not connect local development to the
production database.

To run the tests and build without using GitHub Actions:

```bash
node --test tests/*.test.mjs
npm run build
```

Publishing happens through Sites to Cloudflare, independently of GitHub Actions.
Pushing this repository alone does not publish the current site. The `site/` folder
is an exact source snapshot of the deployment identified in `LIVE-SOURCE.md`.
No environment files, credentials, local databases, or collected survey responses
are included. The full shared site project is retained so its framework and tests
remain auditable alongside the DST feature.

---

## Legacy Node/Render app

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
