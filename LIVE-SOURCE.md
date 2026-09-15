# Live source record

- Site: https://r31d.wiki/fantasy_football/dst
- Source directory in this repository: `site/`
- Sites version: **35**
- Sites source commit: `af68a9a22feb1e9606d317b55d7d10f5ead519f5`
- Source Git tree: `ac1de483736821a047a5af9c2468e6e0abe461f9`
- Submitted deployment archive SHA-256: `b72502ea2d8885d6566c9315b975146f8448a60b58552325c2b48d24126f0050`

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

- Calculate team actuals from individual non-D/ST starters plus our D/ST score
  exactly once. Sleeper commissioner team-total overrides do not feed our scores,
  default comparison, projections, or win chances. Player stat corrections still
  flow through; bench players and empty slots do not contribute.
- Version team aggregation independently and recalculate older cached dashboards
  and finalized snapshots that could contain double-counted commissioner edits.
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

Validation: all 238 regression checks, TypeScript checks, and the production
build passed. Local endpoint checks verified all 10 team totals against the
individual Sleeper starter scores plus our D/ST result. Regression coverage checks
positive, negative and zero overrides, stat corrections, estimates and old saved
totals. Production is deployed through Sites
to Cloudflare; no GitHub Actions workflow is required or added by this update.

`site/.openai/hosting.json` contains a non-secret deployment project identifier and
logical database binding, not account credentials or production database access.
Local environment files, database contents, dependency folders, build outputs,
and collected user responses are not part of the source snapshot.
