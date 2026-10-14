---
name: goalscorer-prop-modeling
description: "Models anytime goalscorer probabilities for soccer players and compares them with sportsbook prices: expected minutes and start probability, non-penalty xG per 90 with shrinkage, penalty duty, team goal expectation from the match market, one-sided price handling, voids, and backtests with get_prop_history. Use when the user asks who will score, whether a goalscorer price is fair, or how to build a scorer model. Available for the Premier League, MLS, La Liga, Serie A, Bundesliga, Ligue 1 and Champions League only. Do not use for team totals, see poisson-score-models. Do not use for general edge sizing, see edge-detection."
metadata:
  version: 1.0.0
  author: StrikerAPI
---

# Goalscorer Prop Modeling

> **Default data tool:** StrikerAPI (`strikerapi-tool`).
> `get_player_props` (10 credits, or 0 with `estimate_only`) for the prices. `get_prop_history` (10 credits for up to 200 games) for one player's prices against results. `get_shot_map` (10) with `player` for shot quality. `get_player` (5) and `get_player_games` (5) for minutes and rates. `get_lineups` (5) for starters.

The anytime goalscorer market asks one question: will this player score at least once? It is the only player prop StrikerAPI carries. Prices are a Yes price per player, with no line. The structure of the market (one-sided, margin-heavy, voided when a player does not play) drives most of the method.

## Coverage

Anytime goalscorer prices exist for seven competitions: the Premier League (`soccer`), MLS (`mls`), La Liga (`laliga`), Serie A (`seriea`), the Bundesliga (`bundesliga`), Ligue 1 (`ligue1`) and the Champions League (`ucl`). Per the StrikerAPI README, the Premier League and MLS start in April 2024, Ligue 1 in May 2024, La Liga, Serie A and the Bundesliga in August 2024, and the Champions League in March 2025. DraftKings and FanDuel cover most matches, with Pinnacle and William Hill on some matches in 2026. There are no prices for the other ten competitions; other player markets (shots, assists, cards) do not exist.

## When to Use

- "What is the chance Haaland scores this weekend?"
- "Is +250 fair for this winger?"
- "Rank the likeliest scorers for a match"
- "How often did he score when priced under even money?"

## When NOT to Use

- Match results, totals, handicaps: `poisson-score-models`
- Generic EV and staking rules: `edge-detection`
- Player profiles without prices: `player-scouting`

## Commands Available

| Command | What It Does | Credits |
|---------|-------------|---------|
| `get_player_props` | Anytime goalscorer prices. `game_id` for every player in a game; or `player_id` with `from_date` (and `to_date`) for one player across games. `bookmaker`, `snapshot_type` (`closing` default or `opening`), `market`, `estimate_only` | 10 (game); 10 per game returned for a player |
| `get_prop_history` | One row per game: closing price (median across books, or one `bookmaker`), opening line, whether he scored, `result`, over rate. `from_date`, `to_date`, `limit` up to 200, `next_from_date` to continue | 10 for up to 200 games |
| `get_shot_map` | The player's shots with `xg`, `penalty`, `zone`, `body_part` | 10 |
| `get_player` | Per-season minutes, goals, xG, per-90 rates | 5 |
| `get_player_games` | Match log with minutes on and off | 5 |
| `get_lineups` | Starting XI and bench for a match | 5 |
| `search_players` | Player id | 1 |

For one player over many games, `get_prop_history` (10 credits for up to 200 games) is far cheaper than `get_player_props` with `player_id` (10 credits per game).

## Commands That Do NOT Exist

| Not Available | Use Instead |
|--------------|-------------|
| `get_player_props` for shots, assists, cards, first scorer | Not available; only `player_goal_scorer_anytime` exists |
| `get_goalscorer_odds` | `get_player_props` |
| `get_penalty_takers` | Count `penalty: true` shots in `get_shot_map` with `player` |
| `get_expected_lineup`, `get_injuries` | Not available. `get_lineups` once teams are named |

