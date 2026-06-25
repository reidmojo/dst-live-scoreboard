# Deploying the DST Live Scoreboard

The app is a plain Node web service. It serves the frontend and proxies ESPN/Sleeper API calls from the same process.

## Recommended: Render

1. Push this `dst-live-scoreboard` directory to a GitHub repository.
2. In Render, create a new Web Service from that repository.
3. Use:
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Set environment variables:
   - `SLEEPER_LEAGUE_ID=1239299227176157184`
   - `PUBLIC_PATH=/is-it-whiskey-dst-live`
5. Open the generated Render URL plus `/is-it-whiskey-dst-live`.

The included `render.yaml` can also be used as a Render Blueprint.

## Notes

- The app has no auth and no write actions.
- Root `/` redirects to the obscure public path.
- ESPN data is provisional and unofficial; Sleeper provides league totals and starter data.
