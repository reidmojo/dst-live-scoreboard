# DST readiness review — September 9, 2026

This review covers https://r31d.wiki/fantasy_football/dst. The sections below record the original review and later changes. The latest Sleeper comparison behavior is documented in [Sleeper default DST](SLEEPER-DEFAULT-DST.md), which supersedes the original league-settings comparison described below. The original production baseline was Sites version 13, source commit `826cccfec04034bc21f4bc32796df9d6f619f100`.

## Verdict

The existing service handled ten concurrent requests successfully, but its scoring and refresh recovery needed fixes before treating it as game-ready. The changes below are prepared together with an additive D1 migration for shared last-good dashboards. There is no hosting-plan upgrade or league configuration change.

## 1. Desktop and mobile

Checked production and the updated app in a browser. Checked matchup list, starter dialog, DST audit, season/week selection, and shareable matchup URLs. The updated layout was checked at 320px and 390px phone widths and 1440px desktop width, including three-digit nonzero historical scores. Page and dialog widths did not overflow. Mobile score labels and projections are larger; names and scores have separate rows. Touch controls retain a 44px minimum. No JavaScript errors appeared in the final browser check. This is responsive browser QA, not a physical iOS/Android device lab.

## 2. Capacity and update infrastructure

The live page is a Sites/Cloudflare Worker with D1, not the older Render Node deployment described in the public repo. Ten simultaneous production dashboard requests all returned HTTP 200, ten rosters, and sixteen scheduled games, in 1.58–2.36 seconds. This was a bounded pregame burst, not a guarantee of provider uptime or a geographically distributed load test.

The update adds:

- Per-worker coalescing of whole-dashboard and upstream requests.
- A shared D1 last-good dashboard, fresh for 10 seconds, keyed by explicit season/week and scoring version. Expired in-memory entries check for newer shared data. Cached scores survive worker replacement and are clearly marked stale during outages.
- An 8-second timeout per provider attempt; one retry for transient errors, no immediate retry of HTTP 429 or other 4xx responses.
- 15-second browser polling during live games and within 15 minutes of scheduled kickoff. Other scheduled games poll every minute. After every game in the selected week is confirmed final, polling stays at one minute for a ten-minute grace period, then becomes hourly while corrections are open; saved final results pause.
- Automatic retry after initial-load and refresh failures. Manual Refresh remains usable after a failed initial load. Hidden tabs resume when visible. Browser requests time out after 30 seconds.
- Receipt timestamps for each provider response and a visible delay/error notice. The displayed data timestamp does not become fresh merely because old data was served again.

There is no required laptop process or background job for live updates: viewers request the Worker, which refreshes cached source data. Final snapshots are saved when requested after the Wednesday-midnight Eastern correction cutoff; this is not an unattended scheduled finalizer.

The postgame grace period starts when the app first observes all games confirmed final, since the feed's scheduled date is kickoff rather than the final whistle. The observation is stored in the shared dashboard cache and survives browser reloads and worker replacement. A different week/slate or an observed reopened game starts a fresh grace period. Failed or stale updates keep retrying at least once a minute. Manual Refresh and returning to a visible tab can still fetch corrections between hourly polls; API cache lifetimes stay short. All timers require an open, visible page.

## 3. Sleeper/ESPN transmission and reconciliation

The 2026 league is `1389707754565808128`, linked through `previous_league_id` from the 2025 league. The name may change without breaking rollover. The ESPN slate correctly includes New England at Seattle at 8:20 p.m. Eastern on September 9.

Compared all ten current team totals and all 110 starter scores with the direct Sleeper matchup response: zero differences. They were pregame zeroes. Completed 2025 Week 1 was also loaded through the updated app to validate nonzero totals, custom DST, old-DST breakdowns, and durable final snapshots.

