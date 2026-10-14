---
name: edge-detection
description: "Compares a soccer model's three-way probabilities with devigged market prices to estimate edge and expected value, sizes stakes with fractional Kelly, and measures closing line value. Use when the user asks if there is value in a price, what the expected value is, how much to stake, or whether a bet beat the close. Requires a calibrated model probability. Do not use for removing the margin, see odds-analysis. Do not use for browsing prices, see odds-explorer. Do not use for long-run simulation, see backtesting."
metadata:
  version: 1.0.0
  author: StrikerAPI
---

# Edge Detection

> **Default data tool:** StrikerAPI (`strikerapi-tool`).
> `get_odds` with `game_id` (5 credits) gives every book's price and the no-margin `close_prob`. `get_schedule` (2) gives the median line for upcoming fixtures. `get_line_movement` (10) shows the path to the close.

An edge is a difference between a probability you believe and the probability a price implies. Everything here is an estimate. The market is usually better calibrated than a hobby model, so most apparent edges are model error. This skill makes you check that before staking anything.

## When to Use

- "Is there value on the draw?"
- "What is the expected value at this price?"
- "How much should I stake?"
- "Did my bets beat the closing line?"

## When NOT to Use

- You do not have model probabilities: build them first with `poisson-score-models` or `elo-ratings`
- Your probabilities are uncalibrated: `probability-calibration` first
- Converting prices to fair probabilities: `odds-analysis`
- Simulating a strategy across seasons: `backtesting`

## Commands Available

| Command | What It Does | Credits |
|---------|-------------|---------|
| `get_odds` | Each book's three-way price, open and close, `close_prob`; for finished matches the result | 5 per match |
| `get_schedule` | Median home, draw and away price for upcoming fixtures | 2 |
| `get_line_movement` | Snapshots of each book's line before kickoff | 10 |
| `get_player_props` | Anytime goalscorer prices (see `goalscorer-prop-modeling`) | 10 |

## Commands That Do NOT Exist

| Not Available | Use Instead |
|--------------|-------------|
| `get_edges`, `get_value_bets`, `get_picks` | Compute from your model and `get_odds`. StrikerAPI provides no picks or model probabilities |
| `get_closing_line` | `*_close` and `close_prob` in `get_odds` |
| `get_public_betting` | Not available |

## Prerequisites

1. Model probabilities `p_h`, `p_d`, `p_a` summing to 1, produced out-of-sample (`walk-forward-validation`).
2. Evidence they are calibrated, and that the model is not worse than the market on RPS (`probability-calibration`).
3. A devigged market probability for the same outcome (`odds-analysis`).

If a model does not beat the market's devigged close on RPS over hundreds of matches, treat its disagreements as noise unless you can say what information it has that the market lacks.

## The Math

For one outcome, with model probability `p` and decimal odds `d` (convert American first):

```
EV per unit staked = p * d - 1
Edge (probability points) = p_model - p_fair_market
Break-even probability = 1 / d                (raw implied, includes the margin)
```

Edge against the fair market and EV against the price are different. A 3-point edge over the fair probability may be a smaller EV, or none, once the margin is taken into account: you pay the margin on every bet.

**Fractional Kelly stake (single outcome):**

```
f_full = (p * d - 1) / (d - 1)
stake = fraction * f_full * bankroll         fraction usually 0.1 to 0.25
```

Full Kelly assumes your `p` is exact. It never is. Estimation error makes full Kelly overbet; quarter Kelly or less is more realistic. Cap each stake (for example 2% of bankroll).

**One match, three outcomes.** The outcomes are mutually exclusive. Do not size three independent Kelly bets on home, draw and away of one match. Bet at most the single best-EV outcome, or solve the joint Kelly problem. Correlated bets across matches on the same weekend also share bankroll; keep the total exposure per weekend capped.

**Shrink toward the market.** Before computing EV, blend:

```
p_used = w * p_model + (1 - w) * p_fair_market        w between 0.2 and 0.6 until your model has a long out-of-sample record
```

The disagreement that survives shrinkage is the one worth looking at.

## How It Works

**Step 1: Get the prices.**

```
get_odds {"game_id": "740968"}
```

(Use a match that has not started if you are acting on the price. 740968 is finished and is used here to illustrate.)

**Step 2: Devig.** Compute no-margin probabilities per book with `odds-analysis`, and take Pinnacle or the exchange as the benchmark if present.

**Step 3: Compare per outcome.** For each of home, draw and away, find the best available price across books, then compute EV with your `p_used`.

**Step 4: Test the edge.**

