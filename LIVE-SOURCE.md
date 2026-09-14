# Live source record

- Site: https://r31d.wiki/fantasy_football/dst
- Source directory in this repository: `site/`
- Sites version: **32**
- Sites source commit: `25a51eacc2e68dbad07cd23231e1b103057a7f92`
- Source Git tree: `f56ec2b32514e4db35c69da7ba56da0adf5fac76`
- Deployment archive SHA-256: `7045b6c2b691504233a12a46cad0ef3da6d18832fe783d3a821c61f20bd3637d`

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

Validation: this update passed all 16 targeted presentation/rendering checks,
TypeScript checks, and the production build. Result labels were also checked
against the current scoreboard data. Production is deployed through Sites to Cloudflare;
no GitHub Actions workflow is required or added by this update.

`site/.openai/hosting.json` contains a non-secret deployment project identifier and
logical database binding, not account credentials or production database access.
Local environment files, database contents, dependency folders, build outputs,
and collected user responses are not part of the source snapshot.
