# Custom DST Scoring

Reviewed September 9, 2026. This describes the scoring deployed at [r31d.wiki/fantasy_football/dst](https://r31d.wiki/fantasy_football/dst), scorer version `2026-09-09.2`, and edge cases still requiring architecture review.

**Return-touchdown decision: +6 only, with no takeover bucket.** A return touchdown ends with points, not a new offensive possession for the scoring team. This replaces the earlier wording permitting a touchdown-plus-takeover combination. A safety is different: it can be followed by an actual possession after the free kick.

## Source and review status

The live website runs in a separate Sites application. The matching hardened scorer is in [PR #1](https://github.com/reidmojo/dst-live-scoreboard/pull/1); its reviewed [source](https://github.com/reidmojo/dst-live-scoreboard/blob/dc11b8e3cde08ccae58fa23dddea95d6407245a4/src/scoring.js) and [tests](https://github.com/reidmojo/dst-live-scoreboard/blob/dc11b8e3cde08ccae58fa23dddea95d6407245a4/tests/scoring.test.mjs) are pinned here. Until that PR is merged, the older runtime on main differs from production. This documentation update does not merge runtime changes.

**Tested** below means a focused automated regression exists. **Coded** means behavior is present in the reviewed source, but not necessarily covered by its own test. **Partial / not coded** identifies a limitation. Proposed decisions are not new scoring rules.

## Scoring rules

Custom DST points start at **0**. Add the following awards and deductions; there is no starting shutout bonus or minimum-score floor.

| Event or resulting possession | DST points |
| --- | ---: |
| Opponent offensive touchdown | -1 |
| Opponent made field goal | -0.5 |
| Take over at own 1–19 | +1 |
| Take over at own 20 through midfield | +1.5 |
| Take over at opponent 49–20 | +2.5 |
| Take over at opponent 19–1 | +3.5 |
| Defensive or special-teams return touchdown | +6 only |
| Safety | +2 plus applicable actual next-possession bucket |

The opponent 49–20 bucket is intentionally **+2.5**. Exactly own 20 belongs to +1.5; exactly opponent 20 belongs to +2.5; midfield belongs to +1.5.

There are **no separate custom awards** for sacks, interceptions, forced fumbles, recoveries, blocked kicks, yards allowed, or points-allowed tiers. Their effect comes through the drive outcome. Extra points and two-point conversions, including defensive conversion returns, currently add no custom DST points.

The matchup calculation replaces the **entire** starting Sleeper DST score, not just its points-allowed tier:

```text
custom team total = Sleeper team total - starting Sleeper DST points + custom DST points
```

Bench defenses do not contribute. Production preserves Sleeper's commissioner-adjusted team total when supplied, including zero. Totals are rounded to two decimal places.

## Possession and field-position model

For a qualifying non-scoring drive, the scorer examines the **immediately following ESPN drive**, including the active drive. That drive must belong to the team that was defending. Its reported starting position determines the bucket; the scorer does not reconstruct the turnover or return yard by yard.

Punts, interceptions, fumbles, turnovers on downs, missed kicks, and blocked kicks qualify. Returns and penalties affecting the next drive's reported start are included. An offensive TD or made FG does not also earn a takeover bucket.

Examples:

- Punt, receiving team starts at own 12: **+1**.
- Interception returned to opponent 42: **+2.5**, without a separate interception bonus.
- Return reaches opponent 19, but enforcement makes the next drive start at opponent 24: **+2.5**.
- Safety followed by a free-kick possession at own 35: **+2 + 1.5 = +3.5**.
- Pick-six: **+6**, even if an ensuing drive is present; that drive cannot add a bucket to the touchdown.

## Implemented edge cases

| Case | Current behavior | Evidence |
| --- | --- | --- |
| Exact field-position boundaries | Uses the inclusive/exclusive boundaries above. | Tested |
| Next possession is active | Uses its start immediately, without waiting for it to end. | Tested |
| Missed or blocked field goal | Can earn a takeover bucket; no -0.5 made-FG deduction or extra blocked-kick bonus. | Tested |
| Failed fourth down, interception, or fumble | Uses the next possession's position, without a separate turnover award. | Tested |
| Original offense retains the ball | No bucket when the next drive still belongs to the original offense; applies to retained fumbles represented that way. | Coded |
| Offensive TD or made FG followed by kickoff | Only -1 or -0.5; no kickoff-possession bucket for that scoring drive. | Coded; offensive TD also Tested |
| Return TD with a subsequent possession | +6 only; returns exit before takeover calculation. The same return TD does not incur an offensive-TD deduction against the other DST, including for a special-teams TD conceded. | Coded; pick-six and kickoff-return awards Tested |
| Return TD outside completed drives | Also reads the scoring-play collection and credits the scoring team. | Tested for kickoff return |
| Same return TD in both collections | Deduplicates by play ID and awards it once. | Tested |
| Offensive fumble-recovery TD | Remains offensive (-1 against the defending DST), not a +6 DST return. | Tested for explicitly offensive play type |
| Conversion interception mentioned in offensive-TD text | Does not reclassify the preceding offensive TD as defensive. | Tested |
| Defensive two-point return | Zero custom points; excluded from six-point TDs. | Tested |
| Safety with or without following possession | +2; adds a bucket only for a qualifying next possession. An ordinary intentional safety has no special exception. | Both possession cases Tested; intentional classification Coded |
| End of half/game/regulation | These explicit drive-result categories receive no bucket. | Tested |
| Ordinary quarter change | A continuing next possession can supply a bucket. | Tested for Q1 to Q2 |
| Halftime or regulation-to-overtime break | Excludes the Q3/first-overtime kickoff from the preceding drive's award. | Halftime Tested; regulation-to-OT Coded |
| Duplicate current/completed drive | Merges matching drive IDs before scoring so the drive counts once. | Tested |
| Missing abbreviation, available team ID | Resolves from game competitors. An unresolved drive team raises an issue. | ID fallback Tested; warning Coded |
| Missing/invalid takeover location | If the next possession belongs to the defense, no guessed bucket; raises an issue. Accepts recognized teams with yards 1–50 or supported midfield notation. | Tested |
| Unknown or unfinished drive result | Unknown result raises an issue; an unfinished drive without a result waits for a later update. | Unknown result Tested; unfinished skip Coded |
| Return result without confirmed play/team | Raises an issue rather than guessing the +6 award. | Coded |
| Offensive TD/FG counts disagree between ESPN collections | Raises a reconciliation issue. This is an internal ESPN check, not independent official verification. | Mismatch warning Tested |
| Rescinded play marked non-scoring | No return award when the play is no longer supplied as scoring elsewhere. Conflicting feeds are a limitation below. | Single-collection case Tested |

## Production data and correction behavior

These safeguards belong to the deployed Sites application; the legacy Node application does not have all of them.

- **Sleeper comparison:** Old-DST audit rows use Sleeper weekly stats × league settings. A reconciliation row makes their sum equal the official matchup DST total when stats arrive separately. Missing stats do not invent individual events.
- **Starter scores:** Falls back from `starters_points` to matching `players_points`; missing values in both are errors. Empty slots retain their positions. Weekly scores never use season-cumulative roster points.
- **Provider trouble:** Bounded timeouts, transient retries, validation, and cached fallback. Stale sources retain timestamps and show warnings. Without usable data, loading fails rather than manufacturing scores. Missing active/completed-game summaries are rejected. Unresolved issues prevent a new finalized snapshot.
- **Different receipt times:** ESPN and Sleeper are asynchronous; a dashboard is not an atomic snapshot of both providers. Fresh receipt timestamps do not prove every event has reached both sources.
- **Corrections:** Recalculates from current summaries until frozen. When all games are completed, the cutoff is the next Wednesday at **00:00 America/New_York** after the latest scheduled kickoff date in that week. A Wednesday kickoff moves the cutoff to the following Wednesday.
- **Frozen results:** The first healthy request after the cutoff can persist a finalized database snapshot. No scheduled job captures scores at exactly midnight. Unhealthy data and failed snapshot writes remain provisional.
- **Scoring versions:** Different-version snapshots are ignored and recomputed. Same-version frozen snapshots are reused without automatically incorporating later provider corrections.

## Partial, unimplemented, or unverified cases for review

This is the current review inventory, not an exhaustive NFL rulebook. These cases are not supported guarantees.

| Case | Current gap | Follow-up / decision |
| --- | --- | --- |
| Touchbacks, fair catches, unusual enforcement | Generic next-drive positioning should handle an ordinary reported start. No rulebook placement engine or dedicated fixtures for all variants. | Add real examples, including a fumble through the end zone and penalties after possession changes. |
| Onside kicks, muffed punts, kicking-team recoveries | No special phase-of-play model; next-drive ownership cannot always distinguish a defensive stop from a separate special-teams recovery. | Decide awards for non-TD special-teams recoveries and test actual ESPN representations. |
| Multiple possession changes on one play | No reconstruction of intermediate possessions, return fumbles, or recovery chains. Final drive ownership/play classification controls the result. | Define double-turnover and return-fumble-TD outcomes; add fixtures. |
| Unusual overtime segmentation or later OT periods | Only general regulation-to-OT boundary exclusion; not a complete kickoff model for every format or absent period metadata. | Test regular-season and playoff overtime, including later period transitions. |
| One-point safety / rare conversion events | No one-point-safety rule. An unusual drive result containing SAFETY could receive ordinary +2 treatment. Defensive two-point returns explicitly score zero. | Decide whether conversion events remain zero or get separate awards; add explicit recognition before changing policy. |
| Fair-catch kick / rare scoring labels | A normalized made FG gets -0.5; unknown labels remain unresolved. No dedicated fair-catch-kick fixture. | Confirm intended treatment and feed representation. |
| Missing next drive after a stop | No bucket yet. Absence of the next drive alone does not raise the missing-position warning; cannot distinguish a legitimate ending from omitted data. | Add expected-possession completeness checks before finalization. |
| Missing/reordered drives, IDs, or scoring collections | Assumes chronological drive order. Deduplication needs stable IDs; duplicate records are shallow-merged, not a union of play histories. An absent scoring-play collection skips its cross-check. | Validate order/completeness and test inconsistent IDs and partial records. |
| Replay reversal while ESPN collections disagree | A revoked event still in the scoring-play collection can remain credited. TD/FG count checks do not prove every return TD or safety is correct. | Test conflicting revisions and define confirmation/precedence rules. |
| Valid-looking but incomplete data | Shape and TD/FG count checks cannot prove every drive/event arrived. A missing custom DST team entry can still default to zero. | Validate expected team/game coverage and broaden reconciliation; health.ok is not official certification. |
| Postponed, canceled, suspended, reassigned games | No dedicated fantasy-week reassignment/resumption policy. Relies on selected-week schedule, kickoff dates, and completed status. | Decide event ownership and correction-window adjustments. |
| Post-freeze corrections / historical rule changes | No automatic reopening, correction-history ledger, or effective-date rules per season. A new global version can recompute history. | Define approved reopening and whether historical weeks retain original rules. |
| Multiple starting DSTs / unmatched identities or lineups | Replaces the first identified starting DST only. Explicit alias mapping covers WAS→WSH; unknown identities and unmatched partial lineups are not comprehensively reconciled. | Validate one-DST assumption or implement broader lineup/identity support. |
| Commissioner override already includes custom DST | Still performs the normal DST replacement on the overridden total; cannot infer a prior manual adjustment. | Establish a no-double-adjustment procedure or explicit override mode. |
| Manual disputes / independent verification | No custom DST override/approval interface or independent official NFL event feed. Public repo does not yet contain the entire deployed application. | Define dispute review and consolidate auditable production source. |

## Evidence and review priorities

The hardened scorer's **40 automated tests** include synthetic cases and replay **323 completed drives across all 16 games in 2025 Week 1**. Moving the final completed drive to ESPN's active collection preserves totals. Hand-checked fixture examples: HOU **6.5**, CHI **12.5** custom points.

The deployed application's broader **72-test** validation also covers lineup arithmetic, commissioner overrides, provider failures, and shared-cache recovery. These checks were completed for the September 9 release. Historical replay validates the cases it contains, not every rare or conflicting-feed scenario above.

Prioritize missing-drive/completeness checks and conflicting replay revisions, then settle special-teams recovery and post-freeze correction policy. The current return-TD rule is settled: **+6 only; no takeover bucket on that touchdown.**