## What a Price Row Looks Like

From `get_player_props {"game_id": "740968"}` (closing, Premier League, 34 rows for 17 players across two books):

```
player             book        over_odds  under_odds
Gabriel Martinelli draftkings  250        null
Gabriel Martinelli fanduel     250        null
Daniel Munoz       draftkings  550        null
Daniel Munoz       fanduel     650        null
Christian Norgaard draftkings  900        null
```

`over_odds` is the Yes price, an American price. `under_odds` is the No price where a book posts it; in this match it was `null` for every row. `line` is `null` because the market has no line. `source` was `the_odds_api`.

`get_prop_history` rows add `actual` (goals), `result` and `books`. For Haaland (`player_id` 253989) from April 2024, five rows:

```
game_date   over_odds  actual  result   books
2024-04-28    +300       1     over       1
2024-05-04    -260       4     over       2
2024-05-11    -195       0     under      2
2024-05-14    -185       2     over       2
2024-05-19    -290       0     under      2
summary: games 5, graded 5, overs 3, unders 2, over_rate 0.6
```

`over` means he scored, `under` means he played and did not, and a `null` result is a void: he was not in the squad or did not play. Leave voids out of hit rates, and treat the book's own rules on voids as the source of truth for settlement.

## The Model

**Step 1: Scoring rate.** Goals follow a Poisson process well enough that:

```
P(scores at least once) = 1 - exp(-lambda)
lambda = expected goals the player scores in the match (open play plus penalties)
```

**Step 2: Build lambda.**

```
lambda = lambda_open_play + lambda_penalty
lambda_open_play = npxg90_shrunk * (expected_minutes / 90) * team_factor
lambda_penalty   = P(team awarded a penalty) * P(he takes it) * penalty_conversion
```

- `npxg90_shrunk`: non-penalty xG per 90. Take shots from `get_shot_map` with `player`, drop `penalty: true`, sum `xg`, divide by his minutes. Shrink toward his position's average with a prior of about 900 minutes: `(xg + prior_rate * 10) / (minutes / 90 + 10)`. A forward on 400 minutes should be mostly the prior.
- `expected_minutes`: `start_prob * minutes_if_start + (1 - start_prob) * minutes_if_sub`, from `get_player_games` (`minutes on and off`). Use `get_lineups` for `start_prob` once teams are named; otherwise estimate from his share of starts.
- `team_factor`: the club's expected goals in this match divided by its average. Get the club's expected goals from `poisson-score-models`, or back them out of the devigged three-way price and total from `odds-analysis` and `get_odds`. A club with a team total of 2.1 and a season average of 1.5 gets 1.4.
- The penalty term: count his penalties and attempts across seasons from `get_shot_map` (`penalty: true`) and `get_events`; take the league's penalties per match and the conversion rate from the same data, rather than a figure from memory.

**Step 3: Compare with the market.** Convert `over_odds` to an implied probability. Because the market is one-sided, you cannot devig it the usual way.

## One-Sided Prices

The Yes price has a margin built in and, with no No price, there is nothing to normalize against. Options, best first:

