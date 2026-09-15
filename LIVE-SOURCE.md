# Live source record

- Site: https://r31d.wiki/fantasy_football/dst
- Source directory in this repository: `site/`
- Sites version: **34**
- Sites source commit: `9d72b21893e8223eac1fb4dd05a19fdfc7e717b0`
- Source Git tree: `19511c677746bb720f48a8df346255797994b73b`
- Submitted deployment archive SHA-256: `9117e7fa2d8506220957ff31296768af6e4280239b573434f75f01715a08767a`

The `site/` subtree is copied byte-for-byte from the tracked source used to build
this Sites release. It is not a rewrite or a separately maintained implementation.
GitHub's outer commit differs because it also includes the historical Render app
and this public documentation. Verify the source subtree with:

```bash
git rev-parse HEAD:site
```

The output must equal the source Git tree above. This verifies the published
source snapshot against the release record; it is not independent server-side
attestation of what Cloudflare is executing.

## Included changes

- Cache usable provisional scores with their warnings and original timestamps,
  serve saved scores while refreshing, and keep strict finalization safeguards.
- Bound provider, storage, and dashboard waits; protect background refreshes from
  browser disconnects and recover from expired shared work. Add stage diagnostics
  without logging request headers, bodies, or league rosters.
- Shorter initial-load timeouts and bounded retry backoff; returning to a mobile
  tab does not interrupt an active request. Preserve week selection on retries.
- Compact Games stat lines use YD/TD after CMP/CAR/REC, including cached historical
  results; expanded scoring breakdowns retain descriptive labels.
- Matchup player cards link to the selected week's NFL game with Back navigation
  and a separate D/ST audit control. Empty/bye slots do not invent game links.
- Consistent larger player names in Matchups and Games: 1.0625rem (17px with
  default browser settings), with no portrait or landscape mobile size reduction.
- Compact starter headers keep names and scores on one mirrored row, truncating
  long names while retaining the full name in accessibility text and a tooltip.
- Final NFL result lines include W/L/T and both scores from the player's team
  perspective, using `vs` at home and `@` away; unavailable scores are not invented.
- Distinguish upstream delays from scoring checks; show compact, team-specific
  scoring notices without weakening finalization safeguards.
- Anchor portrait-mobile team totals toward the center gutter (left column right,
  right column left), preserving desktop and landscape totals. Keep projections
  centered beneath each score, align player details, and wrap whole stat tokens.
- Restore mirrored away/home alignment in Games and wrap long fantasy team names.
- Live player/team projections and Sleeper-style pregame/live win estimates.
- Original projection shown as a reference after a player's game is final;
  team forecasts and odds still use the actual score.
- Blank pregame player scores and muted completed-player cards.
- Both Matchups and Games views, scoring audits, two-decimal fantasy points,
  mobile layout, and existing scoring reliability checks.

Validation: all 230 regression checks, TypeScript checks, and the production
build passed. Local endpoint checks verified saved-first loading followed by a
fresh update with scoring warnings intact. Production is deployed through Sites
to Cloudflare; no GitHub Actions workflow is required or added by this update.

`site/.openai/hosting.json` contains a non-secret deployment project identifier and
logical database binding, not account credentials or production database access.
Local environment files, database contents, dependency folders, build outputs,
and collected user responses are not part of the source snapshot.
