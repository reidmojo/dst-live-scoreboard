# Deploying the DST Live Scoreboard

The app is a plain Node web service. It serves the frontend and proxies ESPN/Sleeper API calls from the same process.

## Recommended: Render

The public app repository is:

`https://github.com/reidmojo/dst-live-scoreboard`

### Option A: Manual Web Service

1. In Render, create a new Web Service from `reidmojo/dst-live-scoreboard`.
2. Use:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
3. Set environment variables:
   - `SLEEPER_LEAGUE_ID=1239299227176157184`
   - `PUBLIC_PATH=/is-it-whiskey-dst-live`
4. Open the generated Render URL plus `/is-it-whiskey-dst-live`.

### Option B: Blueprint

Use the root-level `render.yaml` in this repository as a Render Blueprint. It uses the same build/start commands and environment variables above.

## Notes

- The app has no auth and no write actions.
- Root `/` redirects to the obscure public path.
- ESPN data is provisional and unofficial; Sleeper provides league totals and starter data.
