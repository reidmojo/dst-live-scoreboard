# Live source record

- Site: https://r31d.wiki/fantasy_football/dst
- Source directory in this repository: `site/`
- Sites version: **31**
- Sites source commit: `d47de6f86b7b4171e93b7c9101eb5bf4ee4edbee`
- Source Git tree: `7433af63188530f08ffbba58a148902b2f8d9a6b`
- Deployment archive SHA-256: `b2e0349e3a71a29acf91f49fe7cf9a57bf4a706ec7e22b8ffce634c3b0d5b8fb`

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

- Distinguish upstream delays from scoring checks; show compact, team-specific
  scoring notices without weakening finalization safeguards.
- Anchor portrait-mobile scores toward the center gutter (left column right,
  right column left), preserving desktop and landscape layouts. Keep projections
  centered beneath each score, align player details, and wrap whole stat tokens.
- Restore mirrored away/home alignment in Games and wrap long fantasy team names.
- Live player/team projections and Sleeper-style pregame/live win estimates.
- Original projection shown as a reference after a player's game is final;
  team forecasts and odds still use the actual score.
- Blank pregame player scores and muted completed-player cards.
- Both Matchups and Games views, scoring audits, two-decimal fantasy points,
  mobile layout, and existing scoring reliability checks.

Validation: the portrait-only correction passed all 8 targeted rendering/layout
checks and the production build. The preceding release passed 208 automated tests
and TypeScript checks. Production is deployed through Sites to Cloudflare;
no GitHub Actions workflow is required or added by this update.

`site/.openai/hosting.json` contains a non-secret deployment project identifier and
logical database binding, not account credentials or production database access.
Local environment files, database contents, dependency folders, build outputs,
and collected user responses are not part of the source snapshot.