The invariant is `custom total = official Sleeper total - starting Sleeper DST + custom DST`. Commissioner overrides (including zero) are preserved. Missing starter points fail rather than being silently treated as zero. An absent weekly total never uses the roster's cumulative season points. Empty starter slots keep their position. Historical player teams are resolved from game boxscores rather than current metadata.

The old-DST audit now uses Sleeper weekly stats times league settings, reconciled to the official matchup total. Example: HOU in 2025 Week 1 is 3 sacks + 1 forced fumble + 1 point-allowed tier + 2 fumble-recovery points = 7, matching Sleeper. The old ESPN text estimate had counted an extra forced fumble and needed an unexplained -1 adjustment.

## 4. Drive scoring

The rates are unchanged: offensive TD -1, made FG -0.5; takeover own 1–19 +1, own 20–50 +1.5, opponent 49–20 +2.5, opponent 19–1 +3.5; return TD +6; safety +2 plus the applicable actual free-kick possession bucket.

Fixed active-next-drive takeover latency, duplicate current/previous records, missed/blocked field-goal classification, defensive and special-teams touchdown attribution, conversion-text false positives, halftime/overtime kickoff buckets, and unknown/invalid field positions. Return touchdowns are deduplicated by play ID across the drive and scoring-play feeds. Scoring-play counts are checked independently against offensive TD/FG drive results. Unknown or incomplete data is surfaced for reconciliation.

The regression suite includes all field-position boundaries, active drives, duplicates, missing points, commissioner overrides, missed and blocked kicks, safeties, end-of-half/game, overtime boundaries, return touchdowns outside drives, offensive recovery TDs, conversion returns, and provider timeout/rate-limit/outage scenarios. A captured ESPN fixture replays all 323 completed drives from all sixteen 2025 Week 1 games; the scoring-play and drive feeds reconcile. Moving the final completed drive into ESPN's active collection preserves the totals. Hand-checked audit examples include HOU 6.5 and CHI 12.5.

Unhealthy or unresolved data is never newly finalized. Snapshots from the previous scoring version are recomputed, rather than silently retaining known old scoring logic.

## Evidence and limits

The complete project test suite has 72 passing tests; the public scorer has 40 passing regression/replay tests. The production-compatible build and TypeScript check succeed. Cloudflare runtime declarations were generated to make the Worker typecheck reproducible. Targeted lint has zero errors and only existing image-optimization warnings.

This does not promise zero discrepancies against future official corrections. Sleeper and ESPN publish asynchronously, ESPN's site feed is unofficial, and an incorrect upstream play can be faithfully transmitted. The app now makes delayed, incomplete, and unreconciled states visible. The first actual 2026 live drive remains unobserved in this pregame review. In-progress behavior was tested using fixtures and provider-failure simulations.

## Source and release

`reidmojo/dst-live-scoreboard/src/scoring.js` is mirrored byte-for-byte with this project's `lib/dst/scoring.js`. The public repo's Node/Render UI remains the legacy implementation. This project's React/Worker/D1 code is what deploys to r31d.wiki. A push to the public repo alone does not update the live site.

Publication needs the validated Worker and the additive `dst_live_cache` migration. Afterwards, verify the public API reports scoring version `2026-09-09.2`, `health.ok: true`, the correct league/slate, and all ten successful concurrent requests. Rollback can use the previous Sites version; the new table is additive and harmless to that version, although rollback restores the known scoring/retry defects.

## Follow-up: retained possession and special-teams recoveries

Scorer `2026-09-09.3` implements the collaborators' approved possession rules. A same-play scrimmage double turnover ending with the original offense earns neither DST a takeover bucket. A turnover after a subsequent offensive snap remains a separate possession. Punt/kickoff recoveries by the kicking team earn the normal resulting-possession bucket, with no receiving-side mirror penalty. Ordinary kickoff receipts remain zero; return TDs remain +6 only. Scoring-version cache isolation prevents reuse of older totals. No database migration is needed for this follow-up.

