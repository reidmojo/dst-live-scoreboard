# Temporary Sleeper-style live estimates

This is an independently expressed compatibility model, not a feed of official
Sleeper live projections or a calibrated model for our drive-based DST rules.
Actual scoring is unchanged. There is no runtime dependency on Sleeper's web bundle.

## Source checked September 13, 2026

Public web client: https://sleepercdn.com/js/bundle-a35e7887837453b55e8d4dd0cfdccea5.js?vsn=d

- Module 58, export `b`: live projection from actual points, baseline projection,
  regulation seconds remaining, sport and an optional defense flag.
- Module 58, export `i`: normal-distribution win probability from both teams'
  actual and projected totals, bounded to 1–99% before completion.
- Module 1026, `Nn` / `Ln` / `Mn` and the matchup probability component: confirmed
  call sites using player projections and actuals to produce matchup percentages.
- Module 342, function `I`: 3,600 seconds before kickoff; regulation clock,
  1,800 at halftime; zero regulation time in overtime.

For an ordinary player the three original pace weights sum to one. Expressing
them as one term preserves the formula. The defense weights sum to
`0.25 + 0.05 * fractionRemaining`. Full-game forecasts gradually blend with
observed scoring pace. At zero regulation time the estimate equals current points.

Win-probability means are team projected totals. For each team the variance is
`(actual - projected)^2 / (1 + 10 * (1 - actual / projected))`, with a 0.1 variance
when the numerator is zero. Compare the means using the summed variances.
The implementation uses a standard normal-CDF approximation, not copied Gaussian
library source; differences from the reference are below 1e-7 in recorded checks.

## Intentional differences and safeguards

- Use the site's actual custom DST scores, with Sleeper's published `pts_std`
  DST projection as a temporary baseline. This is explicitly disclosed in the UI.
  Consequently percentages need not match the Sleeper league's zeroed DST rules.
- Use the defense-specific projection consistently for player display and team
  totals. Sleeper's inspected player component passes the defense flag, while its
  separate matchup helper omits it. We do not reproduce that inconsistency.
- Preserve commissioner adjustments once: start with the authoritative team total
  and add each starter's projected-minus-actual difference. Exclude bench/empty slots.
- Keep full precision for calculations, display fantasy points with two decimals,
  and show complementary rounded percentages.
- Completed player cards show the original baseline projection for comparison only.
  Team totals and odds still use the completed actual score. Pregame player actuals
  are visually blank; final cards have a muted surface without fading their text.
- Only confirmed completion yields 100/0 or a final Tie. A zero fourth-quarter
  clock or overtime is not completion. This avoids the reference's shortcut of
  treating actual-equals-projection as final.
- Provisional D/ST scoring prevents a team from being treated as confirmed final.
- Missing stats, baseline or clock produce unavailable estimates, not fabricated
  zero or 50/50. Completed actuals do not need a baseline; known byes contribute actuals.
- Invalid live variances for unusual zero/negative team totals are unavailable.
- Estimates refresh with the existing scoreboard polling; there is no simulated
  running clock, provider fan-out, new storage query or custom-DST prediction model.

## Validation

Compared 240 synthetic player cases to the isolated public function (regular and
defense, negative/zero/positive actuals, pregame through full time). Maximum absolute
error: 6.4e-12. Representative win-probability checks reproduce 62/38, 53/47 and
66/34 after rounding. Automated tests cover missing data, halftime, overtime,
final ties, commissioner adjustments, mirrored bars and two-decimal display.
These establish formula parity, not a claim of exact mobile-app or feed-timing parity.
