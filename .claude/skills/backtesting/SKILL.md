---
name: backtesting
description: "Backtests soccer betting strategies against historical three-way, handicap and total prices: costs the data pull, settles bets from results, measures ROI with standard errors and closing line value, and flags the traps (opening versus closing prices, stale rows, selection bias, thin samples). Use when the user asks if a strategy would have made money, wants historical closing lines, or wants to test an edge threshold. Do not use for the model's out-of-sample split, see walk-forward-validation. Do not use for devigging, see odds-analysis. Do not use for live bet logging."
metadata:
  version: 1.0.0
  author: StrikerAPI
---

# Backtesting

> **Default data tool:** StrikerAPI (`strikerapi-tool`).
> `get_odds` in season mode is 2 credits per match returned, up to 100 matches a page, with opening and closing prices per sportsbook. `list_games` (2 credits per call) supplies scores. `get_prop_history` (10 credits for up to 200 games) backtests anytime goalscorer prices for one player.

A backtest answers one question: if I had followed this rule using only information available at the time, at prices I could have taken, what would have happened, and how sure am I? Most failed backtests fail on the first clause.

## When to Use

- "Would betting every draw above a 3-point edge have made money?"
- "How did Pinnacle's closing line perform as a predictor?"
- "What is the closing line value of this rule?"
- "Pull a season of closing lines"

## When NOT to Use

- Validating the model itself on rolling out-of-sample data: `walk-forward-validation`
- Live logging of bets you place
- Fair probability math: `odds-analysis`

## Commands Available

| Command | What It Does | Credits |
|---------|-------------|---------|
| `get_odds` | `season` (optionally `team`), `limit` up to 100, `offset` / `next_offset`: priced matches with every book's open and close, handicap, total and the `outcome` | 2 per match |
| `list_games` | Scores and results | 2 per call (up to 200) |
| `get_line_movement` | Intermediate snapshots for matches with them | 10 per match |
| `get_prop_history` | One player's anytime goalscorer close vs result | 10 (up to 200 games) |

## Commands That Do NOT Exist

| Not Available | Use Instead |
|--------------|-------------|
| `get_historical_odds` | `get_odds` with `season` or `date` |
| `run_backtest`, `get_backtest` | Write the loop yourself, below |
| `get_closing_line` | `*_close` fields in `get_odds` |
| `get_results_with_odds` | `get_odds` already returns `outcome` for finished matches |

## What the Data Holds

From the StrikerAPI docs: sportsbook lines from 2017-18, with the densest coverage (about ten books a match) in 2021-22 to 2023-24 and one or two books since; opening and closing lines from The Odds API since June 2020 for 16 competitions; ESPN's lines from 2024, and ESPN's final pre-match line before that. Read the per-season counts at https://strikerapi.com/docs before designing the test.

Check these before trusting a run:

| Check | Why |
|-------|-----|
| `source` per row (`the_odds_api` or `espn`) | Only Odds API rows carry open and close. ESPN rows often have `null` opens |
| Number of books per match | A season with one or two books cannot support a "best price" rule |
| `null` handicap and total | Most Odds API rows have none; Pinnacle often does |
| Priced matches versus played | Arsenal's 2025-26 `get_odds` returned `count: 27`, not 38. Not every match is priced |
| `captured_at` | Not a kickoff time for ESPN backfills |

## Cost the Pull First

```
priced matches x 2 credits
380 matches   = 760 credits
one club only (team set) ~ 27-38 matches = 54-76 credits
```

The free tier's 500 monthly credits cover about 250 matches. Start with one club or one half-season to design the test, then scale.

```python
def pull_season(season, team=None, league="soccer"):
    out, offset = [], 0
    while True:
        args = dict(season=season, limit=100, offset=offset, league=league)
        if team:
            args["team"] = team
        page = call("get_odds", **args)
        out += page["games"]
        if page.get("next_offset") is None or not page["games"]:
            return out
        offset = page["next_offset"]
```

Verified shape, `get_odds {"season": 2025, "team": "ARS", "limit": 3}` returned `{"games": [...], "count": 27, "next_offset": 3}` for 6 credits, oldest match first. Cache every page to disk keyed by arguments.

## Settlement

Three-way market, decimal odds `d`, picked outcome `pick` in `{H, D, A}`:

```python
def dec(american):
    return 1 + american / 100 if american > 0 else 1 + 100 / -american

def settle_1x2(result, pick, d):
    return d - 1 if result == pick else -1.0         # profit per 1 unit stake
```

`result` comes from `outcome.result` in the `get_odds` row. For totals, settle from the real score, not the `over` flag, because `over` is against the median total and each book's line differs:

```python
def settle_total(goals, line, side, d):
    parts = [line] if (line * 2) % 1 == 0 else [line - 0.25, line + 0.25]   # quarter lines split in two
    out = []
    for ln in parts:
        if goals == ln:
            out.append(0.0)                                  # push on a whole-number line
            continue
        win = goals > ln if side == "over" else goals < ln
        out.append(d - 1 if win else -1.0)
    return sum(out) / len(out)
```

