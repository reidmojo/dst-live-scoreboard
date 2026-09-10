# Custom DST Scoring

Reviewed September 9, 2026. This describes the scoring deployed at [r31d.wiki/fantasy_football/dst](https://r31d.wiki/fantasy_football/dst), scorer version `2026-09-09.5`, and edge cases still requiring architecture review.

**Return-touchdown decision: +6 only, with no takeover bucket.** A return touchdown ends with points, not a new offensive possession for the scoring team. This replaces the earlier wording permitting a touchdown-plus-takeover combination. A safety is different: it can be followed by an actual possession after the free kick.

**Special-teams touchdown decision: scoring DST +6; conceding DST -1.** This applies in both directions: a kickoff/punt return TD charges the kicking DST, and a kick fumble recovered for a TD by the kicking team charges the receiving DST. Recognized blocked/missed-field-goal return TDs and free-kick return TDs use the same rule. Neither team gets a takeover bucket on that touchdown. An interception or ordinary defensive fumble-return TD still leaves the conceding team's DST at **0 for that play**, because its offense conceded the score. These are custom league rules, not Sleeper's default settings.

**Possession decisions:** A scrimmage-play double turnover that ends with the original offense keeping the ball earns neither DST a takeover bucket. A kicking team's non-TD recovery of a punt or kickoff (including an onside kick) earns that team's DST the normal bucket for the resulting offensive possession. The receiving DST gets no recovery award or matching negative possession penalty for that lost kick; the new -1 applies only when special teams concedes a touchdown. Routine kickoff receipts remain worth zero.

**Final-score floor: -4, only after the NFL game ends.** Live scoring is never clamped. Corrections recalculate the full raw score, then reapply the floor; they never start from the previously floored result. A game being final does not mean its correction window has closed.

## Source and review status

The live website runs in a separate Sites application. The matching hardened scorer is in [PR #1](https://github.com/reidmojo/dst-live-scoreboard/pull/1); its reviewed [source](https://github.com/reidmojo/dst-live-scoreboard/blob/50b6c58e67aaa06d3b487fb38743b7c3bbb8b91a/src/scoring.js) and [baseline tests](https://github.com/reidmojo/dst-live-scoreboard/blob/50b6c58e67aaa06d3b487fb38743b7c3bbb8b91a/tests/scoring.test.mjs) plus [possession-rule tests](https://github.com/reidmojo/dst-live-scoreboard/blob/50b6c58e67aaa06d3b487fb38743b7c3bbb8b91a/tests/possession.test.mjs) and [special-teams TD tests](https://github.com/reidmojo/dst-live-scoreboard/blob/50b6c58e67aaa06d3b487fb38743b7c3bbb8b91a/tests/special-teams-td.test.mjs) and [final-floor tests](https://github.com/reidmojo/dst-live-scoreboard/blob/50b6c58e67aaa06d3b487fb38743b7c3bbb8b91a/tests/floor.test.mjs) are pinned here. Until that PR is merged, the older runtime on main differs from production. This documentation update does not merge runtime changes.

**Tested** below means a focused automated regression exists for the stated example. **Coded** means behavior is present in the reviewed source, but not necessarily covered by its own test. **Partial / not coded** identifies a limitation. A tested example does not establish coverage of every related play. Proposed decisions are not new scoring rules.

“Confirmed” means the available ESPN play data identifies the event and scoring team; it does not mean an independent official review has occurred. “Healthy” means the application's existing checks detected no issue, not that the feed has been proven complete.

## Scoring rules

Raw custom DST points start at **0**, with no starting shutout bonus. Add the following awards and deductions without a running floor. Once that DST's NFL game is confirmed final, its displayed/contributing game score is **max(raw score, -4)**. The event values below remain unchanged by the final-score floor.

| Event or resulting possession | DST points |
| --- | ---: |
| Opponent offensive touchdown | -1 |
| Touchdown conceded by special teams | -1 |
| Opponent made field goal | -0.5 |
| Take over at own 1–19 | +1 |
| Take over at own 20 through midfield | +1.5 |
| Take over at opponent 49–20 | +2.5 |
| Take over at opponent 19–1 | +3.5 |
| Defensive or special-teams return touchdown scored | +6 only; no takeover bucket |
| Safety | +2 plus applicable actual next-possession bucket |

All field positions are from the perspective of the **team whose DST earns the award**. That team's offense receives the ball after the stop: “own 20” means its own 20-yard line, not the previous offense's 20. A “bucket” is the single field-position award for that possession.

The opponent 49–20 bucket is intentionally **+2.5**. Exactly own 20 belongs to +1.5; exactly opponent 20 belongs to +2.5; midfield belongs to +1.5. Each qualifying possession earns at most one bucket, not one per intermediate recovery. A special-teams recovery and the later outcome of the resulting offensive drive are separate events, even if ESPN places them in one drive record.

There are **no separate custom awards** for sacks, interceptions, forced fumbles, recoveries, blocked kicks, yards allowed, or points-allowed tiers. Their effect comes through the drive outcome. Extra points and two-point conversions, including defensive conversion returns, currently add no custom DST points.

| Touchdown example | Scoring team's DST | Conceding team's DST |
| --- | ---: | ---: |
| Kickoff or punt returned for TD | +6 | -1 |
| Receiving team fumbles kick; kicking team recovers for TD | +6 | -1 |
| Blocked/missed field goal returned for TD | +6 | -1 |
| Interception or defensive fumble return against the offense | +6 | 0 |

The special-teams deduction is a separate audit row labeled **Special-teams TD allowed**, with the same ESPN play ID and event time as the +6 award. Deduplication happens before both entries, so a play appearing in completed drives, the active drive, and the scoring summary still creates one credit and one debit. It does not also create an offensive-TD deduction. Kick evidence from either ESPN collection survives a shortened scoring-summary description such as “Fumble Return TD.”

The matchup calculation replaces the **entire** starting Sleeper DST score, not just its points-allowed tier:

```text
custom team total = Sleeper team total - starting Sleeper DST points + custom DST points
```

Here, custom DST points means the raw score while its game is live, and the floored score once its game is final. Bench defenses do not contribute. Production preserves Sleeper's commissioner-adjusted team total when supplied, including zero. Totals are rounded to two decimal places. The -4 floor applies to the custom DST, not to Sleeper's old DST score or the fantasy team's total.

### Sleeper default comparison

The commissioner has zeroed the league's DST scoring rates for manual entry. The website's **Default** comparison now reconstructs **Sleeper's default DST score** from Sleeper's raw weekly team-defense stats. Its full audit is labeled **Sleeper default**. League settings, manually recorded DST points, and precomputed `pts_std`/PPR values do not determine this comparison.

| Sleeper default category | Points |
| --- | ---: |
| Sack | +1 |
| Interception / fumble recovery | +2 each |
| Forced fumble | +1 |
| Safety / blocked kick | +2 each |
| Defensive TD / special-teams TD | +6 each |
| Special-teams forced fumble / recovery | +1 each |
| Points allowed: 0 / 1–6 / 7–13 / 14–20 / 21–27 / 28–34 / 35+ | +10 / +7 / +4 / +1 / 0 / -1 / -4 |

These are the enabled NFL defaults verified in [Sleeper's app configuration](https://sleepercdn.com/js/bundle-5f75c239373ac7fd0d09dd40562a58f0.js?vsn=d) on September 9, 2026. The [general DST guide](https://sleeper.com/blog/what-is-dst-in-fantasy-football/) omits some enabled preset categories. Yards, tackles, return yards, three-and-outs, fourth-down stops, and defensive two-point returns have no default points. Individual-player special-teams fields are excluded. Enabled defense fields contribute independently: when Sleeper reports a recovery in both `fum_rec` and `def_st_fum_rec`, their +2 and +1 rates both apply, matching the preset.

Points allowed uses [Sleeper's own D/ST definition](https://support.sleeper.com/en/articles/4126495-how-are-points-allowed-calculated), not the opponent's scoreboard total. Scheduled games/byes display zero; a live shutout earns +10 only once its stats confirm zero points allowed. Missing event counts are zero in the sparse feed, but missing/invalid points-allowed stats or conflicting tiers make the comparison **unavailable**, not a fabricated shutout or the recorded zero. A valid raw points-allowed value selects one tier; a supplied tier flag must agree. Multiple started games for one team in one week require per-game stats and are currently marked unavailable.

The existing custom-total formula above still subtracts the **actual recorded** starting DST score. Separately:

```text
default comparison total = Sleeper team total - recorded starting DST score + reconstructed default DST
comparison impact = custom DST - reconstructed default DST
```

Thus zeroed scoring settings do not erase the comparison, and a later change to the recorded DST player score is removed once before either replacement. A team-total override that already embeds custom DST while leaving the DST player's score at zero remains an undetectable manual-adjustment case. Corrections rebuild the default comparison from stats without forcing it to match the commissioner's recorded score. Missing comparison data does not alter the custom score but prevents a new finalized snapshot.

The production comparison version is `sleeper-default-2026-09-09.1`; it invalidates older live caches and frozen comparisons independently of the unchanged custom scorer `2026-09-09.5`. The Sites application has 181 passing tests, including the captured preset, every tier boundary, all 32 defenses from 2025 Week 1, zeroed league rates, recorded-score adjustments, and missing-stat/finalization behavior. Example default totals: HOU 7, CHI 11, BAL -2, MIA 0, TEN 10, DEN 16. This comparison implementation belongs to the separate production application, not the legacy Node runtime in this repository.

## Final-game floor and corrections

The floor applies separately to each NFL team/game; a normal fantasy week has one game per DST. It applies as soon as that game is confirmed final, even while other NFL games are still live. There is no running minimum during the game, including overtime. A zero clock or an `END OF GAME` drive label alone is insufficient.

The scorer requires ESPN's status to be `post` with `completed: true`; when a status name is supplied, it must be `STATUS_FINAL` or a final-status variant. It uses the event status first, then competition/summary status when the event has no state. The first available status takes precedence, including when the collections disagree: an explicit live event status wins over a final summary, and an explicit final event status wins over a live summary. The selected status must satisfy all final-status checks; an unconfirmed postgame status raises a warning and prevents a new finalized snapshot.

For every refresh before the existing correction freeze:

1. Recompute the raw score from the available ESPN drive/play events.
2. If the game is not confirmed final, display that raw score unchanged.
3. If it is final, calculate `floor adjustment = max(0, -4 - raw score)` and `displayed score = raw score + floor adjustment`.
4. Preserve the raw score and original event components. Show a separate **Final DST floor (-4)** audit row only when the adjustment is positive.

| Example | Raw score | Displayed DST score | Floor adjustment |
| --- | ---: | ---: | ---: |
| Live game falls to -6 | -6 | -6 | 0 |
| That live game then earns +1.5 | -4.5 | -4.5 | 0 |
| Game ends at raw -4.5 | -4.5 | -4 | +0.5 |
| Game ends at raw -6 | -6 | -4 | +2 |
| +0.5 correction to that raw -6 result | -5.5 | -4 | +1.5 |
| Correction raises raw score above the floor | -3.5 | -3.5 | 0 |
| Final raw score is exactly -4 | -4 | -4 | 0 |

Thus a +0.5 correction to raw -6 does **not** produce -3.5 by adding to the displayed -4. Corrections can shrink, remove, restore, or increase the floor adjustment. Reopening a game before the correction freeze removes the adjustment and resumes raw scoring. Recomputing the same data never adds a second floor adjustment.

The API and persisted dashboard JSON keep `rawPoints`, `floorAdjustment`, and displayed `points` for DST/game scores. Team audit data also keeps `rawTotal`, `floorAdjustment`, and `total`; the lineup and matchup use the displayed score. The floor row is identified as a league rule, not an ESPN play. Event rows alone sum to the raw score; event rows plus the floor row sum to the displayed score.

This does not change the Wednesday correction cutoff or automatically reopen already frozen results. A new scoring version invalidates older-version snapshots, which are recomputed with the floor. Provider warnings remain visible even when a floor is applied; flooring does not certify incomplete event data as correct.

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
- A kicks to B and B returns it for a TD: **B DST +6; A DST -1**; no bucket for either team.
- A kicks to B, B fumbles, and A recovers for a TD: **A DST +6; B DST -1**; no bucket for either team.
- A recovers a punt for a special-teams TD: **A DST +6; B DST -1**; no offensive possession means no bucket on that TD.

## Implemented edge cases

| Case | Current behavior | Evidence |
| --- | --- | --- |
| Exact field-position boundaries | Uses the inclusive/exclusive boundaries above. | Tested |
| A qualifying stop is followed by an active possession | Awards the bucket for the completed stop using the new possession's start; it does not score the unfinished possession itself yet. | Tested |
| Missed or blocked field goal | Can earn a takeover bucket; no -0.5 made-FG deduction or extra blocked-kick bonus. | Tested |
| Failed fourth down, interception, or lost fumble | Uses the next possession's position when it belongs to the defending team. No separate turnover award. | Tested |
| Original offense retains a scrimmage possession | No bucket when the next drive still belongs to the original offense; applies to retained fumbles represented that way. Kicking-team recoveries use the separate special-teams rule below. | Coded; double-turnover examples Tested |
| Offensive TD or made FG followed by kickoff | Only -1 or -0.5 for the offensive score; ordinary kickoff receipt adds zero. A separate kicking-team recovery can earn its own bucket. | Coded; FG plus onside recovery Tested |
| Confirmed return TD with a subsequent possession | Scoring DST gets +6, with no bucket for either team on the TD. A recognized special-teams TD also deducts -1 from the conceding DST. A pick-six/ordinary defensive fumble return gives the conceding DST 0. A separate later defensive stop can still score normally. | Tested for both return categories and subsequent possession |
| Return TD outside completed drives | Also reads the scoring-play collection and credits the scoring team. A recognizable special-teams TD charges the other DST -1. | Tested for kickoff return |
| Same return TD in both collections or duplicate active/completed drive | Deduplicates by play ID: one +6 and, for special-teams TDs, one -1. No duplicate offensive-TD deduction. | Tested |
| Offense recovers its own fumble for a TD | With an offensive TD drive result and play type, -1 against the defending DST and no +6 to the scoring team's DST. | Tested |
| Same-play double turnover, including duplicate temporary-possession drive | Confirmed scrimmage play starts and ends with the original offense: neither DST gets a takeover award. The eventual continuing drive can still score normally. | Tested; real ARI–LAC example plus synthetic duplicate-drive and fumble-chain cases |
| New offense fumbles on its first snap | Separate possession; retain the previous interception/stop bucket and score the new turnover normally. | Tested |
| Three possession changes ending with original defense | One normal bucket for the original defense's resulting offensive possession. No intermediate-recovery bonuses. | Tested |
| Original offense scores after recovering a double turnover | A confirmed scrimmage TD with matching starting/ending team remains offensive: -1 to the opponent DST, no +6 DST bonus and no bucket. Incomplete or conflicting TD metadata remains a gap below. | Tested |
| Kicking team recovers muffed punt or onside kick without a TD | Normal bucket for the kicking team's resulting offensive possession; zero recovery points and no mirror deduction for the receiving DST. | Tested at boundaries; real TEN punt and SEA onside fixtures |
| Kick recovery and ensuing offensive drive share one ESPN record | Recovery award and later offensive outcome are separate. A leading kickoff uses the resulting drive start; a punt followed by a snap within the same drive uses that snap's reported start. | Tested |
| Routine kickoff / failed onside / receiver recovers own kickoff muff | No custom takeover points. Receiver recovers own punt muff: ordinary punt-stop bucket only. | Tested |
| Kick recovery TD, including kicking-team fumble recovery | +6 to the scoring DST and -1 to the other DST. No bucket and no additional offensive-TD deduction. | Tested for punt and kickoff in both scoring directions; real Cody Davis recovery fixture |
| Blocked/missed-field-goal or free-kick return TD | Recognized special-teams TD: +6 / -1, no bucket. A field-goal return TD is not a made-FG deduction; a blocked conversion return remains zero under the conversion rule. | Tested for named types; real blocked-punt/conversion fixture also included |
| Offensive TD from a fake-punt formation | An actual passing/rushing TD remains offensive: -1 to the opposing DST, no DST +6 bonus. Formation alone is not kick evidence. | Passing example Tested |
| Generic fumble-return scoring summary with full kick play available | Preserves the kick-phase evidence by matching play ID, then applies +6 / -1 to the scoring/opposing teams. | Tested |
| Safety followed by conceding team recovering free kick | Safety-scoring DST keeps +2 only; kicking/recovering DST gets its own resulting-possession bucket. A kick-only receiving drive cannot create an extra safety bucket. | Tested |
| Recovery/TD explicitly marked No Play / nullified | Excluded from recovery awards; a nullified kick TD gets neither +6 nor -1. Does not implement all replay or penalty precedence. | Tested |
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
| Return play no longer marked scoring after a correction | Recomputing drops its +6 and any associated special-teams -1 if no collection still supplies it as scoring. There are no separate reversal ledger entries. Conflicting feeds are a limitation below. | Tested |
| Live raw score below -4, including Q4 at 0:00 or overtime | Remains below -4. Later positive points are added to the raw total, never to -4. | Tested |
| Confirmed final raw score below -4 | Display/contribute -4 and preserve the raw score with one positive floor-adjustment row. Does not wait for other games or the correction cutoff. | Tested; real MIA raw -5 / displayed -4 fixture |
| Final raw score at/above -4 | No adjustment row and no change to the score. | Tested at -4, -3.5, zero, and a positive score |
| Postponed, suspended, canceled, or unconfirmed completion | Does not activate the floor. An unconfirmed `post` status raises a completion warning. | Tested |
| Correction while final, or game reopened before freeze | Recompute raw first; then shrink/remove/restore the adjustment, or remove it entirely while live. No points are added to a previously floored balance. | Tested in scorer and production dashboard flow |
| Persisted/reloaded floored result | Keeps raw and displayed values plus one adjustment. Does not compound the adjustment on reload. | Tested in production dashboard/snapshot flow |

An unresolved event may contribute **zero for now** while other confirmed components remain in the displayed total. That is different from a rule that definitively awards zero. Reported issues keep the result provisional; the gaps below describe missing data that may not raise an issue yet.

## Production data and correction behavior

These safeguards belong to the deployed Sites application; the legacy Node application does not have all of them.

- **Sleeper comparison:** Uses the fixed default reconstruction above. Audit components sum to that comparison without reconciliation to the recorded DST score. Missing required stats show an unavailable comparison; custom totals remain visible.
- **Starter scores:** Falls back from `starters_points` to matching `players_points`; missing values in both are errors. Empty slots retain their positions. Weekly scores never use season-cumulative roster points.
- **Provider trouble:** Bounded timeouts, transient retries, validation, and cached fallback. Stale sources retain timestamps and show warnings. If a required source fails with no cached fallback, loading fails. Optional stat breakdowns can be unavailable while core totals remain visible. Missing active/completed-game summaries are rejected. Reported unresolved issues prevent a new finalized snapshot; undetected incomplete data remains a gap below.
- **Different receipt times:** ESPN and Sleeper are asynchronous; a dashboard is not an atomic snapshot of both providers. Fresh receipt timestamps do not prove every event has reached both sources.
- **Corrections:** Recalculates raw scores from available summaries until frozen, then derives any final-game floor adjustment. The floor can apply immediately at a game's final status while corrections remain open. When all games are completed, the cutoff is the next Wednesday at **00:00 America/New_York (the start of Wednesday)** after the latest scheduled kickoff date in that week. A Wednesday kickoff moves the cutoff to the following Wednesday. This is an application policy, not a guarantee that the providers have finished every correction.
- **Frozen results:** The first healthy request after the cutoff can persist a finalized database snapshot containing raw scores, floor adjustments, and displayed totals. No scheduled job captures scores at exactly midnight. Unhealthy data and failed snapshot writes remain provisional.
- **Scoring versions:** Snapshots with a different custom-scorer or default-comparison version are ignored and recomputed. Same-version frozen snapshots are reused without automatically incorporating later provider corrections.

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
| Return TD with missing special-teams context | Uses kick/return types or explicit kick evidence from available records. If every record omits that context and supplies only a generic defensive-fumble-return label, it can still look like an ordinary defensive return: +6, with no special-teams -1. | Add ambiguous/fragmented-feed fixtures and phase-confirmation checks; do not infer the unit from player position alone. |
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

The hardened scorer's **118 automated tests** include synthetic cases and replay **323 completed drives with 2,897 play records across all 16 games in 2025 Week 1**. Moving the final completed drive to ESPN's active collection preserves totals. Hand-checked fixture examples: HOU **6.5**, CHI **12.5** custom points. The earlier possession-rule update changed TEN **10.5 → 13.0**, adding its **+2.5** recovered punt at DEN 24. The special-teams TD deduction adds no further changes to that Week 1 fixture; its specific TD cases are tested separately below. The final-score floor changes only MIA's displayed Week 1 score, from raw **-5** to displayed **-4**, with a **+1** league adjustment; its raw event score remains -5.

Real-event regression fixtures include [TEN at DEN, September 7, 2025](https://www.espn.com/nfl/playbyplay/_/gameId/401772832) (muffed punt recovered by TEN), [LAC at ARI, October 21, 2024](https://www.espn.com/nfl/playbyplay/_/gameId/401671699) (ARI interception fumbled back to ARI), and [GB at SEA, January 18, 2015](https://www.espn.com/nfl/playbyplay/_/gameId/400749519) (SEA onside recovery at midfield). The latter two fixtures preserve the relevant ESPN drive/play excerpts, not the entire games.

The special-teams TD fixtures preserve relevant ESPN drive/scoring records for [DeeJay Dallas's kickoff return, ARI at BUF, September 8, 2024](https://www.espn.com/nfl/playbyplay/_/gameId/401671617) (**ARI +6, BUF -1**), [Cody Davis's kickoff-fumble recovery, NE at DEN, December 24, 2023](https://www.espn.com/nfl/playbyplay/_/gameId/401547621) (**NE +6, DEN -1**), and [Grant Stuard's blocked-punt return, IND at TEN, December 3, 2023](https://www.espn.com/nfl/playbyplay/_/gameId/401547570) (**IND +6, TEN -1**, with the ensuing defensive conversion return worth zero). These are event awards, not full-game totals.

The deployed application's broader **151-test** validation also covers lineup arithmetic, commissioner overrides, provider failures, shared-cache recovery, and a live → final → corrected → saved/reloaded floor scenario. That scenario verifies corrections both below and across -4 and that raw/floor values survive persistence without compounding. These checks were completed for the September 9 release. Historical replay validates the cases it contains, not every rare or conflicting-feed scenario above.

Prioritize missing-drive/completeness checks, conflicting replay revisions, and post-freeze correction policy. Return TDs (**+6, no bucket**), special-teams TDs conceded (**-1**), same-play retained possession (**no takeover bucket**), non-TD kicking-team recoveries (**normal resulting-possession bucket**), and the **-4 floor after each game's final status** are settled and implemented; the remaining gaps concern detection, unusual feed representations, and correction policy.
