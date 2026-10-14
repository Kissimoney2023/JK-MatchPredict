---
name: match-preview
description: "Builds a pre-match preview for one soccer fixture by combining league position, form, xG for and against, Elo ratings, head to head, lineups when available and the market line, with a credit budget. Use when the user asks for a preview, a matchup breakdown, who is favored and why, or what to know before a specific fixture. Do not use for a post-match recap, see match-lookup. Do not use for finding betting value, see edge-detection. Do not use for a whole-slate card with many fixtures."
metadata:
  version: 1.0.0
  author: StrikerAPI
---

# Match Preview

> **Default data tool:** StrikerAPI (`strikerapi-tool`).
> A full preview costs about 20 credits: `get_schedule` 2, `get_standings` 2, `get_team_stats` 5, `get_ratings` 2, `get_head_to_head` 2, plus `get_odds` 5 for each book's price. Add `get_lineups` 5 and `get_shot_map` 10 per club only when asked.

This is a compound skill. It does not introduce new data; it sequences the calls from `team-analysis`, `elo-ratings`, `odds-explorer` and `xg-analysis` in the cheapest order and assembles one readable page.

## When to Use

- "Preview Liverpool vs Manchester City"
- "What should I know before Saturday's Arsenal match?"
- "Who is favored and why?"
- Preparing a matchday post or newsletter

## When NOT to Use

- A match that already finished: `match-lookup`
- "Is there value on this match?": `edge-detection`, which needs a model probability
- Season-long club review: `team-analysis`
- Ten fixtures at once: run this per fixture only after costing it; a weekend of 10 matches is about 200 credits

## Commands Used

| Step | Command | Credits |
|------|---------|---------|
| Find the fixture and its median line | `get_schedule` (with `team`) | 2 |
| Table position, home and away, form | `get_standings` | 2 |
| xG for and against, whole league | `get_team_stats` (no `team`) | 5 |
| Elo and its gap | `get_ratings` | 2 |
| Meetings in this competition | `get_head_to_head` | 2 |
| Each book's price | `get_odds` with `game_id` | 5 |
| Formations (only once published) | `get_lineups` | 5 |
| Shot profile | `get_shot_map` with `team` | 10 |

## Commands That Do NOT Exist

| Not Available | Use Instead |
|--------------|-------------|
| `get_preview`, `get_prediction` | Assemble from the calls above. StrikerAPI provides no match forecast; any probability you state is your model's or the market's |
| `get_injuries`, `get_suspensions` | Not available. Say availability is unknown, or read `get_lineups` once lineups exist |
| `get_referee`, `get_weather` | Not available |
| `get_team_form` | The `form` field in `get_standings` |

## How It Works

**Step 1: Locate the fixture.**

```
get_schedule {"team": "LIV", "days": 7}
```

The row gives `game_id`, `starts_at`, venue, and `line` (median `home_ml`, `draw_ml`, `away_ml`, `total`, `home_handicap`, and `implied`).

**Step 2: Table and form.** One `get_standings` call; read both clubs' `rank`, `points`, `home`, `away`, `form`.

**Step 3: Underlying numbers.** One `get_team_stats` call without `team` returns all clubs. Take both clubs' `xg_for`, `xg_against`, `shots_for`, `shots_against`, and compute xG difference per match.

**Step 4: Ratings.** One `get_ratings` call (use `limit` of 50 or more so both clubs appear). The Elo difference plus the home bonus gives an expected score; see `elo-ratings` for the formula.

**Step 5: History.** `get_head_to_head` for the pair. Weight the last three or four meetings over the lifetime record, and say how many meetings that is.

**Step 6: The market.** The schedule `line.implied` values are the raw prices converted to probabilities, so they sum to more than 1. Remove the margin (see `odds-analysis`) before quoting them as the market's view. For a per-book view add `get_odds` with the `game_id`.

**Step 7: Lineups.** `get_lineups` only returns something useful once clubs have named their teams. Check the response before building anything on it. If it is empty, say lineups are not out.

## Worked Example

Premier League, 11 October 2026. The `get_schedule` example in the StrikerAPI docs shows Liverpool at home to Manchester City with 8 books and a median line of `+244 / +263 / +111` (home, draw, away), total 2.88. Converting the median prices:

```
home +244 -> 0.2907    draw +263 -> 0.2755    away +111 -> 0.4739    sum 1.0401 (4.0% margin)
no-margin (proportional): home 0.279, draw 0.265, away 0.456
```

The market makes City the favorite away from home, in a low-scoring-ish game (median total 2.88 goals).

Cross-check with ratings, from `get_ratings` on 10 October: Manchester City 1670.4, Liverpool 1578.0, a 92.4 gap. With Liverpool's 60-point home bonus the effective gap is 32.4 in City's favor, an expected score of about 0.546 for City (a draw counts as half). The market's no-margin City win (0.456) plus half the draw (0.132) is 0.588, so the market rates City a little higher than the ratings do. That is a flag to look at form and availability, not an edge.

Assembled preview:

```
Liverpool (LIV) vs Manchester City (MNC) - Anfield, 11 Oct 2026
Market (median of 8 books, no-margin): LIV 27.9%  Draw 26.5%  MNC 45.6%  Total 2.88
Elo: MNC 1670, LIV 1578; home bonus 60 -> MNC expected score 0.55
Table: [from get_standings]    Underlying: [xG for/against from get_team_stats]
History: [from get_head_to_head, last 3-4 meetings]
Unknowns: lineups, injuries (no data source here)
```

## Reading the Pieces Together

| Signal | Weight | Why |
|--------|--------|-----|
| Closing market | Highest | It already contains lineups, injuries, news |
| Elo gap with home bonus | High | Stable, but ignores current squad |
| xG difference per match | Medium, grows with matches played | Less noisy than results |
| League position and points | Low early in the season | Six matches is small |
| Head to head | Low | Squads and managers change |
| Form (last five) | Low | Results are noisy; look at the xG behind them |

If the market and your read disagree, trust the market until you can name what it is missing.

## Anti-patterns

| Rationalization | Why It's Wrong | Do This Instead |
|----------------|---------------|-----------------|
| "Quote `implied` as the market's probability" | It includes the margin and sums over 100% | Devig first |
| "They won the last four meetings, so they are favored" | Small sample, changing squads | Show it, weight it little |
| "Loop `get_team_stats` per club" | 5 credits each | One call without `team` |
| "Predict a score" | No forecast is provided and one scoreline is a coin flip | Give a probability range, or use `poisson-score-models` |
| "Say who is injured" | There is no injury data | State the gap |

## Output Format

Lead with the verdict in one sentence, then the table. Always state the competition, date, credits spent, and the unknowns (lineups, injuries). End with one thing that would change the read.

## What to Do Next

| What You Found | Next Action | Skill |
|----------------|-------------|-------|
| Want an independent probability | Fit a score model | `poisson-score-models` |
| Market disagrees with your read | Check for value carefully | `edge-detection` |
| Shot profiles differ | Compare where each side shoots | `xg-analysis` |
