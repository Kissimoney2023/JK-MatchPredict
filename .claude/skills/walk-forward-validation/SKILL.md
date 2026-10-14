---
name: walk-forward-validation
description: "Evaluates soccer prediction models without leaking the future: walk-forward and expanding-window splits by matchweek or season, point-in-time features, leakage checks specific to standings, season stats and ratings, and significance testing of a model against the closing line. Use when the user asks whether cross-validation is okay, how to split match data, whether their backtest leaked, or how to compare two models. Do not use for the betting simulation itself, see backtesting. Do not use for probability scaling, see probability-calibration."
metadata:
  version: 1.0.0
  author: StrikerAPI
---

# Walk-Forward Validation

> **Default data tool:** StrikerAPI (`strikerapi-tool`).
> Results history comes cheap from `list_games` (2 credits for up to 200 matches). `get_ratings` with `date` gives point-in-time Elo (2). Most StrikerAPI calls return the state as of today, so rebuilding features as of an earlier date from match logs is usually the safe path.

Soccer data is a time series with a regime change every August. A random k-fold split uses next year's results to predict last year's matches, which makes any model look better than it will be. Walk-forward validation trains on the past, predicts the next block, then steps forward.

## When to Use

- "Can I use 5-fold cross-validation on matches?" (No)
- "Is my model any good?"
- "Did my backtest leak?"
- Choosing between two models, two feature sets or two hyperparameters
- Tuning an Elo or a decay rate

## When NOT to Use

- Simulating stakes and bankroll: `backtesting`
- Turning scores into calibrated probabilities: `probability-calibration`

## Commands Available

| Command | What It Does | Credits |
|---------|-------------|---------|
| `list_games` | Results by `season`, `from`/`to`, `status` for the training stream | 2 per call |
| `get_ratings` | Elo as of a `date` | 2 |
| `get_game` | Per-match xG and box score (5 each, use sparingly) | 5 |
| `get_shot_map` | A club-season of shots with `game_id` and `date`, so you can rebuild xG per match | 10 |
| `get_odds` | Closing prices for the benchmark, `season` mode | 2 per match |

## Commands That Do NOT Exist

| Not Available | Use Instead |
|--------------|-------------|
| `get_standings_as_of` | Not available. `get_standings` returns the table as it stands now (or at season end for a past season); rebuild an as-of table from `list_games` |
| `get_team_stats_as_of` | Not available. `get_team_stats` averages the whole season; rebuild as-of averages from per-match data |
| `get_form_history` | Rebuild from `list_games` |

## The Split

**Expanding window (default).** Train on everything before block `t`, predict block `t`, add block `t` to the training set, step.

**Rolling window.** Same, but drop blocks older than N seasons. Use if the league's style or your model's parameters drift.

Block choice:

| Block | When |
|-------|------|
| Matchweek (roughly 10 matches) | Models that update weekly: Elo, time-decayed Poisson |
| Month | Cheaper retrain |
| Season | Models with hard-to-refit parameters, and for the final report |

```python
def walk_forward(matches, first_test_date, step_days=7, fit=None, predict=None):
    matches = sorted(matches, key=lambda m: m["starts_at"])
    out, t = [], first_test_date
    while t <= matches[-1]["starts_at"][:10]:
        train = [m for m in matches if m["starts_at"][:10] < t]
        test = [m for m in matches if t <= m["starts_at"][:10] < add_days(t, step_days)]
        if train and test:
            model = fit(train)
            out += [(m, predict(model, m)) for m in test]
        t = add_days(t, step_days)
    return out
```

(`add_days` is a one-line date helper.) Keep the loop identical for every model you compare.

## Leakage Checklist for Soccer

| Leak | How it happens | Fix |
|------|---------------|-----|
| Table position | `get_standings` returns the table as of now, not as of the match date. Using it as a feature for a match in November uses May's table | Rebuild the as-of table from results |
| Season xG and team averages | `get_team_stats` averages include the match you predict and everything after it | Compute rolling averages from per-match xG, shifted by one match |
| Current Elo for past matches | `get_ratings` without `date` is today's rating | Use the rating before the match, or your own point-in-time Elo |
| Player season totals | `get_player` rows are whole-season | Build from `get_player_games`, shifted |
| Closing odds as a feature | If you predict before the close, the close is the future | Use opening or earlier snapshots only |
| Same-match rows | Both clubs' rows from one match split across train and test | Keep a match intact on one side |
| Promoted clubs | A club with no history gets a fabricated one | Give them a prior, flag them |
| Tuning on the test blocks | Choosing hyperparameters from the final scores | Tune inside the training window, nested walk-forward |
| Mid-season managerial or squad change | Treated as stationary | Use decay, check for breaks |

