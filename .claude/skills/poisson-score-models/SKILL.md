---
name: poisson-score-models
description: "Builds soccer score models: independent Poisson goals from attack and defence strengths, the Dixon-Coles low-score correction with time decay, scoreline matrices, and the home/draw/away, over/under and handicap probabilities that fall out of them, validated against closing odds. Use when the user wants to predict scores, price totals or handicaps, fit team strengths, or turn xG or Elo into match probabilities. Do not use for rating-only win probabilities, see elo-ratings. Do not use for deciding whether a price is value, see edge-detection. Do not use for goalscorer probabilities, see goalscorer-prop-modeling."
metadata:
  version: 1.0.0
  author: StrikerAPI
---

# Poisson Score Models

> **Default data tool:** StrikerAPI (`strikerapi-tool`).
> `list_games` (2 credits per call, up to 200 matches) supplies scores. `get_team_stats` (5) supplies xG for and against. `get_odds` (5 per match, 2 per match by season) supplies the benchmark.

Goals in soccer are rare, roughly independent events, which is why a Poisson distribution fits them tolerably well. A score model predicts a goal rate for each side and turns the two rates into a full scoreline matrix. From that one matrix you get every market: home/draw/away, totals, handicaps and exact score.

## When to Use

- "What is the probability Arsenal win 2-1?" / "P(over 2.5)?"
- "Fit attack and defence strengths for the league"
- "Turn xG or Elo into match probabilities"
- Producing a model probability to compare with a devigged market

## When NOT to Use

- A single rating-based expected score: `elo-ratings`
- Anytime goalscorer pricing: `goalscorer-prop-modeling` (player-level, different structure)
- Evaluating a finished model: `walk-forward-validation`, `probability-calibration`

## Commands Available

| Command | What It Does | Credits |
|---------|-------------|---------|
| `list_games` | Scores by `season`, `status: "final"`, `limit` 200, `offset`; the training data | 2 |
| `get_team_stats` | `goals_for`, `goals_against`, `xg_for`, `xg_against` per match, all clubs | 5 |
| `get_ratings` | Elo input | 2 |
| `get_odds` | Closing three-way prices, handicap and total, for benchmarking | 5 or 2 per match |
| `get_schedule` | Fixtures to predict, with the median line | 2 |

## Commands That Do NOT Exist

| Not Available | Use Instead |
|--------------|-------------|
| `get_prediction`, `get_forecast` | Fit the model yourself with the code below |
| `get_btts`, `get_correct_score_odds` | Not available. Both-teams-to-score and correct-score prices are not provided, so those outputs cannot be benchmarked here |
| `get_expected_lineup` | Not available |

## The Model

For home club `i` against away club `j`:

```
lambda_home = exp(attack_i + defence_j + home_advantage)      goals the home side is expected to score
mu_away     = exp(attack_j + defence_i)                        goals the away side is expected to score
P(home = x, away = y) = Poisson(x; lambda) * Poisson(y; mu) * tau(x, y)
```

