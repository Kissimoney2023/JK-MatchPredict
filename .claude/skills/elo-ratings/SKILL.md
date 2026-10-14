---
name: elo-ratings
description: "Reads and builds soccer Elo ratings: pulls StrikerAPI's club ratings, converts a rating gap and home bonus into expected score and win/draw/loss probabilities, and builds a custom Elo from match results with tuned K, home advantage, goal-difference scaling and season carryover. Use when the user asks who is strongest, wants ratings as of a date, wants win probabilities from ratings, or wants to build or tune an Elo system. Do not use for score-distribution models, see poisson-score-models. Do not use for league tables, see team-analysis."
metadata:
  version: 1.0.0
  author: StrikerAPI
---

# Elo Ratings

> **Default data tool:** StrikerAPI (`strikerapi-tool`).
> `get_ratings` (2 credits) returns the ratings; `list_games` (2 credits per call of up to 200 matches) supplies results for a custom build.

Elo summarizes a club's strength as one number updated after every result. It is a good baseline: stable, cheap, and hard to beat by much with simple models. It does not know about lineups, injuries, rest, or shot quality.

## When to Use

- "Who is the strongest team in the league?"
- "What did the ratings look like on 1 January?"
- "Turn this rating gap into win probabilities"
- Building or tuning a custom Elo for a league or for a model feature

## When NOT to Use

- Full scoreline distribution, totals, handicaps: `poisson-score-models`
- Current table and form: `team-analysis`
- Calibration of whatever you build: `probability-calibration`

## Commands Available

| Command | What It Does | Credits |
|---------|-------------|---------|
| `get_ratings` | Elo ratings, strongest first. `date` for as-of ratings, `limit` for count (default 50, max 200), `league` | 2 |
| `list_games` | Results for a custom build. `season`, `from`, `to`, `status`, `limit` up to 200, `offset` | 2 |

## Commands That Do NOT Exist

| Not Available | Use Instead |
|--------------|-------------|
| `get_elo`, `get_team_rating` | `get_ratings` and pick the club's row |
| `get_rating_history` | Call `get_ratings` with different `date` values, or rebuild from `list_games` |
| `get_power_rankings` | `get_ratings` |
| Cross-league ratings | Not available. A rating moves only on its own competition's matches |

## The StrikerAPI Rating

The `get_ratings` response states its method: Elo from every final match in the competition, K of 20, a home advantage of 60 points (none at neutral venues), scaled by goal difference, and a third of the way back toward 1500 between seasons. A 400-point gap means 10-to-1 odds, and a 100-point gap is about a 64% expected score for the stronger side at a neutral venue.

```
get_ratings {"limit": 4}
```

```
as_of 2026-10-10
1 MNC Manchester City  1670.4   last game 2026-09-20
2 ARS Arsenal          1663.0   last game 2026-10-10
3 BHA Brighton         1586.5   last game 2026-10-10
4 LIV Liverpool        1578.0   last game 2026-09-20
```

Pass `league` for another competition. In MLS the same call, `get_ratings {"league": "mls", "limit": 2}`, returned Nashville SC (1651.7) and Inter Miami (1609.5) as of 2026-10-11. Those numbers are not comparable to the Premier League's: each competition has its own pool and its own 1500 anchor.

## Expected Score and Probabilities

Elo's expected score for the home side:

```
E_home = 1 / (1 + 10 ** (-(R_home - R_away + H) / 400))        H = 60 at a home venue, 0 if neutral
E_away = 1 - E_home
```

Expected score counts a draw as half a win. That is not a win probability. To split it into home, draw and away you need a draw model:

```
# Davidson model on the Elo scale
x = ln(10) * (R_home - R_away + H) / 400
p_home = exp( x / 2) / (exp(x / 2) + exp(-x / 2) + nu)
p_away = exp(-x / 2) / (exp(x / 2) + exp(-x / 2) + nu)
p_draw = nu            / (exp(x / 2) + exp(-x / 2) + nu)
```

`nu` is one number that sets how often level teams draw. Fit it by maximum likelihood on past results for your league, then check calibration with `probability-calibration`. Draw rates differ by league and era, so refit per competition. The model keeps the ordering Elo implies and draws peak when the teams are level.

