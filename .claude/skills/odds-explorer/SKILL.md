---
name: odds-explorer
description: "Compares soccer three-way moneylines (home, draw, away), goal handicaps and totals across sportsbooks, finds the best price on each outcome, reads overround and line movement, and checks opening versus closing lines. Use when the user asks about the odds on a match, the best price for a draw, which book is sharpest, or how a line moved before kickoff. Do not use for removing the margin or true probabilities, see odds-analysis. Do not use for comparing a model to the market, see edge-detection. Do not use for goalscorer prices, see goalscorer-prop-modeling."
metadata:
  version: 1.0.0
  author: StrikerAPI
---

# Odds Explorer

> **Default data tool:** StrikerAPI (`strikerapi-tool`).
> `get_schedule` (2 credits) for the median line on upcoming fixtures. `get_odds` with `game_id` (5) for every book on one match, with `date` (10) for a day, with `season` (2 per match) for a block. `get_line_movement` (10) for pre-kickoff snapshots.

Soccer is a three-way market: home win, draw, away win. A two-outcome habit from other sports, such as comparing only the favorite and underdog, throws away the draw, which is about a quarter of matches. This skill reads the whole triple.

## When to Use

- "What are the odds on Liverpool against City?"
- "Which book has the best price on the draw?"
- "How much margin is each book charging?"
- "Did the line move toward the home side?"
- "What was the closing line for this finished match?"

## When NOT to Use

- Converting prices to fair probabilities: `odds-analysis`
- Deciding whether a price is value against your model: `edge-detection`
- Backtesting across a season: `backtesting`
- Anytime goalscorer prices: `goalscorer-prop-modeling`

## Commands Available

| Command | What It Does | Credits |
|---------|-------------|---------|
| `get_schedule` | Upcoming fixtures with `line`: books count, median `home_ml`, `draw_ml`, `away_ml`, `total`, `home_handicap`, `implied` | 2 |
| `get_odds` | Per-book three-way moneyline, handicap, total, with open and close, and for finished matches the outcome | 5 (`game_id`), 10 (`date`), 2 per match (`season`) |
| `get_line_movement` | Time series of each book's `home_ml`, `draw_ml`, `away_ml`, `home_handicap`, `total` before kickoff | 10 |
| `get_game` | Includes each book's opening and closing line inside a full match (5) | 5 |

## Commands That Do NOT Exist

| Not Available | Use Instead |
|--------------|-------------|
| `get_live_odds` | `get_odds` for a match, `get_schedule` for the median line. No in-play prices |
| `get_best_odds` | Compare the `books` array from `get_odds` yourself |
| `get_btts_odds`, `get_corners_odds`, `get_card_odds` | Not available. The markets are three-way moneyline, goal handicap and goal total |
| `get_closing_line` | The `*_close` fields in `get_odds` |
| `get_public_betting` | Not available. Infer from movement only, cautiously |

## What the Prices Look Like

Moneylines are American odds. A home price of `+290` risks 100 to win 290. A price of `-118` risks 118 to win 100. The three prices for one book sum to more than 100% implied, and the excess is the overround.

`get_odds` returns, per match, a `books` array. Per book:

| Field | Meaning |
|-------|---------|
| `provider`, `source` | Book name; `the_odds_api` or `espn` |
| `home_ml_open`, `home_ml_close` (and `draw_`, `away_`) | Opening and closing moneyline. ESPN rows often have `null` opens |
| `close_prob` | No-margin home, draw and away probabilities plus `overround` |
| `home_handicap_*`, `total_*`, `over_odds`, `under_odds` | Goal handicap and total where posted. Many Odds API rows have `null` here |
| `captured_at` | When the row was captured. For ESPN rows on old matches it can be well after the match, so it is not a kickoff timestamp |

For a finished match there is also `outcome`: `result` (`H`, `D`, `A`), `median_total`, `median_home_handicap`, `over`, `home_covered`.

## How It Works

**Step 1: Get the match id.** `get_schedule` for upcoming, `list_games` (see `match-lookup`) for past.

**Step 2: Pull every book.**

```
get_odds {"game_id": "740968"}
```

**Step 3: Find the best price per outcome.** Independently for home, draw and away, take the highest American number (the largest payout). For `+330` versus `+290`, `+330` is better. For `-106` versus `-118`, `-106` is better. The best price for each side usually sits at a different book.