Tested: a 3-goal match on `over 2.75` at 1.90 returns +0.45 (half the stake wins 0.90, half pushes); on `over 3.0` it pushes (0.0); a 2-goal match loses the full stake (-1.0). Handicaps need the same split logic with goal difference. Skip them until the 1X2 and total settle correctly.

## The Loop

```python
def backtest(games, rule):
    bets = []
    for g in games:
        for bet in rule(g):                      # rule sees only fields available at bet time
            bets.append({**bet, "result": g["outcome"]["result"], "game": g["game_id"], "date": g["date"]})
    return bets
```

The rule function receives only the opening line and what you knew then. Passing it the full `g` with `*_close` fields is how leakage creeps in. Give the rule a stripped copy.

## Metrics

```
ROI = total profit / total staked                  (flat stake of 1 per bet)
SE(ROI) = std(profit per bet) / sqrt(n)             std is near 1 for even-money and above for longshots
CLV per bet = d_taken * p_close_fair - 1            p_close_fair: devigged close for the same outcome
```

`p_close_fair` comes from `close_prob` in the same row (proportional devig) or from your own Shin calculation (`odds-analysis`). Report CLV beside ROI. CLV converges in hundreds of bets; ROI takes thousands.

Sample size guide: with a standard deviation near 1 per bet, a 5% ROI is one standard error from zero at about 400 bets and two at about 1,600. Most strategies on a single league-season have 20 to 200 bets and nothing can be concluded.

## Worked Example

Rule: bet Arsenal's win at Pinnacle's opening price. Three early-season 2025-26 matches from the verified call above, with open and close for Arsenal's win:

```
date        match          open   close  close fair  d_open  result  profit  CLV
2025-08-17  MAN 0-1 ARS    +103   -109   0.507       2.03    won     +1.03   +2.9%
2025-08-23  ARS 5-0 LEE    -371   -295   0.725       1.27    won     +0.27   -8.0%
2025-08-31  LIV 1-0 ARS    +258   +207   0.317       3.58    lost    -1.00   +13.5%
```

CLV is `d_open * close_fair - 1`. In the first and third matches the market moved toward Arsenal after the open (their price shortened), so the opening price beat the close. In the second the price lengthened, so the opening price was worse. Profit across the three bets is +0.30 units on 3 staked (10% ROI), and mean CLV is +2.8%.

Three bets tell you nothing about the rule. They show how the settlement and CLV columns are built, and that profit and CLV are different things: the third bet lost and still had the best CLV.

## Pitfalls

1. **Closing prices as entry prices.** You cannot bet a close after the close. Only enter at an open or a snapshot your process could have seen. Closing prices are the right benchmark for CLV, not an entry.
2. **Look-ahead in the rule.** Anything in the row computed from the close or the result is off limits at entry.
3. **Best price across books.** If a season has one or two books, there is no "best price". Where there are many, assume you get the median, not the best, unless you actually shop.
4. **Account limits.** Sharp bettors get limited. A backtest at unlimited size overstates what you could do.
5. **Selection bias.** Trying 30 thresholds and reporting the best is a fit to noise. Fix the rule first, or hold out a final season.
6. **Mixed sources.** Don't average ESPN and Odds API rows of different timing. Say which you used.
7. **Void and abandoned matches.** Exclude with a count.
8. **Survivorship of data.** The priced matches are not a random sample of all matches. State the coverage.
9. **Stakes.** Flat-stake results are the honest baseline; staking by edge or Kelly compounds noise.
10. **No promises.** A backtest is evidence about a rule on past data, not a forecast.

## Anti-patterns

| Rationalization | Why It's Wrong | Do This Instead |
|----------------|---------------|-----------------|
| "ROI 12% on 80 bets" | One standard error is about 11% | Show SE and n |
| "Bet at the close" | Not actionable | Enter at open or a snapshot, benchmark at close |
| "Fit threshold on all data" | Overfit | Choose before, or walk forward |
| "Skip matches without odds" | Hidden selection | Report coverage |
| "Compare to 0 ROI" | The market loses the margin on average | Compare ROI to the margin you pay (the overround) as well |

## Output Format

```
Strategy: [rule in one line]   Data: [competition, seasons, source, books]
Bets: [n]   Staked: [n units]   Profit: [x] units   ROI: [x%] +/- [se%]
CLV: mean [x%] +/- [se%] (n = [n])
Coverage: [priced matches] of [played]   Credits spent: [n]
Verdict: [one line with the sample-size caveat]
```

## What to Do Next

| What You Found | Next Action | Skill |
|----------------|-------------|-------|
| Positive CLV, small ROI sample | Keep collecting, do not scale | `edge-detection` |
| Model needs a better test | Walk-forward evaluation | `walk-forward-validation` |
| Goalscorer rule | Backtest with `get_prop_history` | `goalscorer-prop-modeling` |
