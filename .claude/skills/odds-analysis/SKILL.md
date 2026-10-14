---
name: odds-analysis
description: "Converts soccer odds between American, decimal and fractional formats and removes the bookmaker margin from three-way (home/draw/away) markets to get no-vig probabilities, using proportional, power and Shin methods, plus two-way devigging for totals and handicaps. Use when the user asks about devigging, implied probability, overround, fair odds, no-vig lines, the draw's true price, or the favorite-longshot bias. Do not use for browsing current odds, see odds-explorer. Do not use for comparing a model to the market, see edge-detection."
metadata:
  version: 1.0.0
  author: StrikerAPI
---

# Odds Analysis

> **Default data tool:** StrikerAPI (`strikerapi-tool`).
> `get_odds` (5 credits for one match) returns each book's open and close with `close_prob`, the no-margin probabilities. `get_schedule` (2) returns a median line. For your own odds CSV the math below needs no credits.

A bookmaker's three prices add up to more than 100%. The excess is the overround. To compare a price with a model, or one book with another, you need the probabilities the prices imply once the margin is taken out. This is prerequisite for `edge-detection` and `backtesting`.

## When to Use

- "What is the true probability of the draw at +250?"
- "Remove the vig from +290 / +250 / -118"
- Converting decimal 3.90 to American, or to a probability
- Comparing a soft book against Pinnacle or an exchange
- Working out how much margin a book charges

## When NOT to Use

- Browsing prices and finding the best one: `odds-explorer`
- Comparing your model to the market for value: `edge-detection`
- Model calibration: `probability-calibration`

## Commands Available

| Command | What It Does | Credits |
|---------|-------------|---------|
| `get_odds` | Per-book three-way prices, handicap, total, open and close, `close_prob` with `overround` | 5 (one match) |
| `get_schedule` | Median line and raw `implied` for upcoming fixtures | 2 |
| `get_line_movement` | Pre-kickoff snapshots, for devigging the open | 10 |

## Commands That Do NOT Exist

| Not Available | Use Instead |
|--------------|-------------|
| `get_fair_odds`, `get_no_vig_odds` | `close_prob` in `get_odds`, or compute below |
| `get_implied_probability` | Compute with the formulas here |
| `get_btts_odds`, `get_correct_score_odds` | Not available; only the three-way moneyline, goal handicap and total |

## Conversion

```
American +x  ->  decimal = 1 + x / 100            implied = 100 / (x + 100)
American -x  ->  decimal = 1 + 100 / x            implied = x / (x + 100)
decimal d    ->  implied = 1 / d
fractional a/b -> decimal = 1 + a / b
```

Examples: `+290` is decimal 3.90 and implied 25.6%. `-118` is decimal 1.847 and implied 54.1%. Always say which format you are in; StrikerAPI returns American.

## Three-Way Devigging

Take implied probabilities `p_h`, `p_d`, `p_a`. Their sum `B` is above 1, and `overround = B - 1`.

### 1. Proportional (multiplicative)

```
fair_i = p_i / B
```

Fast and the default. It removes the same percentage from every outcome, which understates the favorite-longshot effect.

### 2. Power

Find the exponent `k` so that `sum(p_i ** k) = 1`, then `fair_i = p_i ** k`. It shrinks longshots more than proportional.

### 3. Shin

Models the margin as protection against a share `z` of insider money. Solve for `z` so the fair probabilities sum to 1:

```python
from math import sqrt

def shin(implied):
    """Shin devig for any number of outcomes. implied: list of raw implied probabilities."""
    B = sum(implied)
    def fair(z):
        return [(sqrt(z * z + 4 * (1 - z) * x * x / B) - z) / (2 * (1 - z)) for x in implied]
    lo, hi = 0.0, 0.4
    for _ in range(100):
        z = (lo + hi) / 2
        if sum(fair(z)) > 1:
            lo = z
        else:
            hi = z
    return fair(z), z
```

Shin moves probability from longshots to favorites compared with proportional, and returns `z`, an estimate of the insider share, which behaves like a margin score.

### 4. Additive

`fair_i = p_i - (B - 1) / 3`. Can go negative on longshots. Do not use it on skewed markets.

## Worked Example

888sport's close for Crystal Palace v Arsenal, from `get_odds {"game_id": "740968"}`: home `+290`, draw `+250`, away `-118`.