Shift rule: any feature for match `m` uses only matches dated strictly before `m`'s kickoff. If two matches share a day, treat same-day results as unavailable.

## Metrics

For three-way outcomes (home, draw, away) with probabilities `p` and the one-hot outcome `o`:

```
Log loss = - log(p[actual])                                 mean over matches
Multiclass Brier = sum_k (p_k - o_k) ** 2                   mean over matches
Ranked probability score (RPS) = sum over the 2 cumulative cut points of (cum_p - cum_o) ** 2 / 2
```

RPS respects the order home, draw, away, so predicting a draw when the home side wins is penalized less than predicting an away win. It is the standard metric for soccer. Compare each model with the market's devigged closing probabilities from `odds-analysis`; the gap in RPS is what you are after. Accuracy is a poor choice: a model that never picks the draw can still score 50%.

## Significance

1. Compute per-match loss for model A and the benchmark B on the same matches.
2. Take the difference `d_i = loss_A_i - loss_B_i`.
3. Mean and standard error: `se = std(d) / sqrt(n)`. A t-statistic above about 2 is suggestive, not proof.
4. Or block-bootstrap `d` by matchweek (to keep within-week correlation) and read the 95% interval.

How much is enough? One league-season is 380 matches, which is not many for comparing two reasonable models whose per-match scores differ by small amounts. Measure the standard deviation of `d` on your own data and report the standard error rather than quoting a rule of thumb; expect that small differences will not be separable within a single season. If you tested several models or settings, apply a multiple-comparison correction or hold out a final untouched season.

## Worked Example Plan

Evaluate a Dixon-Coles model (`poisson-score-models`) against Pinnacle's closing prices for 2023-24 to 2025-26:

1. Pull results: two `list_games` calls per season (12 credits for three seasons).
2. Pull closing prices: `get_odds` with `season` and 380 matches is 760 credits per season. Budget this first; consider one season, or restrict to a team's matches with `team`.
3. Run `walk_forward` with weekly steps starting at matchweek 11 each season (so ratings have data).
4. Devig Pinnacle's close with `odds-analysis`.
5. Report mean RPS for the model, the market, and the difference with its standard error.

A common outcome: the market's RPS is lower than a goals-only model's. The honest conclusion is to find where the model differs from the market and test those differences on their own.

## Pitfalls

1. **Random splits.** Never. Even shuffled-within-season is leakage.
2. **Few early-season matches.** Starting each season with an empty model gives poor early predictions. Carry ratings over with regression to the mean.
3. **Changing the rules mid-experiment.** Define the metric, block size and start date before you look.
4. **Selection by test score.** Picking the best of 20 settings by the test score inflates it. Hold out a final season.
5. **Ignoring cup breaks and international windows.** They are not leakage but they change the nature of the next block.
6. **Draw prediction.** Judge it separately in the calibration table, not just via accuracy.

## Anti-patterns

| Rationalization | Why It's Wrong | Do This Instead |
|----------------|---------------|-----------------|
| "5-fold CV is standard" | Future leaks into the past | Expanding window |
| "I used the standings as a feature" | They were today's standings | Rebuild as-of |
| "Accuracy improved 2 points" | Within noise on 380 matches | Compare RPS with a standard error |
| "Great test score, I tuned on it" | Optimistic | Nested walk-forward and a final holdout |

## Output Format

```
Model [name] vs [benchmark], [competition], [first test date] to [last], n = [matches]
RPS: model [x.xxx], benchmark [x.xxx], difference [x.xxx] +/- [se]
Log loss: model [x.xxx], benchmark [x.xxx]
Leakage checks passed: [list]
Verdict: [better / indistinguishable / worse], with the sample caveat
```

## What to Do Next

| What You Found | Next Action | Skill |
|----------------|-------------|-------|
| Model competitive with market | Check calibration | `probability-calibration` |
| Model has an edge on paper | Simulate betting at the close | `backtesting` |
| Model clearly worse | Go back to features | `poisson-score-models`, `elo-ratings` |
