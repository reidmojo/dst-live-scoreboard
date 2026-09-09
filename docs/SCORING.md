# Custom DST Scoring

Reviewed September 9, 2026. This describes the scoring deployed at [r31d.wiki/fantasy_football/dst](https://r31d.wiki/fantasy_football/dst), scorer version `2026-09-09.3`, and edge cases still requiring architecture review.

**Return-touchdown decision: +6 only, with no takeover bucket.** A return touchdown ends with points, not a new offensive possession for the scoring team. This replaces the earlier wording permitting a touchdown-plus-takeover combination. A safety is different: it can be followed by an actual possession after the free kick.

**Possession decisions:** A scrimmage-play double turnover that ends with the original offense keeping the ball earns neither DST a takeover bucket. A kicking team's recovery of a punt or kickoff (including an onside kick) earns that team's DST the normal bucket for the resulting offensive possession. The receiving DST gets no recovery award or matching negative penalty for that lost kick. Routine kickoff receipts remain worth zero.

## Source and review status

The live website runs in a separate Sites application. The matching hardened scorer is in [PR #1](https://github.com/reidmojo/dst-live-scoreboard/pull/1); its reviewed [source](https://github.com/reidmojo/dst-live-scoreboard/blob/f2a981e717c9d1c9f0b26c32aa544064d1c2a0d9/src/scoring.js) and [baseline tests](https://github.com/reidmojo/dst-live-scoreboard/blob/f2a981e717c9d1c9f0b26c32aa544064d1c2a0d9/tests/scoring.test.mjs) plus [possession-rule tests](https://github.com/reidmojo/dst-live-scoreboard/blob/f2a981e717c9d1c9f0b26c32aa544064d1c2a0d9/tests/possession.test.mjs) are pinned here. Until that PR is merged, the older runtime on main differs from production. This documentation update does not merge runtime changes.

**Tested** below means a focused automated regression exists for the stated example. **Coded** means behavior is present in the reviewed source, but not necessarily covered by its own test. **Partial / not coded** identifies a limitation. A tested example does not establish coverage of every related play. Proposed decisions are not new scoring rules.

“Confirmed” means the available ESPN play data identifies the event and scoring team; it does not mean an independent official review has occurred. “Healthy” means the application's existing checks detected no issue, not that the feed has been proven complete.

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

All field positions are from the perspective of the **team whose DST earns the award**. That team's offense receives the ball after the stop: “own 20” means its own 20-yard line, not the previous offense's 20. A “bucket” is the single field-position award for that possession.

The opponent 49–20 bucket is intentionally **+2.5**. Exactly own 20 belongs to +1.5; exactly opponent 20 belongs to +2.5; midfield belongs to +1.5. Each qualifying possession earns at most one bucket, not one per intermediate recovery. A special-teams recovery and the later outcome of the resulting offensive drive are separate events, even if ESPN places them in one drive record.

There are **no separate custom awards** for sacks, interceptions, forced fumbles, recoveries, blocked kicks, yards allowed, or points-allowed tiers. Their effect comes through the drive outcome. Extra points and two-point conversions, including defensive conversion returns, currently add no custom DST points.

The matchup calculation replaces the **entire** starting Sleeper DST score, not just its points-allowed tier:

```text
custom team total = Sleeper team total - starting Sleeper DST points + custom DST points
```

Bench defenses do not contribute. Production preserves Sleeper's commissioner-adjusted team total when supplied, including zero. Totals are rounded to two decimal places.

## Possession and field-position model

For an ordinary qualifying non-scoring drive, the scorer examines the **immediately following ESPN drive**, including the active drive. That drive must belong to the team that was defending. Its reported starting position determines the bucket; the scorer does not reconstruct the turnover or return yard by yard. “Original offense” below means the team that possessed the ball at the start of the scrimmage play in question.

Punts, interceptions, fumbles, turnovers on downs, missed kicks, and blocked kicks are eligible result categories, **provided the next drive actually belongs to the defending team**. A scrimmage fumble alone does not earn points if the original offense keeps possession. Returns and penalties affecting the next drive's reported start are included. An offensive TD or made FG does not itself earn a takeover bucket; a separate ensuing kick recovery can.

**Double turnovers:** Use the ball's ownership at the end of the same scrimmage play. If A throws an interception to B, B fumbles during the return, and A recovers, A retained possession for this system: **A DST 0, B DST 0 for that sequence**. A's offensive players recovering the ball do not become a DST scoring unit. Duplicate records of that play assigned to a temporary possessor do not create a second award. If B instead keeps the interception, begins its offensive possession, and fumbles on its first snap, those are two separate qualifying possessions and both normal buckets remain. Multiple changes ending with B keeping the ball earn B one bucket, not several. These rules govern takeover awards; a confirmed TD or safety still receives its scoring treatment.

**Kicking-team recoveries:** The scorer separately scans kick plays with recovery, muff, fumble, or onside evidence. It resolves the kicking team from the play's starting team and confirms who gets the subsequent offensive possession. ESPN can attach a kickoff to the resulting offensive drive, so that drive's start is used. If a recovered punt and ensuing offensive snap share one drive, the ensuing snap's reported position is used instead. This also avoids trusting misleading play-end metadata: the real Seattle onside example below reports the wrong play-end team/spot, but the following Seattle drive correctly starts at midfield. A new active offensive drive can confirm the award before its first snap.

An ordinary downed punt is still a normal defensive-stop bucket for the receiving team. A receiver muffing and recovering its own punt does not add another award. A kickoff touchback, failed onside kick, or receiving team's own kickoff-muff recovery earns zero. Kick recoveries are deduplicated by play ID and never counted again as a separate defensive turnover from a kick-only drive record. A recovery with no established offensive possession gets no bucket yet; missing confirmation/position can produce a provisional warning. A kick explicitly marked **No Play** or **nullified** is excluded from recovery awards. This is not a full penalty or replay adjudicator.

**A quarter change itself earns no points.** If the same offense keeps the ball across Q1→Q2 or Q3→Q4, there is no takeover award. If a qualifying stop ends one quarter and the other team's resulting possession starts in the next quarter, that stop can earn its normal bucket. Halftime and the start of overtime are treated separately because their kickoff possessions are not continuations of the preceding stop.

Examples:

- Punt, receiving team starts at own 12: **+1**.
- Interception returned to opponent 42: **+2.5**, without a separate interception bonus.
- Return reaches opponent 19, but enforcement makes the next drive start at opponent 24: **+2.5**.
- Safety followed by a free-kick possession at own 35: **+2 + 1.5 = +3.5**.
- Pick-six: **+6**, even if an ensuing drive is present; that drive cannot add a bucket to the touchdown.
- Opponent punts at the end of Q1; the defending team's offense starts Q2 at its own 35: **+1.5 for the punt/possession**, not for the quarter ending.
- Opponent keeps possession from Q1 into Q2: **0 for the quarter change**; the drive can still score later when it ends.
- Opponent scores an offensive TD on the final play of a half: **-1**. The end-of-half exclusion removes takeover buckets, not the TD deduction.
- A punts, B muffs, A recovers, and A's offense starts at B's 30: **A DST +2.5; B DST 0** for the recovery.
- A recovers its onside kick and starts at its own 45: **A DST +1.5; B DST 0** for the recovery.
- A scores a FG, then recovers its onside kick at its own 45: **B DST -0.5** for the FG and **A DST +1.5** for the separate recovery.
- A's interception return is fumbled back to the original offense during that same play: **0 takeover points for both DSTs**.
- A recovers a punt for a special-teams TD: **A DST +6 only**; no offensive possession means no bucket on that TD.

## Implemented edge cases

| Case | Current behavior | Evidence |
| --- | --- | --- |
| Exact field-position boundaries | Uses the inclusive/exclusive boundaries above. | Tested |
| A qualifying stop is followed by an active possession | Awards the bucket for the completed stop using the new possession's start; it does not score the unfinished possession itself yet. | Tested |
| Missed or blocked field goal | Can earn a takeover bucket; no -0.5 made-FG deduction or extra blocked-kick bonus. | Tested |
| Failed fourth down, interception, or lost fumble | Uses the next possession's position when it belongs to the defending team. No separate turnover award. | Tested |
| Original offense retains a scrimmage possession | No bucket when the next drive still belongs to the original offense; applies to retained fumbles represented that way. Kicking-team recoveries use the separate special-teams rule below. | Coded; double-turnover examples Tested |
| Offensive TD or made FG followed by kickoff | Only -1 or -0.5 for the offensive score; ordinary kickoff receipt adds zero. A separate kicking-team recovery can earn its own bucket. | Coded; FG plus onside recovery Tested |
| Confirmed return TD with a subsequent possession | Scoring team's DST gets +6; no takeover bucket is attached to that touchdown. The conceding team's DST gets no -1 deduction for that return TD, since the deduction applies to offensive TDs. This includes punt/kickoff returns. A separate later defensive stop can still score normally. | Coded; pick-six and kickoff-return awards Tested |
| Return TD outside completed drives | Also reads the scoring-play collection and credits the scoring team. | Tested for kickoff return |
| Same return TD in both collections | Deduplicates by play ID and awards it once. | Tested |
| Offense recovers its own fumble for a TD | With an offensive TD drive result and play type, -1 against the defending DST and no +6 to the scoring team's DST. | Tested |
| Same-play double turnover, including duplicate temporary-possession drive | Confirmed scrimmage play starts and ends with the original offense: neither DST gets a takeover award. The eventual continuing drive can still score normally. | Tested; real ARI–LAC example plus synthetic duplicate-drive and fumble-chain cases |
| New offense fumbles on its first snap | Separate possession; retain the previous interception/stop bucket and score the new turnover normally. | Tested |
| Three possession changes ending with original defense | One normal bucket for the original defense's resulting offensive possession. No intermediate-recovery bonuses. | Tested |
| Original offense scores after recovering a double turnover | A confirmed scrimmage TD with matching starting/ending team remains offensive: -1 to the opponent DST, no +6 DST bonus and no bucket. Incomplete or conflicting TD metadata remains a gap below. | Tested |
| Kicking team recovers muffed punt or onside kick | Normal bucket for the kicking team's resulting offensive possession; zero recovery points and no mirror deduction for the receiving DST. | Tested at boundaries; real TEN punt and SEA onside fixtures |
| Kick recovery and ensuing offensive drive share one ESPN record | Recovery award and later offensive outcome are separate. A leading kickoff uses the resulting drive start; a punt followed by a snap within the same drive uses that snap's reported start. | Tested |
| Routine kickoff / failed onside / receiver recovers own kickoff muff | No custom takeover points. Receiver recovers own punt muff: ordinary punt-stop bucket only. | Tested |
| Kick recovery TD, including kicking-team fumble recovery | +6 to the scoring DST, no bucket and no offensive-TD deduction. | Tested for punt and kickoff |
| Safety followed by conceding team recovering free kick | Safety-scoring DST keeps +2 only; kicking/recovering DST gets its own resulting-possession bucket. A kick-only receiving drive cannot create an extra safety bucket. | Tested |
| Recovery explicitly marked No Play / nullified | Excluded from special-teams recovery awards. Does not implement all replay or penalty precedence. | No Play Tested; nullified Coded |
| Missing ownership on recognized multiple-turnover play | No guessed takeover bucket; raises a possession-confirmation issue. This guard depends on recognizable interception/fumble text and a non-scoring turnover event. | Tested |
| Conversion interception mentioned in offensive-TD text | Does not reclassify the preceding offensive TD as defensive. | Tested |
| Defensive two-point return | Zero custom points; excluded from six-point TDs. | Tested |
| Ordinary safety with or without following possession | Team credited with the safety gets +2. Add a bucket if its offense takes the next possession and the position is valid, subject to the period-break exclusions below. Without that possession, keep +2 only. Intentionally conceding an ordinary safety has the same treatment. | Both possession cases Tested; intentional classification Coded |
| Drive explicitly ends as END OF HALF, END OF GAME, or END OF REGULATION | The ending itself earns no bucket. A separate earlier kick recovery that already established an offensive possession keeps its award. An offensive TD, made FG, return TD, or safety still receives its normal treatment when recorded as that scoring result, even on the final play. | End-result exclusions and recovery before continuing drive ends Tested; scoring-result precedence Coded |
| Qualifying stop across an ordinary quarter boundary | A stop can earn its takeover bucket when the defending team's next possession starts in the following quarter (Q1→Q2 or Q3→Q4). The quarter change itself earns no points. | Tested for a punt at Q1→Q2; Q3→Q4 Coded |
| Same offense continues across an ordinary quarter boundary | No new possession, so no takeover bucket for crossing the boundary. Score the drive's eventual outcome normally. | Coded |
| Next possession crosses halftime or regulation-to-overtime | Suppresses the preceding drive's takeover bucket when reported period numbers cross those breaks. A Q3/first-OT kickoff must not reward the preceding stop. The implementation checks period numbers, not the kickoff play itself; offensive TD, made FG, return TD, and ordinary safety awards remain. | Halftime Tested; regulation-to-OT Coded |
| Duplicate current/completed drive | Merges matching drive IDs before scoring so the drive counts once. | Tested |
| Missing abbreviation, available team ID | Resolves from game competitors. An unresolved drive team raises an issue. | ID fallback Tested; warning Coded |
| Missing/invalid takeover location | If the next possession belongs to the defense, no guessed bucket; raises an issue. Accepts recognized teams with yards 1–50 or supported midfield notation. | Tested |
| Unknown or missing drive result | Unknown nonempty result raises an issue. A drive with no result is skipped with no points yet; the code does not prove that such a drive is genuinely unfinished. A missing final result is therefore a completeness gap. | Unknown result Tested; missing-result skip Coded |
| Return result without a matching return play in that drive | Flags the drive as awaiting confirmation and does not assign a guessed bucket. A separately confirmed scoring play can still award +6 through the scoring-play collection. | Coded |
| Confirmed return play with unresolved scoring team | No +6 award from that play until its scoring team can be resolved; raises an issue. | Coded |
| Offensive TD/FG counts disagree between ESPN collections | Raises a reconciliation issue. This is an internal ESPN check, not independent official verification. | Mismatch warning Tested |
| Return play no longer marked scoring after a correction | Recomputing drops its +6 if no collection still supplies it as scoring. There is no separate negative-six correction event. Conflicting feeds are a limitation below. | Single-collection case Tested |

An unresolved event may contribute **zero for now** while other confirmed components remain in the displayed total. That is different from a rule that definitively awards zero. Reported issues keep the result provisional; the gaps below describe missing data that may not raise an issue yet.

## Production data and correction behavior

These safeguards belong to the deployed Sites application; the legacy Node application does not have all of them.

- **Sleeper comparison:** Old-DST audit rows use Sleeper weekly stats × league settings. A reconciliation row makes their sum equal the official matchup DST total when stats arrive separately. Missing stats do not invent individual events.
- **Starter scores:** Falls back from `starters_points` to matching `players_points`; missing values in both are errors. Empty slots retain their positions. Weekly scores never use season-cumulative roster points.
- **Provider trouble:** Bounded timeouts, transient retries, validation, and cached fallback. Stale sources retain timestamps and show warnings. If a required source fails with no cached fallback, loading fails. Optional stat breakdowns can be unavailable while core totals remain visible. Missing active/completed-game summaries are rejected. Reported unresolved issues prevent a new finalized snapshot; undetected incomplete data remains a gap below.
- **Different receipt times:** ESPN and Sleeper are asynchronous; a dashboard is not an atomic snapshot of both providers. Fresh receipt timestamps do not prove every event has reached both sources.
- **Corrections:** Recalculates from available summaries until frozen. When all games are completed, the cutoff is the next Wednesday at **00:00 America/New_York (the start of Wednesday)** after the latest scheduled kickoff date in that week. A Wednesday kickoff moves the cutoff to the following Wednesday. This is an application policy, not a guarantee that the providers have finished every correction.
- **Frozen results:** The first healthy request after the cutoff can persist a finalized database snapshot. No scheduled job captures scores at exactly midnight. Unhealthy data and failed snapshot writes remain provisional.
- **Scoring versions:** Different-version snapshots are ignored and recomputed. Same-version frozen snapshots are reused without automatically incorporating later provider corrections.

## Partial, unimplemented, or unverified cases for review

The first section below covers ordinary rules that use generic code but need more representative tests. The second covers actual detection/implementation gaps or unsettled policy. Neither section promises behavior beyond what is stated; this is a review inventory rather than an exhaustive NFL rulebook.

### Generic handling that needs more examples

| Case | Current gap | Follow-up / decision |
| --- | --- | --- |
| Touchbacks, fair catches, unusual enforcement | Generic next-drive positioning should handle an ordinary reported start. No rulebook placement engine or dedicated fixtures for all variants. | Add real examples, including a fumble through the end zone and penalties after possession changes. |
| Fair-catch kick / rare scoring labels | A drive reported as a recognized made FG gets -0.5; an unknown label raises an issue. No dedicated fair-catch-kick fixture. | Confirm intended treatment and feed representation. |

### Implementation gaps and policy decisions

| Case | Current gap | Follow-up / decision |
| --- | --- | --- |
| Incomplete or conflicting kick-recovery records | Implemented for identifiable kick plays with recovery evidence and a confirmed offensive possession. Does not reconstruct absent kick plays, resolve all contradictory team/drive fields, or infer a recovery from an unrecognized label. | Add broader real fixtures, including blocked kicks recovered by the kicking team, re-kicks, kick-return fumble chains, and unusual enforcement. |
| Fragmented or conflicting multiple-turnover records | Complete scrimmage plays with starting/ending teams are handled. Does not stitch different play IDs into a single return, infer every missing intermediate possession, or adjudicate conflicting TD/safety labels. | Add actual fragmented-feed/replay examples; surface conflicts before assigning a bucket or TD. |
| Unusual overtime segmentation or later OT periods | Only general regulation-to-OT boundary exclusion; not a complete kickoff model for every format or absent period metadata. | Test regular-season and playoff overtime, including later period transitions. |
| One-point safety / rare conversion events | No one-point-safety rule. An unusual drive result containing SAFETY could receive ordinary +2 treatment. Defensive two-point returns explicitly score zero. | Decide whether conversion events remain zero or get separate awards; add explicit recognition before changing policy. |
| Missing next drive or final result after a stop | No bucket yet. An absent next drive or empty result alone does not raise a warning; cannot distinguish a legitimate unfinished/ending possession from omitted data. | Add expected-possession and completed-drive checks before finalization. |
| Missing/reordered drives, IDs, or scoring collections | Assumes chronological drive order. Deduplication needs stable IDs; duplicate records are shallow-merged, not a union of play histories. An absent scoring-play collection skips its cross-check. | Validate order/completeness and test inconsistent IDs and partial records. |
| Replay reversal while ESPN collections disagree | A revoked event still in the scoring-play collection can remain credited. TD/FG count checks do not prove every return TD or safety is correct. | Test conflicting revisions and define confirmation/precedence rules. |
| Valid-looking but incomplete data | Shape and TD/FG count checks cannot prove every drive/event arrived. A missing custom DST team entry can still default to zero. | Validate expected team/game coverage and broaden reconciliation; health.ok is not official certification. |
| Postponed, canceled, suspended, reassigned games | No dedicated fantasy-week reassignment/resumption policy. Relies on selected-week schedule, kickoff dates, and completed status. | Decide event ownership and correction-window adjustments. |
| Post-freeze corrections / historical rule changes | No automatic reopening, correction-history ledger, or effective-date rules per season. A new global version can recompute history. | Define approved reopening and whether historical weeks retain original rules. |
| Multiple starting DSTs / unmatched identities or lineups | Replaces the first identified starting DST only. Explicit alias mapping covers WAS→WSH; unknown identities and unmatched partial lineups are not comprehensively reconciled. | Validate one-DST assumption or implement broader lineup/identity support. |
| Commissioner override already includes custom DST | Still performs the normal DST replacement on the overridden total; cannot infer a prior manual adjustment. | Establish a no-double-adjustment procedure or explicit override mode. |
| Manual disputes / independent verification | No custom DST override/approval interface or independent official NFL event feed. Public repo does not yet contain the entire deployed application. | Define dispute review and consolidate auditable production source. |

## Evidence and review priorities

The hardened scorer's **74 automated tests** include synthetic cases and replay **323 completed drives with 2,897 play records across all 16 games in 2025 Week 1**. Moving the final completed drive to ESPN's active collection preserves totals. Hand-checked fixture examples: HOU **6.5**, CHI **12.5** custom points. The only Week 1 team-total change from this rule update is TEN **10.5 → 13.0**, adding its **+2.5** recovered punt at DEN 24; all other team totals remain unchanged.

Real-event regression fixtures include [TEN at DEN, September 7, 2025](https://www.espn.com/nfl/playbyplay/_/gameId/401772832) (muffed punt recovered by TEN), [LAC at ARI, October 21, 2024](https://www.espn.com/nfl/playbyplay/_/gameId/401671699) (ARI interception fumbled back to ARI), and [GB at SEA, January 18, 2015](https://www.espn.com/nfl/playbyplay/_/gameId/400749519) (SEA onside recovery at midfield). The latter two fixtures preserve the relevant ESPN drive/play excerpts, not the entire games.

The deployed application's broader **106-test** validation also covers lineup arithmetic, commissioner overrides, provider failures, and shared-cache recovery. These checks were completed for the September 9 release. Historical replay validates the cases it contains, not every rare or conflicting-feed scenario above.

Prioritize missing-drive/completeness checks, conflicting replay revisions, and post-freeze correction policy. Return TDs (**+6 only**), same-play retained possession (**no takeover bucket**), and kicking-team recoveries (**normal resulting-possession bucket**) are settled and implemented; the remaining gaps concern detection, unusual feed representations, and correction policy.
