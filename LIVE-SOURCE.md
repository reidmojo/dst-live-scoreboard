# Live source record

- Site: https://r31d.wiki/fantasy_football/dst
- Source directory in this repository: `site/`
- Sites version: **30**
- Sites source commit: `22ae388da67ab6c6c418ba5d0f70f187dbd51820`
- Source Git tree: `8121e5e3ad477110b22b7d83d5d678b09ef110a5`
- Deployment archive SHA-256: `90efd67bdfd3ba2a71bfe94731fc1b364e542c2d9f5da8ce04c88f2df8a626ef`

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
- Anchor mobile scores to their team's edge, keep projections centered beneath
  each score, align player details, and wrap stat tokens without splitting them.
- Restore mirrored away/home alignment in Games and wrap long fantasy team names.
- Live player/team projections and Sleeper-style pregame/live win estimates.
- Original projection shown as a reference after a player's game is final;
  team forecasts and odds still use the actual score.
- Blank pregame player scores and muted completed-player cards.
- Both Matchups and Games views, scoring audits, two-decimal fantasy points,
  mobile layout, and existing scoring reliability checks.

Validation before publishing: 208 automated tests, TypeScript checks, and the
production build passed. Production is deployed through Sites to Cloudflare;
no GitHub Actions workflow is required or added by this update.

`site/.openai/hosting.json` contains a non-secret deployment project identifier and
logical database binding, not account credentials or production database access.
Local environment files, database contents, dependency folders, build outputs,
and collected user responses are not part of the source snapshot.
