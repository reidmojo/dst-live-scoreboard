# Live source record

- Site: https://r31d.wiki/fantasy_football/dst
- Source directory in this repository: `site/`
- Sites version: **33**
- Sites source commit: `54973075c1f20681436f792db0a9e1167d08844a`
- Source Git tree: `ad4cb70fb29dc41ed712299682cf866c3c67dcb5`
- Deployment archive SHA-256: `b550abefa42c0562d6eccec3006424c5f115a5c79148aa40eccd0f25eb595ed0`

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

Validation: this typography update passed all 9 targeted rendering/layout checks
and the production build. Production is deployed through Sites to Cloudflare;
no GitHub Actions workflow is required or added by this update.

`site/.openai/hosting.json` contains a non-secret deployment project identifier and
logical database binding, not account credentials or production database access.
Local environment files, database contents, dependency folders, build outputs,
and collected user responses are not part of the source snapshot.
