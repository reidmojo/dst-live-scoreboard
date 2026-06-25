# Operations

This document is written for humans and coding agents maintaining the public DST live scoreboard.

## Public Repo

```text
https://github.com/reidmojo/dst-live-scoreboard
```

The public repo should contain only the standalone app:

- `README.md`
- `DEPLOY.md`
- `package.json`
- `render.yaml`
- `src/`
- `public/`
- `docs/`

## Render Deployment

Recommended Render service source:

```text
reidmojo/dst-live-scoreboard
```

Manual web service settings:

- Runtime: `Node`
- Build Command: `npm install`
- Start Command: `npm start`
- Environment:
  - `SLEEPER_LEAGUE_ID=1239299227176157184`
  - `PUBLIC_PATH=/is-it-whiskey-dst-live`

The repo also includes `render.yaml` for Blueprint deploys.

## Reconnecting Render To The Public Repo

This requires Render account access and cannot be done with GitHub credentials alone.

In the Render dashboard:

1. Open the existing `dst-live-scoreboard` web service.
2. Go to Settings.
3. Find the repository/source connection.
4. Disconnect or change the existing `reidmojo/codex_projects` source.
5. Select `reidmojo/dst-live-scoreboard`.
6. Confirm the branch is `main`.
7. If Render asks for a root directory, leave it blank because the public repo root is the app root.
8. Trigger a manual deploy.

If changing the source is unavailable in the existing service, create a new Render web service from `reidmojo/dst-live-scoreboard` and copy the environment variables above.

## Free Plan Caveat

Render's free web services spin down after inactivity and can be slow on the first request after sleeping. For game-day reliability, use an always-on Render plan or another always-on Node host.

## Weekly Correction Window

The dashboard labels completed weeks as provisional until Wednesday midnight Eastern after the last NFL game in the selected week. After that, it labels the selected week finalized.

Current limitation:

- Finalization is computed at request time.
- No database or durable archive is written.
- A redeploy or process restart clears the in-memory cache but not the ability to recompute scores from upstream APIs.

Future durable finalization options:

- Render Cron Job hitting a protected finalize endpoint.
- A small database table keyed by `season-week-roster`.
- A committed JSON artifact generated after corrections settle.

## Refresh And Cache Expectations

Browser polling:

- Live games: 15 seconds
- No live games: 30 seconds

Server cache TTLs:

- ESPN scoreboard and summaries: 20 seconds
- Sleeper matchups: 30 seconds
- Sleeper NFL state: 60 seconds
- Sleeper league, rosters, users: 5 minutes

If ESPN or Sleeper fails temporarily, the server returns cached/stale data when available and the UI says so in the status row.

## Local Smoke Test

```bash
npm install
PORT=4177 SLEEPER_LEAGUE_ID=1239299227176157184 npm start
```

Open:

```text
http://localhost:4177/is-it-whiskey-dst-live
```

Useful checks:

- Page loads without console errors.
- Season selector is populated by API data.
- Week selector is populated by API data.
- Status row shows refresh interval and correction status.
- Clicking a matchup team opens the DST audit.
- Footer Source link points to the public repo.

## Publishing From The Monorepo Workspace

The development workspace may still contain a multi-project repo. To publish only this app:

```bash
git subtree split --prefix=dst-live-scoreboard -b dst-live-scoreboard-public
git push -u dst-live-public dst-live-scoreboard-public:main
```

`dst-live-public` should point to:

```text
https://github.com/reidmojo/dst-live-scoreboard.git
```
