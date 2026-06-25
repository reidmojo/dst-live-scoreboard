# Custom DST Scoring

This app replaces the normal fantasy DST points-allowed tier with drive-result scoring. The goal is to reward defenses for repeatedly ending opponent drives and to make drive outcomes visible in real time.

The app still displays Sleeper's normal D/ST score in the audit view for comparison, but the main matchup score uses:

```text
custom team total = Sleeper total - Sleeper D/ST points + custom D/ST points
```

## Scoring Rules

| Opponent drive result | Points for defending DST |
| --- | ---: |
| Opponent offensive touchdown | -1 |
| Opponent made field goal | -0.5 |
| Defense takes over inside its own 20 | +1 |
| Defense takes over from its own 20 through midfield | +1.5 |
| Defense takes over at opponent 49 through opponent 20 | +2.5 |
| Defense takes over inside opponent 20 | +3.5 |
| D/ST touchdown | +6 |
| Safety | +2 plus applicable takeover bucket |

The `opponent 49 through opponent 20` bucket is intentionally `+2.5`.

## How Takeover Buckets Are Determined

For non-scoring opponent drives, the scorer looks at the next ESPN drive. If the next drive belongs to the defense, the next drive's starting field position is treated as the takeover spot.

Examples:

- Opponent punts, defense starts at its own 12: `+1`
- Opponent punts, defense starts at its own 35: `+1.5`
- Opponent turns it over, defense starts at opponent 42: `+2.5`
- Opponent turns it over, defense starts at opponent 12: `+3.5`

If there is no next defensive possession, the app does not award a takeover bucket. This commonly applies to end-of-half and end-of-game drives.

## Touchdowns And Field Goals

Opponent offensive scoring drives are handled directly:

- Touchdown allowed: `-1`
- Field goal allowed: `-0.5`

Those drives do not also receive a field-position takeover bucket.

## D/ST Touchdowns

If ESPN marks a scoring play that appears to be caused by the defense or special teams, the scorer awards `+6`.

If the D/ST touchdown also creates a detectable next-drive takeover spot, the audit row can show the touchdown plus the takeover bucket. The scoring code supports this combination, but the exact result depends on how ESPN represents the drive and next possession.

## Safeties

A safety is worth `+2`. If ESPN's next drive shows the post-safety free-kick possession by the defense, the scorer adds the relevant takeover bucket.

Example:

```text
Safety + defense takes over at own 35 = +2 + 1.5 = +3.5
```

## Old Sleeper DST Score

The app uses Sleeper's live D/ST score as the authoritative old-scoring total. The old-scoring audit rows are an ESPN-derived estimate reconciled to Sleeper's D/ST total.

This means:

- The main old score under each custom score is Sleeper's live team total.
- The audit's old D/ST total is Sleeper's live D/ST score.
- Any mismatch between ESPN-estimated old components and Sleeper's live D/ST score is shown as a reconciliation row.

## Provisional Status

ESPN and Sleeper live data can change during and after games. The app labels completed weeks as provisional until the Wednesday midnight Eastern correction window after the last NFL game in the selected week. After that, it labels the selected week finalized.

Current limitation: finalization is computed at request time. The app does not yet persist frozen historical correction snapshots.
