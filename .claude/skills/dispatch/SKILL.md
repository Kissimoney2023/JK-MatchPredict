---
name: dispatch
description: "Routes a soccer data, analytics or betting request to the right 2-3 skills. Load this FIRST when a request comes in and you are unsure which of the 16 skills to activate. Prevents loading every skill when only two or three are needed. Do not use when the request already names one skill or one tool."
metadata:
  version: 1.0.0
  author: StrikerAPI
---

# Skill Dispatch Guide

Match the request to a pattern below, load those skills, and stop. Always load `strikerapi-tool` alongside any skill that needs data; it owns tool names, credit costs and the `{"data": ...}` envelope.

## Persona detection

| Signal | Persona | Start with |
|--------|---------|-----------|
| "What is on this weekend?" / exploring | Explorer | `match-lookup`, `odds-explorer` |
| "Build me a model" / "predict scores" | Builder | `poisson-score-models`, `walk-forward-validation` |
| "Who is scoring?" / "scout this player" | Scout | `player-scouting`, `xg-analysis` |
| "Is there an edge?" / "what are the best bets" | Bettor | `odds-analysis`, `edge-detection` |
| "Is my model any good?" | Validator | `walk-forward-validation`, `probability-calibration` |
| "I am new to soccer analytics" | Learner | `xg-analysis`, `elo-ratings` |

## Request patterns

### "What matches are on?" / "Results from last weekend" / "Show me the lineup"
`match-lookup` (list_games, get_schedule, get_game, get_lineups)

### "How is Arsenal doing?" / "Table" / "Home and away form"
`team-analysis` (get_standings, get_team_stats, get_head_to_head)

### "Tell me about Saka" / "Top scorers" / "Compare two forwards"
`player-scouting` (search_players, get_player, get_leaders)

### "What are the odds?" / "Best price on the draw" / "How did the line move?"
`odds-explorer`. If the question turns to true probabilities or margin, add `odds-analysis`.

### "Remove the vig" / "Implied probability" / "Shin" / "Fair odds for the draw"
`odds-analysis`

### "Preview Liverpool vs City"
`match-preview` (pulls form, xG, Elo, head to head and the line). Add `xg-analysis` for shot detail.

### "Shot map" / "xG table" / "Who is overperforming their xG?"
`xg-analysis`

### "Rate the teams" / "Elo" / "Who is strongest?"
`elo-ratings`

### "Predict the score" / "Poisson" / "Dixon-Coles" / "Over 2.5 probability"
`poisson-score-models`. Add `elo-ratings` if ratings are the input, `probability-calibration` before trusting the output.

### "Will Haaland score?" / "Anytime goalscorer" / "Price a scorer"
`goalscorer-prop-modeling`, with `player-scouting` for the player and `xg-analysis` for shot volume. Only seven competitions have prices.

### "Is my model calibrated?" / "Brier" / "Ranked probability score"
`probability-calibration`

### "Is cross-validation okay?" / "Did I leak the future?"
`walk-forward-validation`

### "Where is the edge?" / "Expected value" / "How much to stake?"
`edge-detection`. Needs calibrated model probabilities and devigged market probabilities, so load `odds-analysis` and `probability-calibration` first if either is missing.

### "Backtest this" / "Closing line value" / "Would this have made money?"
`backtesting`, `walk-forward-validation`, `odds-analysis`. Warn about credit cost before pulling a season of odds.

### "Which tool do I call?" / "What does this cost?" / "REST or MCP?"
`strikerapi-tool` only.

## Credit warning gates

Ask the user before any plan that costs more than about 200 credits. Common big ones: a season of `get_odds` (2 credits per match, 760 for a 380-match league), `get_game` in a loop (5 each), `get_events` in a loop (10 each), and `get_prop_history` for many players (10 each).

## When NOT to use this guide

Single-skill requests do not need routing. "Devig +290 / +250 / -118" goes straight to `odds-analysis`.

## What every answer should do

1. Say which competition and season the numbers cover. The default is the Premier League and the latest season.
2. State the credits spent.
3. Treat any edge as an estimate. Warn about variance, small samples and closing-line value, and never promise returns.

## The 16 skills at a glance

| Skill | Use it for |
|-------|-----------|
| `strikerapi-tool` | Tool names, credits, REST and MCP access, the `{"data": ...}` envelope |
| `match-lookup` | Fixtures, results, box scores, events, lineups |
| `team-analysis` | Table, form, xG for and against, head to head |
| `player-scouting` | Player ids, per-90 rates, leaders, match logs |
| `odds-explorer` | Three-way prices, best book, margin, line movement |
| `match-preview` | One fixture end to end |
| `xg-analysis` | Shot maps, xG tables, expected points, finishing |
| `elo-ratings` | Reading and building Elo ratings |
| `poisson-score-models` | Poisson and Dixon-Coles score models |
| `odds-analysis` | Odds formats and three-way devigging |
| `walk-forward-validation` | Leak-free evaluation |
| `probability-calibration` | Reliability, RPS, scaling |
| `edge-detection` | EV, fractional Kelly, closing line value |
| `backtesting` | Historical strategy tests at real prices |
| `goalscorer-prop-modeling` | Anytime goalscorer probabilities and prices |
| `dispatch` | This guide |

## Common recipes

| Goal | Skills in order | Rough credits |
|------|-----------------|---------------|
| Preview one match | `match-preview` (loads `odds-explorer` and `elo-ratings` pieces) | 20 |
| Is this price fair? | `odds-explorer`, `odds-analysis` | 5 |
| Price a match from scratch | `poisson-score-models`, `odds-analysis`, `edge-detection` | 10 to 30 |
| Does my model beat the close? | `walk-forward-validation`, `probability-calibration`, `backtesting` | 760 for a league-season of prices, 54 to 76 for one club |
| Scout a striker | `player-scouting`, `xg-analysis` | 20 to 30 |
| Price an anytime scorer | `goalscorer-prop-modeling`, `player-scouting` | 30 to 40 |
| Build an xG table | `xg-analysis` | 5 |

## Disambiguation

| The user says | They probably want | Not |
|---------------|-------------------|-----|
| "odds" | `odds-explorer` for prices, `odds-analysis` for probabilities | Both at once |
| "probability" of a result | `elo-ratings` or `poisson-score-models` for a model, `odds-analysis` for the market | A guess |
| "form" | `team-analysis` (the `form` letters, xG trend) | `player-scouting` |
| "rating" | `elo-ratings` | A player rating, which is not provided |
| "expected goals" | `xg-analysis` | `poisson-score-models` unless they want predictions |
| "prop" | `goalscorer-prop-modeling` (the only prop) | Shots, cards, assists (not available) |
| "value" | `edge-detection` | `odds-explorer` |
| "predict" | `poisson-score-models` | `match-preview` (no forecast) |
| "model is bad" | `probability-calibration` first, then `walk-forward-validation` | New features |

## Out of scope

StrikerAPI has no injury, transfer, in-play, live-score, or non-goalscorer player-prop data. If the request needs them, say so and offer the nearest alternative (for example `get_lineups` for confirmed starters, `get_line_movement` for pre-kickoff price changes).

## Free tier

The free tier is 500 credits every month, no card. A single-match preview is about 20 credits and a season xG table is 5, so most exploration fits. A full season of closing prices (760 credits) does not; plan around one club, or see https://strikerapi.com/pricing.
