# Sleeper default DST comparison

The **Sleeper default** values in the matchup list, starter cards, and scoring audit reconstruct the score from Sleeper's raw weekly team-defense stats using a fixed preset. They do not read the league's DST scoring rates or use the recorded matchup DST score as the comparison. This is necessary because the commissioner has set those league rates to zero for manual score entry.

## Fixed preset

Verified September 9, 2026 against the NFL Team Defense and Special Teams Defense categories in [Sleeper's public app configuration](https://sleepercdn.com/js/bundle-5f75c239373ac7fd0d09dd40562a58f0.js?vsn=d). The captured numeric settings are in `tests/fixtures/sleeper-default-dst-preset.json`. The comparison version is `sleeper-default-2026-09-09.1`.

| Raw Sleeper stat | Points per event |
| --- | ---: |
| `sack` — sack | +1 |
| `int` — interception | +2 |
| `fum_rec` — fumble recovery | +2 |
| `ff` — forced fumble | +1 |
| `safe` — safety | +2 |
| `blk_kick` — blocked kick | +2 |
| `def_td` — defensive touchdown | +6 |
| `def_st_td` — special-teams touchdown | +6 |
| `def_st_ff` — special-teams forced fumble | +1 |
| `def_st_fum_rec` — special-teams fumble recovery | +1 |

| Points allowed | Tier points |
| --- | ---: |
| 0 | +10 |
| 1–6 | +7 |
| 7–13 | +4 |
| 14–20 | +1 |
| 21–27 | 0 |
| 28–34 | -1 |
| 35+ | -4 |

Yards allowed, return yards, tackles, three-and-outs, fourth-down stops, and defensive two-point returns have no points in this preset. Individual-player special-teams fields (`st_td`, `st_ff`, `st_fum_rec`) are not DST fields. Each enabled stat key contributes independently, exactly as in Sleeper's preset: if the feed reports both a fumble recovery and a special-teams recovery, their configured points both apply. Do not infer extra events from descriptions.

[Sleeper's general DST guide](https://sleeper.com/blog/what-is-dst-in-fantasy-football/) covers the core rates but omits some enabled preset categories. The app configuration is the source for the full list. The weekly feed's `pts_std`, `pts_half_ppr`, and `pts_ppr` fields are not inputs or reconciliation targets; they need not match this particular preset.

## Stats and edge cases

- Use Sleeper's own `pts_allow`, not the opponent's ESPN scoreboard total. [Sleeper's points-allowed definition](https://support.sleeper.com/en/articles/4126495-how-are-points-allowed-calculated) excludes some scores against the offense and includes special-teams scores and conversion points according to its rules.
- A scheduled game or bye displays zero. After play begins, a confirmed shutout is worth +10 before other events. Do not fabricate a shutout when stats have not arrived.
- Sleeper sends sparse stats: omitted event counts are zero. Points allowed must be supplied as a valid raw number or one unambiguous active tier flag. Invalid stats or contradictory tiers produce an unavailable comparison, displayed as an em dash, with a visible warning. Custom totals can still be shown, but an incomplete dashboard cannot be newly frozen.
- Raw points allowed select exactly one tier. If a tier flag is also present, it must agree. Corrections rebuild the comparison from the latest raw stats; there is no adjustment to force it back to the commissioner's recorded score.
- The available source is weekly team stats. A team with multiple started games in one week requires per-game stats to apply separate points-allowed tiers; this unsupported case is marked unavailable rather than scoring combined points allowed as one game.
- ESPN game status gates pregame/live display. Sleeper stats and ESPN can arrive at different times, so this remains a reconstruction subject to provider corrections, not an independent official NFL feed.

## Matchup arithmetic

Keep the actual Sleeper values separate from the comparison:

```text
non-DST total = recorded Sleeper team total - recorded starting DST score
custom total = non-DST total + custom DST score
Sleeper-default comparison total = non-DST total + reconstructed default DST score
comparison impact = custom DST score - reconstructed default DST score
```

The recorded team total still honors `custom_points` when supplied, including zero. A commissioner adjustment to the recorded DST player score is therefore subtracted exactly once. A team-total override that already embeds custom DST while leaving the DST player's score at zero cannot be detected automatically; that existing manual-override limitation remains.

API fields `sleeperTotal`, `sleeperDstPoints`, and starter `sleeperScore` retain the recorded values. `sleeperDefaultTotal`, `sleeperDefaultDstPoints`, and starter `sleeperDefaultScore` hold the comparison (or null if unavailable). `oldDstAudit` now contains the default reconstruction, and `customDstDelta` compares against it. The custom -4 floor and drive scorer are unchanged.

The comparison version is included in the shared-cache key and finalized-snapshot validity check. Older saved comparisons are recomputed; the custom scorer remains `2026-09-09.5`. No database migration is needed.

## Verification

Tests cover every tier boundary, the full captured preset, special-teams combinations, missing/invalid/conflicting stats, corrections, zeroed league settings, recorded DST adjustments, cache/snapshot replacement, and all 32 defenses from the captured 2025 Week 1 Sleeper stats. Hand-checked default results include HOU 7, CHI 11, BAL -2, MIA 0, TEN 10, and DEN 16. These are the reconstructed default scores, not the custom drive scores or `pts_std` values.