Worked example, using the `get_ratings` snapshot above for a hypothetical Manchester City visit to Liverpool: the gap is `1670.4 - 1578.0 = 92.4` in City's favor, minus Liverpool's 60-point home bonus leaves 32.4. `E_city = 1 / (1 + 10 ** (-32.4 / 400)) = 0.546`.

## How It Works: Building Your Own

Use this when you need ratings as a feature with a known time stamp, a different league mix, or a tuned K.

**Step 1: Collect results (cheap).**

```python
games = []
for season in range(2015, 2026):
    for offset in (0, 200):
        page = call("list_games", season=season, status="final", limit=200, offset=offset)
        games += page["games"]
```

Each season is about two calls (4 credits) for 380 matches. Sort by `starts_at`.

**Step 2: Update loop.**

```python
def update(ratings, home, away, hg, ag, k=20, home_adv=60):
    rh, ra = ratings.get(home, 1500), ratings.get(away, 1500)
    exp_h = 1 / (1 + 10 ** (-(rh - ra + home_adv) / 400))
    actual_h = 1.0 if hg > ag else 0.5 if hg == ag else 0.0
    gd = abs(hg - ag)
    mult = 1.0 if gd <= 1 else 1.5 if gd == 2 else (11 + gd) / 8     # goal-difference multiplier
    delta = k * mult * (actual_h - exp_h)
    ratings[home], ratings[away] = rh + delta, ra - delta
```

**Step 3: Season break.** Pull each rating a fraction of the way back to 1500 (or the league mean) before the next season, for example `r = 1500 + (1 - c) * (r - 1500)` with `c` around 0.33. Promoted clubs start below the mean (try 1400 to 1450) or inherit their promotion-playoff level; new clubs are the biggest source of error in the first dozen matches.

**Step 4: Tune.** Grid over `k` (10-40), `home_adv` (40-90), `c` (0.2-0.5) and the multiplier. Score each setting with the ranked probability score on a walk-forward basis (see `walk-forward-validation`), never on the data the ratings were fit to. Pick the simplest setting within noise of the best.

**Step 5: Point-in-time rule.** The rating used for a match must be the one before it. In a backtest, set the feature to the rating before the update, then update. `get_ratings` with `date` helps, but confirm whether a rating dated the match day includes that match by checking `last_game`; use the day before kickoff to be safe.

## Pitfalls

1. **Not comparable across competitions.** Ratings in the Premier League and the Championship are separate pools. Do not subtract them. Champions League ratings are their own pool again.
2. **Draws are not wins.** Expected score is not a probability of winning. Always say which one you are quoting.
3. **Neutral venues.** Cup finals and some Champions League ties have no home advantage; the API applies none, and so should you.
4. **Early season.** Ratings regressed toward the mean still carry last season's squad. Summer transfers do not show up until results do.
5. **Lag.** A rating moves only on results. A club that lost its best player yesterday still has yesterday's rating.
6. **Do not over-tune K.** Differences between K of 18 and 24 are within noise on one league's history.

## Anti-patterns

| Rationalization | Why It's Wrong | Do This Instead |
|----------------|---------------|-----------------|
| "A 100-point gap means 64% to win" | 64% is expected score, with draws as half | Split with a draw model |
| "Subtract an MLS and a Premier League rating" | Separate pools | Compare within one competition |
| "Fit K on all the data, then report accuracy" | Leaks the test set | Walk-forward tuning |
| "Ratings as of the match date are safe" | May include that match | Use the day before |
| "Elo explains the market" | The market knows lineups and news | Treat Elo as a baseline to beat |

## Output Format

```
[Competition] Elo as of [date]
Rank  Club  Rating  Last game
Gap [club A] vs [club B]: [x] points, home bonus [60] -> expected score [x.xx]
Win / draw / loss (draw model fit on [n] matches): [p_h] / [p_d] / [p_a]
```

## What to Do Next

| What You Found | Next Action | Skill |
|----------------|-------------|-------|
| Need a scoreline or totals | Rating as an input to a goals model | `poisson-score-models` |
| Probabilities in hand | Check them against history | `probability-calibration` |
| Want to compare with the market | Remove the margin first | `odds-analysis` |
