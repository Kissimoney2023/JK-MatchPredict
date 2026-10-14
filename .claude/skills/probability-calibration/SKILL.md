---
name: probability-calibration
description: "Checks and fixes whether soccer model probabilities mean what they say: per-class reliability for home, draw and away, ranked probability score, log loss, multiclass Brier, and Platt, isotonic or temperature scaling for three-way outputs. Use when the user asks if their probabilities are calibrated, why the model is overconfident, how to fix the draw, or whether to trust a 60% number. Do not use for building the model, see poisson-score-models or elo-ratings. Do not use for the walk-forward split, see walk-forward-validation. Do not use for devigging, see odds-analysis."
metadata:
  version: 1.0.0
  author: StrikerAPI
---

# Probability Calibration

> **Default data tool:** StrikerAPI (`strikerapi-tool`).
> Calibration works on your model's out-of-sample predictions plus outcomes. Outcomes come from `list_games` (2 credits per call); the market benchmark from `get_odds` (5 per match, 2 per match by season).

A model that says 60% should be right about 60% of the time. Calibration tests that, and a calibrated model is a precondition for `edge-detection`: a stake sized from a miscalibrated 60% loses money even if the ranking of matches is good.

## When to Use

- "Are my win probabilities calibrated?"
- "The model is overconfident on favorites"
- "My draws are always too low"
- Picking between a raw model, a scaled model and the market
- Before computing any edge

## When NOT to Use

- Fitting the underlying model: `poisson-score-models`, `elo-ratings`
- Designing the out-of-sample split: `walk-forward-validation`
- Converting prices to probabilities: `odds-analysis`

## Commands Available

| Command | What It Does | Credits |
|---------|-------------|---------|
| `list_games` | Outcomes (`result` H, D or A, scores) | 2 per call |
| `get_odds` | Market close and `close_prob` as a benchmark | 5 or 2 per match |

## Commands That Do NOT Exist

| Not Available | Use Instead |
|--------------|-------------|
| `get_model_probabilities`, `get_predictions` | StrikerAPI provides none; you supply the model output |
| `get_calibration` | Compute it from the code below |

## Inputs

A table with one row per match, with out-of-sample predictions (never in-sample):

```
match_id, date, p_home, p_draw, p_away, result   (result in {H, D, A})
```

Probabilities must sum to 1. Check it. Everything below assumes the predictions came from a walk-forward run.

## Metrics

```python
import numpy as np

def log_loss(P, y):            # P: (n, 3) probabilities in order H, D, A; y: indices 0, 1, 2
    return -np.mean(np.log(np.clip(P[np.arange(len(y)), y], 1e-12, 1)))

def brier(P, y):
    O = np.eye(3)[y]
    return np.mean(((P - O) ** 2).sum(axis=1))

def rps(P, y):
    O = np.eye(3)[y]
    cum_p, cum_o = P.cumsum(axis=1)[:, :2], O.cumsum(axis=1)[:, :2]
    return np.mean(((cum_p - cum_o) ** 2).sum(axis=1) / 2)
```

| Metric | Reads as | Notes |
|--------|----------|-------|
| Log loss | Penalizes confident misses | Sensitive to extremes; clip |
| Multiclass Brier | Mean squared error on the triple | Robust |
| RPS | Ordered Brier on cumulative outcomes | Standard for soccer; lower is better |

Always report the same metric for the market (devigged close) on the same matches. The absolute number matters less than the gap.

## Reliability, Per Class

Calibration is checked for each class separately. For home win:

1. Bin matches by `p_home` (deciles, or fewer when n is small).
2. In each bin, compare the mean predicted probability to the observed home-win frequency.
3. Plot observed against predicted with a confidence interval (`sqrt(p (1 - p) / n)` per bin).

Repeat for the draw and away win.

```python
def reliability(p, hit, bins=10):
    edges = np.quantile(p, np.linspace(0, 1, bins + 1))
    idx = np.clip(np.digitize(p, edges[1:-1]), 0, bins - 1)
    rows = []
    for b in range(bins):
        m = idx == b
        if m.sum():
            rows.append((p[m].mean(), hit[m].mean(), int(m.sum())))
    return rows        # (mean predicted, observed rate, count)
```

Expected calibration error is the count-weighted mean of the absolute gap; report it with the bin counts, since 380 matches in ten bins is 38 each and each bin's rate has a standard error near 7 points.

## The Draw Problem

Draws are the hardest class. A model's draw probability tends to stay inside a narrow band, so the draw reliability curve is a short, noisy segment, and it is easy to get wrong in a systematic way. Typical failure modes:

- A Poisson model with independent goals understates draws; Dixon-Coles helps
- An Elo-based model treats a draw as half a win and has no draw model at all
- A model fit across leagues applies one draw rate everywhere

Check the average predicted draw probability against the observed draw frequency first. If they differ by more than about 2 points over several hundred matches, fix the draw rate before anything else.

## Fixing It

Fit the calibrator on one set of matches and test it on a later one. Never fit and test on the same predictions.

| Method | When | Notes |
|--------|------|-------|
| **Temperature scaling** | Probabilities uniformly too confident or too timid | One parameter `T` on the logits of the triple. Cheap, hard to overfit. Start here |
| **Multinomial logistic recalibration** | Class-specific bias (draw too low) | Logistic regression on `log(p_h / p_d)`, `log(p_a / p_d)` |
| **Platt, one-vs-rest** | Binary question like "home win" | Logistic fit on the logit of one probability; renormalize the three |
| **Isotonic** | Plenty of data (thousands of matches) | Flexible; overfits on one season of 380 matches |
| **Blend with the market** | Always worth testing | `p = w * p_model + (1 - w) * p_market` with `w` fit on a prior period. A model that cannot beat this has little to add |

```python
from scipy.optimize import minimize_scalar

def fit_temperature(P, y):
    logits = np.log(np.clip(P, 1e-12, 1))
    def nll(T):
        z = logits / T
        z -= z.max(axis=1, keepdims=True)
        Q = np.exp(z); Q /= Q.sum(axis=1, keepdims=True)
        return log_loss(Q, y)
    return minimize_scalar(nll, bounds=(0.5, 3.0), method="bounded").x
```

`T` above 1 flattens (the model was overconfident); below 1 sharpens.

## Worked Example Plan

1. Produce walk-forward predictions for a season of Premier League matches with `poisson-score-models` (the 380 outcomes come from two `list_games` calls, 4 credits).
2. Compute log loss, Brier and RPS for the model on all 380.
3. Pull the devigged closes from `get_odds` (season mode, 760 credits; consider a single club's matches with `team` to cut the cost while testing) and compute the same metrics.
4. Draw the three reliability curves. Report the mean predicted draw rate against the observed rate.
5. Fit `T` on the first half, apply to the second half, compare.
6. Report the scores with standard errors, using the per-match differences against the market.

Do not state results before running this; the numbers belong to your model and sample.

## Sample Size Guide

| Matches | What you can conclude |
|---------|----------------------|
| Under 200 | Overall draw rate and rough bias only |
| 380 (one league-season) | Coarse reliability in 4 or 5 bins; temperature scaling |
| 1,500+ | Per-class curves, multinomial recalibration |
| 5,000+ | Isotonic, league-specific effects |

## Pitfalls

1. **Calibrating on in-sample predictions.** In-sample probabilities are overconfident by construction.
2. **Binning with small n.** Ten bins on 200 matches is mostly noise; use fewer.
3. **Fixing the wrong thing.** Bad ranking cannot be fixed by calibration. Check discrimination (does the model separate H from A?) as well.
4. **Calibrating the favorite only.** Look at all three classes.
5. **Different leagues.** Calibrate per competition when draw rates differ.
6. **Time drift.** Recalibrate on a rolling window and check the scaling stays stable.
7. **Treating the market as perfectly calibrated.** It is the best public benchmark, not a law. Test it too.

## Anti-patterns

| Rationalization | Why It's Wrong | Do This Instead |
|----------------|---------------|-----------------|
| "Accuracy is 55%, so it is fine" | Says nothing about the probabilities | Reliability and RPS |
| "Isotonic on one season" | Overfits | Temperature scaling |
| "Calibrated on the test set" | Optimistic | Train the calibrator earlier, test later |
| "The draw is unpredictable, skip it" | The draw is a third of the triple | Check the average draw rate at least |

## Output Format

```
[Model] - [competition] [period], n = [matches], out-of-sample
              Model      Scaled     Market (devigged close)
Log loss      [x.xxx]    [x.xxx]    [x.xxx]
Brier         [x.xxx]    [x.xxx]    [x.xxx]
RPS           [x.xxx]    [x.xxx]    [x.xxx]
Mean p(draw) [x.xxx] vs observed [x.xxx]
Verdict: [calibrated / overconfident / draw biased], T = [x.xx]
```

## What to Do Next

| What You Found | Next Action | Skill |
|----------------|-------------|-------|
| Calibrated and close to market | Look for differences worth testing | `edge-detection` |
| Still behind the market | Improve features and model | `poisson-score-models` |
| Ready to test betting | Simulate at closing prices | `backtesting` |