| Check | Pass condition |
|-------|----------------|
| Edge size | At least about 2 to 3 probability points after shrinkage, more for longshots |
| Source | Your model has an informational reason, not just a different method |
| Price | Still available at your stake size; limits apply |
| Timing | Is it before the close, and does the line tend to move toward you? |
| Variance | Check the odds: a +290 bet loses most of the time even with edge |

**Step 5: Record and follow up.** Log the price you took, the model probability, and later the closing fair probability.

## Worked Example

Arsenal away at Crystal Palace, closing prices from `get_odds {"game_id": "740968"}`. Pinnacle's no-margin close: home 0.233, draw 0.256, away 0.511. The best away price was `-106` at Betfair Exchange (decimal 1.943).

Suppose your model said Arsenal win 0.55 (an illustrative number, not a StrikerAPI output):

```
EV = 0.55 * 1.943 - 1 = +0.069         (6.9% of stake)
Edge vs Pinnacle fair = 0.55 - 0.511 = 3.9 points
Full Kelly = 0.069 / 0.943 = 7.3% of bankroll;  quarter Kelly = 1.8%
Shrunk to w = 0.4: p_used = 0.4 * 0.55 + 0.6 * 0.511 = 0.527;  EV = 0.527 * 1.943 - 1 = +0.023
```

Shrinkage cuts the EV from 6.9% to about 2.3%, and the exchange commission (not included here) would take more. That is the realistic scale of a good edge: low single digits, with a standard deviation per bet near 100% of the stake. At a stake of 1 unit, an expected gain of 0.023 per bet and a standard deviation near 1.0 means about 1,900 bets for the expected gain to be one standard error from zero. It is a long game, and the proof is in the closing line, below.

## Closing Line Value

The closing price from the sharpest books is the best public estimate of the true probability. If your bets consistently beat it, your information was real even if short-run results are noisy.

```
CLV (percent) = d_bet * p_close_fair - 1        d_bet: decimal odds you took;  p_close_fair: devigged closing probability
```

For the example above, taken at `-106` against Pinnacle's fair 0.511: `1.943 * 0.511 - 1 = -0.7%`. The price was available at the close, and it was not better than the sharp close by much. Taking it early and finding the close moved your way would give a positive CLV.

Report average CLV over at least 100 bets with a standard error. Positive average CLV with a standard error below the mean is the first sign the process works. Results (win rate, ROI) need thousands of bets to be informative.

## Pitfalls

1. **Edge equals model error.** The most likely explanation for a big edge is that your model is wrong. Check lineups, injuries and news before believing it.
2. **Stale prices.** A soft book lagging the market gives a price you cannot get at size. Check `captured_at` and the source.
3. **Margin ignored.** Compare against the devigged fair probability for edge, and against the raw price for EV.
4. **Betting the draw because it is "undervalued".** Test calibration of your draw probability first. It is the weakest part of most models.
5. **Handicap and total prices.** Many Odds API rows have no handicap or total. Only price a total from a book that posted one.
6. **Overbetting Kelly.** Fractional Kelly and a stake cap, always.
7. **Selection bias.** Scanning 200 matches for the biggest disagreement selects for model error. Out-of-sample testing over the whole scan is the check.
8. **No promises.** Past performance of a method does not predict returns. Present edges as estimates and state the variance.

## Anti-patterns

| Rationalization | Why It's Wrong | Do This Instead |
|----------------|---------------|-----------------|
| "Model 55% vs implied 51%, bet" | Implied includes the margin; model is unproven | Shrink, devig, check calibration |
| "Kelly says 7%" | Overbets with estimation error | Quarter Kelly with a cap |
| "Bet home, draw and away, each has edge" | Mutually exclusive outcomes | One bet per match or joint Kelly |
| "I won 60% so my edge is real" | Variance | CLV over many bets |
| "Higher edge on longshots is better" | Long-shot variance and favorite-longshot pricing | Demand a larger edge on longer prices |

## Output Format

```
[Match] [competition] [kickoff]
Outcome  Model  Fair (benchmark)  Best price @ book  EV    Edge
Home     [p]    [p] (Pinnacle)    [+x] @ [book]      [x%]  [pts]
Draw     ...
Away     ...
Shrunk (w = [w]): best EV [x%] on [outcome]; stake [x%] of bankroll (quarter Kelly, cap [x%])
Caveats: [model record, lineup unknowns, price source, commission]
```

## What to Do Next

| What You Found | Next Action | Skill |
|----------------|-------------|-------|
| Apparent edge | Test the strategy over history | `backtesting` |
| Model unvalidated | Walk-forward evaluation | `walk-forward-validation` |
| Probabilities unproven | Calibration | `probability-calibration` |
| Goalscorer price looks off | Prop model | `goalscorer-prop-modeling` |