1. **Two-sided book.** If `under_odds` is present (where a book posts a No price), devig the pair with the two-way method in `odds-analysis`.
2. **Empirical scale.** Over many matches, compare mean implied probability with the actual scoring rate for similar players. `get_prop_history` gives both in one call. `c = hit_rate / mean_implied`, then `p_market = c * implied`. Five games is not enough; use a hundred or more across players.
3. **Sum check.** The fair probabilities for all players in a team should add up to roughly the expected number of distinct scorers (a bit below the team's expected goals). The match above listed 17 players, and the raw implied probabilities summed to 2.21 at DraftKings and 2.53 at FanDuel, for a match whose total was about 2.75 goals. The lists do not cover every player, so the sums are not a margin estimate. Use this check only when a book prices the whole squad.

## Worked Example

Haaland, Premier League, from `get_player {"player_id": "253989"}`:

```
season 2025: 35 appearances, 2959 minutes, 27 goals, 23.12 xG, xg_per90 0.70
```

A rough baseline for a full 90: `lambda = 0.70`, so `P = 1 - exp(-0.70) = 50.3%`. At his average of 84.5 minutes per appearance, `lambda = 0.70 * 84.5 / 90 = 0.657`, `P = 48.2%`. (Check whether penalties are in that xG: `get_shot_map` with `player` marks them with `penalty: true`. Remove them for the open-play term and add the penalty term back.)

Now compare with the market. In the five-row history above the median closing price implied `0.25, 0.722, 0.661, 0.649, 0.744`, an average of 60.5%, and he scored in 3 of 5 (60%). The market was usually well above 48%. Two reasons, both worth testing: those matches were against weaker opposition (`team_factor` above 1), and the mean implied probability includes the margin. The right response is not to assume the market is wrong; build `team_factor`, then check whether the model's log loss beats the market's over 100+ priced games.

Five games demonstrate the layout of the data, not the quality of a model.

## Backtest

1. For a set of regular goalscorers, `get_prop_history` with `limit` 200 (10 credits each). Cache.
2. For each game, your model probability (using only information available before kickoff) and the market's closing implied probability.
3. Drop voids. Compute log loss and calibration for both; the market is the benchmark.
4. If your model competes, simulate flat stakes at the **opening** price (`snapshot_type: "opening"` in `get_player_props`) and measure CLV against the close with `backtesting`.
5. Report coverage: games priced, books, and the range of dates.

## Pitfalls

1. **Own goals do not count** for the player. Confirm the book's rules; penalties do count.
2. **Voids.** `result: null` is a void, not a loss. Excluding voids from the model's training minutes biases rates up.
3. **Starters versus subs.** A starter's scoring chance is much higher than a substitute's; the price already knows who starts. Use `get_lineups` before comparing.
4. **Overlap.** Players on one team compete for the same goals. Do not stack independent Kelly stakes on many scorers in one match.
5. **Margin.** One-sided prices carry large margins. An edge you cannot see after scaling is not an edge.
6. **Small samples.** A rate built on fewer than 600 minutes is mostly the prior. A scorer's hit rate over 20 games has a standard error near 11 points.
7. **Price source.** Closing is the last price before kickoff and opening is the first captured; prices can move when lineups are released.
8. **Penalty taker changes** move a striker's price a lot. Check who took the last penalties.
9. **No promises.** Treat any edge as an estimate with a wide error band.

## Anti-patterns

| Rationalization | Why It's Wrong | Do This Instead |
|----------------|---------------|-----------------|
| "xG per 90 of 0.7 means 70% to score" | `1 - exp(-lambda)` is about 50% | Convert the rate properly |
| "Normalize the prices to sum to 1" | They do not sum to 1; many players are unpriced | Use an empirical scale or a two-sided book |
| "Fit on closing price" | Not actionable | Evaluate against close, enter at open |
| "Pull each game with `get_player_props`" | 10 credits per game | `get_prop_history` is 10 for 200 games |
| "He scored 4 times, he is hot" | A 4-goal game is a tail event | Look at xG and shots |

## Output Format

```
[Player] ([team]) vs [opponent] - [competition], [date]
Model: lambda [x.xx] (open play [x.xx], penalties [x.xx]), P(score) [p]
Inputs: npxG/90 [x.xx] (shrunk from [x.xx]), expected minutes [n], team factor [x.xx]
Market: [book] [+x] implied [p], scaled [p]
Gap: [pts]   Caveat: [lineup, void rule, sample]
```

## What to Do Next

| What You Found | Next Action | Skill |
|----------------|-------------|-------|
| Model close to market | Fine; there is no edge to chase | none |
| Model differs by several points | Check lineups and team factor, then test | `edge-detection` |
| Want historical evidence | Entry at open, CLV at close | `backtesting` |
| Need the team goal expectation | Fit a score model | `poisson-score-models` |