`attack` is high for strong attacks. `defence` is high for leaky defences (it adds to the opponent's goals). Fix the average of each set to zero so the model is identified.

**Independent Poisson** sets `tau = 1`. It underestimates 0-0 and 1-1 and overestimates 1-0 and 0-1.

**Dixon-Coles** corrects the four low scores with a single parameter `rho`:

```
tau(0,0) = 1 - lambda * mu * rho      tau(0,1) = 1 + lambda * rho
tau(1,0) = 1 + mu * rho               tau(1,1) = 1 - rho
tau = 1 otherwise
```

`rho` is usually slightly negative: more 0-0 and 1-1 than independence implies.

**Time decay** weights each match by `exp(-xi * days_ago)`. A half-life of a year or so (`xi` near 0.0019 per day) is a common starting point; tune it.

## Fitting

Training data is cheap. A Premier League season is 380 matches: two `list_games` calls, 4 credits.

```python
rows = []
for off in (0, 200):
    rows += call("list_games", season=2025, status="final", limit=200, offset=off)["games"]
```

Then fit by weighted maximum likelihood. Tested against simulated data (recovered attack strengths with 0.95 correlation):

```python
import numpy as np
from scipy.optimize import minimize
from scipy.special import gammaln

def tau(x, y, lam, mu, rho):
    t = np.ones_like(lam)
    t = np.where((x == 0) & (y == 0), 1 - lam * mu * rho, t)
    t = np.where((x == 0) & (y == 1), 1 + lam * rho, t)
    t = np.where((x == 1) & (y == 0), 1 + mu * rho, t)
    t = np.where((x == 1) & (y == 1), 1 - rho, t)
    return t

def fit_dixon_coles(home_idx, away_idx, hg, ag, days_ago, n_teams, xi=0.0019):
    hg, ag = np.asarray(hg), np.asarray(ag)
    w = np.exp(-xi * np.asarray(days_ago))

    def unpack(p):
        att = p[:n_teams] - p[:n_teams].mean()
        dfn = p[n_teams:2 * n_teams] - p[n_teams:2 * n_teams].mean()
        return att, dfn, p[-2], p[-1]

    def nll(p):
        att, dfn, home, rho = unpack(p)
        lam = np.exp(att[home_idx] + dfn[away_idx] + home)
        mu = np.exp(att[away_idx] + dfn[home_idx])
        t = tau(hg, ag, lam, mu, rho)
        if np.any(t <= 0):
            return 1e10
        ll = (np.log(t) + hg * np.log(lam) - lam - gammaln(hg + 1)
              + ag * np.log(mu) - mu - gammaln(ag + 1))
        return -(w * ll).sum()

    p0 = np.zeros(2 * n_teams + 2)
    p0[-2] = 0.25
    res = minimize(nll, p0, method="L-BFGS-B",
                   bounds=[(None, None)] * (2 * n_teams) + [(-0.5, 1.0), (-0.3, 0.3)])
    return unpack(res.x)
```

## From Rates to Markets

```python
def score_matrix(lam, mu, rho, max_goals=10):
    g = np.arange(max_goals + 1)
    ph = np.exp(-lam + g * np.log(lam) - gammaln(g + 1))
    pa = np.exp(-mu + g * np.log(mu) - gammaln(g + 1))
    m = np.outer(ph, pa)
    m[0, 0] *= 1 - lam * mu * rho
    m[0, 1] *= 1 + lam * rho
    m[1, 0] *= 1 + mu * rho
    m[1, 1] *= 1 - rho
    return m / m.sum()

def one_x_two(m):
    return np.tril(m, -1).sum(), np.trace(m), np.triu(m, 1).sum()   # home, draw, away
```

With `m[i, j]` the probability of home `i`, away `j`:

| Market | Formula |
|--------|---------|
| Home / draw / away | `one_x_two(m)` |
| Over 2.5 | `1 - sum(m[i, j] for i + j <= 2)` |
| Exact score 2-1 | `m[2, 1]` |
| Home -1 (win by 2+) | `sum(m[i, j] for i - j >= 2)` |
| Asian handicap -0.5 | Same as the home win probability; whole and quarter lines need push and half-stake handling |
| Both teams to score | `1 - m[0, :].sum() - m[:, 0].sum() + m[0, 0]` (model only; no price here to compare) |

Quarter-total and handicap lines such as 2.75 settle as two half-stakes at 2.5 and 3.0. Price each half separately and handle the push at the whole line.

## Worked Example (back-of-envelope, from `get_team_stats`)

A quick multiplicative version, before any fitting, using the 2025-26 per-match xG from `get_team_stats {"season": 2025}`. League average xG for per club per match was 1.47. Arsenal: 1.90 for, 0.83 against. Chelsea: 1.73 for, 1.36 against.

```
lambda_ARS = 1.90 * 1.36 / 1.47 = 1.76        mu_CHE = 1.73 * 0.83 / 1.47 = 0.98
```

Passing 1.76 and 0.98 to `score_matrix` (no home bonus, because season averages mix home and away matches) with `rho` of 0 and then -0.05:

```
rho      home win  draw   away win   over 2.5   1-1    2-1    1-0
0.00      0.557    0.234   0.208      0.515    0.111  0.098  0.114
-0.05     0.552    0.246   0.203      0.515    0.117  0.098  0.109
```

A small negative `rho` moves about 1.2 points of probability into the draw and leaves the total alone, which is the expected pattern. This is a sketch, not a forecast: it ignores the home bonus, lineups and the opposition faced. A real fit (above) estimates strengths jointly.

## Using xG and Elo as Inputs

- **xG-based rates.** Replace goals with xG in the strength estimates (`get_team_stats` gives `xg_for` and `xg_against` per match). xG is less noisy than goals over a short window. Fit on the same likelihood, treating xG as the scored-goals analogue, or blend goals and xG.
- **Elo-based rates.** Map the Elo gap to a goal difference with a regression fit on history, set the total from the league mean, and solve for `lambda` and `mu`.
- **Shrinkage.** For clubs with few matches (promoted sides, early season), shrink attack and defence toward the league mean in proportion to matches played.

## Validation

1. Walk forward. Fit on matches before date `t`, predict the matches on `t`, step forward. Never random-split. See `walk-forward-validation`.
2. Score with the ranked probability score (RPS) and log loss across home/draw/away, not accuracy. See `probability-calibration`.
3. Benchmark against the devigged closing prices from `get_odds` (see `odds-analysis`). If you cannot beat the market's RPS, you have a model of what the market already knows. That is the usual outcome for a goals-only model; the useful question is where it differs and whether those differences are signal.
4. Check totals separately: calibrate P(over) by decile against the actual over rate.

## Pitfalls

1. **Leakage.** Using season-end strengths for early-season matches. Refit as you go, or use the time-decayed fit frozen at the prediction date.
2. **Home advantage differs by league and era.** Fit it per competition. Neutral games (finals, some European ties) have none.
3. **Cup and European matches.** Mixed-competition fits need strength links between leagues; avoid unless you model it.
4. **Small samples.** Fewer than about 15 matches for a club makes its strengths unreliable.
5. **Overdispersion.** Real totals have a fatter right tail than Poisson. A negative binomial or a mixture can help totals pricing.
6. **Score effects.** Teams ahead take their foot off. Pure Poisson ignores game state.
7. **Lineups.** Strengths describe the average squad, not tonight's.

## Anti-patterns

| Rationalization | Why It's Wrong | Do This Instead |
|----------------|---------------|-----------------|
| "Random 80/20 split" | Uses the future to predict the past | Walk forward by date |
| "Poisson says 3-1 is the pick" | Most likely scoreline is rarely likely | Report probabilities |
| "Accuracy 52%" | Draw and close calls hide quality | RPS and log loss against the closing line |
| "Use goals_for as the attack rate" | Opponent quality is ignored | Fit attack and defence jointly |
| "Output 0.62 means value" | The market may know better | Compare to a devigged close with `edge-detection` |

## Output Format

```
[Home] v [Away] - model lambda [x.xx], mu [x.xx], rho [x.xxx], fit through [date]
Home / Draw / Away: [p] / [p] / [p]   (market no-margin: [p] / [p] / [p])
Over 2.5: [p]  BTTS (model only): [p]  Most likely scores: 1-1 [p], 1-0 [p], 2-1 [p]
Backtest RPS: model [x.xxx], market [x.xxx], n = [matches]
```

## What to Do Next

| What You Found | Next Action | Skill |
|----------------|-------------|-------|
| Model probabilities | Check calibration | `probability-calibration` |
| Model differs from the close | Look for edge, honestly | `edge-detection` |
| Need a proper test | Walk-forward harness | `walk-forward-validation` |