**Step 4: Measure each book's margin.** Convert each price to implied probability, sum the three, subtract 1.

```
implied(+x) = 100 / (x + 100)          implied(-x) = x / (x + 100)
overround   = implied_home + implied_draw + implied_away - 1
```

Betting exchanges and Pinnacle typically run far below high-street books. `close_prob.overround` gives it directly.

**Step 5: Clean the rows before ranking.** Drop or flag a book whose three prices sum to less than 100% (negative overround) or far above 115%. Exchange snapshots in thin markets produce nonsense. In one line-movement pull, an exchange row early in the series read `-323 / -1000 / -323`, which is not a real market.

**Step 6: Movement.** `get_line_movement` returns snapshots per book. ESPN lines are captured once a day, The Odds API lines hourly for matches in the next two days, so a quiet series is not necessarily a quiet market.

```
get_line_movement {"game_id": "401879267"}
```

Compare the first and last real snapshot per book, in implied probability rather than raw price, because a move from `+230` to `+200` and from `-110` to `-125` are different sizes.

## Worked Example

Crystal Palace vs Arsenal, closing lines from `get_odds {"game_id": "740968"}` (Arsenal won 2-1, `result` A):

```
book              home    draw    away    overround
888sport          +290    +250    -118     8.3%
Bet 365 (espn)    +310    +260    -118     6.3%
Betfair Exchange  +330    +290    -106     0.4%
DraftKings        +300    +270    -110     4.4%
FanDuel           +320    +260    -115     5.1%
Marathonbet       +315    +274    -110     3.2%
Pinnacle          +317    +279    -111     3.0%
William Hill      +290    +250    -118     8.3%
```

Best home price: `+330` (Betfair Exchange). Best draw: `+290` (Betfair Exchange). Best away: `-106` (Betfair Exchange), then `-110`. Lowest margin: the exchange at 0.4%, then Pinnacle at 3.0%. The same book at the worst prices (888sport, William Hill) costs about 8% overround, so the choice of book moves the expected cost of a bet by several percent. The match total: Pinnacle `2.75` with `-106` over and `-104` under; William Hill `2.5`; `outcome.median_total` was `2.75` and the total went over (`over: true`).

Opening versus closing for the home price at Pinnacle was `+649` to `+317`: the market moved heavily toward the home side's chance (Arsenal were still favorites at `-111`), which shows how much information gets priced in during the final days.

## Reading Movement

| Pattern | Reading |
|---------|---------|
| All books shorten the same side together | Information or heavy money; follow the sharpest book first |
| One soft book lags the others | A stale price, a line-shopping chance, not a signal |
| Draw price drifts while home and away hold | Often margin redistribution, not a view on the match |
| Total moves 2.5 to 2.75 | Quarter lines: the book is shading, price the over and under at the stated odds |

Do not treat movement as a bet signal by itself. The closing line is the best public estimate; use it as the benchmark in `edge-detection`.

## Anti-patterns

| Rationalization | Why It's Wrong | Do This Instead |
|----------------|---------------|-----------------|
| "Compare home and away only" | The draw holds about a quarter of the probability | Always show all three |
| "Best price at one book for all three" | Best prices sit at different books | Choose per outcome |
| "Pinnacle open to close is a steady line" | Compare `source`: ESPN and Odds API rows differ in timing | Report the source with each number |
| "Trust any row" | Thin exchange snapshots can be garbage | Sanity check overround |
| "Median across books is a real line" | Medians such as `2.88` or `0.13` are not postable lines | Use them for comparison, not as a bet |

## Output Format

```
[Home] vs [Away] - [date], [competition]
Best home: [price] @ [book]    Best draw: [price] @ [book]    Best away: [price] @ [book]
Lowest margin: [book] [x.x]%   Highest: [book] [x.x]%
Total: [line] ([over] / [under]) @ [book]
Movement: [book] [open] -> [close], implied [x]% -> [y]%
Credits: [n]
```

## What to Do Next

| What You Found | Next Action | Skill |
|----------------|-------------|-------|
| Need true probabilities | Remove the margin | `odds-analysis` |
| Have a model number | Compare to the devigged close | `edge-detection` |
| Many matches needed | Cost the season first | `backtesting` |
| Want context for the match | Form, Elo, xG | `match-preview` |