Validation: 106 application tests and 74 matching public scorer tests pass, including 34 new possession cases. The Week 1 replay now includes 2,897 ESPN play records across the same 323 drives/16 games. Its only changed team total is TEN 10.5 → 13.0, adding +2.5 for the muffed punt recovered at DEN 24. Separate ESPN excerpts cover ARI's October 21, 2024 interception fumbled back to ARI and SEA's January 18, 2015 onside recovery at midfield. The SEA example validates use of the ensuing offensive drive despite misleading play-end team/position metadata. Build and TypeScript checks pass; targeted lint has zero errors and three existing image warnings.

New recovery audit rows identify ESPN and show the event quarter/clock. Missing recovery positions and recognized incomplete multiple-turnover ownership stay provisional. Fragmented plays with different IDs, absent kick evidence, and contradictory replay/scoring metadata remain documented limitations; these tests do not establish a complete rulebook or independent official-feed validator.

## Follow-up: touchdowns conceded by special teams

Scorer `2026-09-09.4` gives the scoring DST +6 and the conceding DST -1 for recognized special-teams touchdowns: kick/punt returns, kicking-team recoveries for TDs, and blocked/missed-field-goal or free-kick returns. Neither side receives a takeover bucket on the TD. Pick-sixes and ordinary defensive fumble-return TDs remain +6 with no deduction against the conceding offense's DST. Non-TD kick recoveries retain their possession bucket with no negative mirror penalty.

The -1 uses a dedicated ESPN audit event, deduplicated with the +6 by play ID. Kick-phase evidence survives abbreviated scoring descriptions and different arrival times of the drive/scoring flags. A nullified TD drops both entries; a No Play on the appended conversion does not revoke the preceding touchdown. Conflicting provider revisions and missing kick context remain documented limitations.

Validation adds 21 focused tests for 127 application tests and 95 public scorer tests total. Real ESPN fixtures cover DeeJay Dallas's 2024 ARI–BUF kickoff-return TD (+6 ARI / -1 BUF), Cody Davis's 2023 NE–DEN kickoff-fumble TD (+6 NE / -1 DEN), and Grant Stuard's 2023 IND–TEN blocked-punt TD (+6 IND / -1 TEN). These are event amounts, not game totals. All 32 team totals in the existing 2025 Week 1 replay remain unchanged from scorer .3, since its specific new TD cases occur in the separate fixtures. No database migration is required; prior-version cached/final snapshots recompute under the new global version.

## Follow-up: final DST floor of -4

Scorer `2026-09-09.5` applies a -4 minimum separately to each NFL team/game after ESPN confirms a completed final status. Live scores remain raw, even below -4 or at a zero clock. The scorer first reconstructs raw event points, then derives a positive adjustment only when a final score needs the floor. Raw points and the adjustment remain in team/game data, matchup audits, and persisted dashboard JSON. The audit adds one final league-rule row after the original events; lineup and matchup totals use the displayed result.

Corrections always recalculate raw events before deriving the floor. For example, raw -6 corrected upward to -5.5 still displays -4; the adjustment shrinks from +2 to +1.5. Corrections above -4 remove it. Reopening a game before the existing correction freeze removes the floor while live. The Wednesday freeze policy is unchanged. A new scoring version invalidates older cache/snapshot results; no schema migration is needed. Provider issues remain visible and prevent new final snapshots even if the displayed game score is floored.

Validation: 151 application tests and 118 public scorer tests pass. New coverage includes 23 scorer cases for live/final status, overtime, boundaries, repeated scoring, corrections, and the real MIA 2025 Week 1 raw -5 result displaying -4 with a +1 adjustment. A production dashboard integration test exercises live scores, corrections crossing the floor in both directions, lineup/matchup arithmetic, old-version invalidation, and cold-worker reload of a durable final snapshot without stacking the adjustment. The production build, TypeScript check, and targeted lint are part of the release checks.