```
implied:      home 0.2564   draw 0.2857   away 0.5413     sum 1.0834  (overround 8.3%)
proportional: home 0.2367   draw 0.2637   away 0.4996
Shin:         home 0.2307   draw 0.2594   away 0.5099     z = 0.042
```

The API's `close_prob` for this row was `home 0.237, draw 0.264, away 0.5, overround 0.083`, which matches the proportional method. So `close_prob` is a proportional devig; if you want Shin or power, compute them yourself from the prices.

Notice the gap. Proportional says Arsenal 50.0%, Shin 51.0%. The one-point difference is bigger than many "edges" people chase. Pick a method and keep it for the whole analysis.

Sharpest reference in the same match, Pinnacle (`+317 / +279 / -111`, overround 3.0%): `close_prob` home 0.233, draw 0.256, away 0.511. A low-margin book is the best single estimate of the market's view, because the margin you remove is small and the method barely matters.

## Choosing a Method

| Situation | Use |
|-----------|-----|
| Low-margin book (Pinnacle, exchange) | Any; they agree within a fraction of a point |
| High-margin book (6-9% overround) | Shin or power; proportional misstates the longshot |
| Heavy favorite and a longshot draw | Shin |
| Quick screening | Proportional |
| Consensus across books | Devig each book, then take the median of fair probabilities |

Exchanges can show an overround near zero (the Betfair Exchange close above was 0.4%), which is liquidity, not a missing margin. Thin early snapshots can produce prices that make no sense (a negative overround). Reject rows with overround below 0 or above about 15%.

## Two-Way Markets: Totals and Handicaps

For a total of 2.75 with over and under prices, the market has two outcomes, so devig as in two-way:

```
fair_over = p_over / (p_over + p_under)
```

Quarter lines (2.25, 2.75, and handicaps like -0.25) settle as two half-stakes on adjacent lines, with a push or half-win possible. Price each half, then average. Whole-number lines can push, which removes that probability from both sides; ignore it only knowing you are doing so.

Handicaps and totals are posted by fewer books. In the 740968 sample, only Bet 365, Pinnacle and William Hill had a total at close.

## Pitfalls

1. **Devig the triple together.** Never devig home and away alone as if the draw did not exist.
2. **Raw `implied` is not a probability.** The `implied` field in `get_schedule` is the raw price converted, summing to more than 1 (1.040 for the median Liverpool v City line). Normalize before quoting.
3. **Medians are not a book.** A median across books does not correspond to any bettable price. Use it for context.
4. **Closing versus opening.** Fair opening probabilities are less informative; the close is the benchmark.
5. **Favorite-longshot bias.** Longshots tend to be overpriced relative to their frequency. Whether it holds for the draw or a given league is an empirical question; test it on closing prices and outcomes (see `backtesting`) before correcting for it.
6. **Compare methods once.** Whatever you choose, apply it to your model benchmarks and your backtest alike.
7. **Never mix formats.** American `-110` and decimal 1.91 are the same price. A mix produces nonsense.

## Anti-patterns

| Rationalization | Why It's Wrong | Do This Instead |
|----------------|---------------|-----------------|
| "Divide the draw by 1.083" | Ignores the other two outcomes' margin share | Devig all three |
| "Use one book's raw prices as probability" | Overround 3-9% | Devig first |
| "Shin is always better" | The difference vanishes on low-margin books | Use it where margin is high |
| "The exchange price is the truth" | Thin books misprice | Check liquidity and overround |
| "Edge = model minus raw implied" | Overstates every edge by the margin | Subtract the devigged probability |

## Output Format

```
[Match] - [book], [open/close]
Prices: H [+x]  D [+x]  A [-x]   overround [x.x]%
Fair (proportional): H [p]  D [p]  A [p]
Fair (Shin, z = [z]): H [p]  D [p]  A [p]
Benchmark: [Pinnacle or exchange] fair H [p] D [p] A [p]
```

## What to Do Next

| What You Found | Next Action | Skill |
|----------------|-------------|-------|
| Fair market probabilities | Compare with a model | `edge-detection` |
| Want to check long-run performance | Test at closing prices | `backtesting` |
| Want to browse more books | Compare prices | `odds-explorer` |
