---
name: xg-analysis
description: "Soccer expected goals analysis: shot maps for a match, club, defence or player, zone breakdowns, xG tables with xG difference and expected points, finishing over- and under-performance, and what a shot's location and body part say about its quality. Use when the user asks about xG, shot maps, shot quality, who is lucky or unlucky, an xG table, or expected points. Do not use for building your own xG model from scratch, that needs a separate dataset pipeline. Do not use for outcome prices, see odds-explorer. Do not use for goalscorer pricing, see goalscorer-prop-modeling."
metadata:
  version: 1.0.0
  author: StrikerAPI
---

# xG Analysis

> **Default data tool:** StrikerAPI (`strikerapi-tool`).
> `get_shot_map` (10 credits) for located shots with xG. `get_team_stats` (5) for season xG for and against, all clubs in one call. `get_leaders` with `stat` set to `xg` (5) for player rankings. `get_events` with `kind: "shots"` (10) for one match in event order.

Expected goals (xG) gives each shot a probability of being a goal from where it was taken, with what body part, and in what situation. Summed over a match or a season it describes the chances a team created and allowed, which is a steadier signal than the scoreline. The xG in StrikerAPI is our own, computed from ESPN-charted located shots from 2012-13 where located shots exist, and it is `null` where they do not.

## When to Use

- "Show me Arsenal's shot map"
- "Which clubs allowed the most xG?"
- "Build an xG table" / "Who is overperforming?"
- "Is this striker finishing or just lucky?"
- "Expected points for the season"

## When NOT to Use

- Training a new xG model: you need shot features plus freeze-frame or event context that this API does not expose; use the located shots as a baseline only
- Match prices: `odds-explorer`
- Player rates and minutes: `player-scouting`

## Commands Available

| Command | What It Does | Credits |
|---------|-------------|---------|
| `get_shot_map` | Shots for a `team`, a `player`, or one `game_id`, for a `season`. `against: true` with `team` returns shots conceded. `include_shots: false` returns totals and zones only | 10 |
| `get_team_stats` | Per-match `xg_for`, `xg_against`, shots, shots on target for every club (omit `team`) | 5 |
| `get_leaders` | Season leaders by `stat: "xg"`, with `per90` and `min_games` | 5 |
| `get_events` | Match events; `kind: "shots"` gives each shot with `xg`, `zone`, `body_part`, `x`, `y` | 10 |
| `get_game` | Box score with `xg` per team (5) | 5 |

## Commands That Do NOT Exist

| Not Available | Use Instead |
|--------------|-------------|
| `get_xg`, `get_expected_goals` | `get_shot_map`, `get_team_stats` |
| `get_xg_table` | Build it from `get_team_stats` (below) |
| `get_xa`, `get_xgot` | Not available. No expected assists and no post-shot xG |
| `get_pass_map`, `get_heatmap`, `get_pressing` | Not available. Only shots carry coordinates |

## Shot Map Fields

```
get_shot_map {"team": "ARS", "season": 2025}
```

The response has `totals` (shots, located, goals, on_target, xg, xg_per_shot), `zones`, `unlocated_shots`, and a `shots` array, newest first, up to 2,000. Each shot:

| Field | Meaning |
|-------|---------|
| `game_id`, `date`, `minute`, `team`, `player_id`, `player` | Context |
| `outcome` | goal, saved, missed, blocked, woodwork |
| `body_part` | right_foot, left_foot, header |
| `penalty` | True for penalties |
| `zone` | six_yard_box, penalty_area, outside_box, penalty |
| `xg` | The shot's probability of scoring |
| `x`, `y` | Location. `x` is the distance from the goal line as a share of half the pitch (the penalty spot is 0.23). `y` runs across the pitch, 0.5 is the centre |
| `end_x`, `end_y` | Where the shot ended |
| `distance_m` | Distance to goal in metres |

Events from `get_events` also carry `metres.from_goal_line` and `metres.from_centre`, which are easier to plot on a real pitch.

Unlocated shots are counted in `shots_total` but have no xG. In the Arsenal 2025 map, 538 shots included 520 located and 18 unlocated, so xG totals understate slightly.

## How It Works

### A: Profile one club (attack and defence)

```
get_shot_map {"team": "ARS", "season": 2025, "include_shots": false}
get_shot_map {"team": "ARS", "season": 2025, "against": true, "include_shots": false}
```

Compare zone shares and xG per shot for and against. A defence that concedes mostly from outside the box is doing something different from one that concedes few shots of high quality.

### B: Build an xG table (5 credits)

```
get_team_stats {"season": 2025}
```

For each club: `xGD = xg_for - xg_against` per match, multiply by `games` for the season total. Sort by xGD, then show actual goal difference, points (from `get_standings`) and the gap.

### C: Expected points (match-level, about 200 credits per league season)

Expected points need match-by-match shot lists, not season averages, because the draw and win chances depend on the distribution of goals, not the mean. Pull every club's shots for the season (one `get_shot_map` per club, 10 each) and group by `game_id`.

```python
def goal_dist(xgs, max_goals=10):
    dist = [1.0] + [0.0] * max_goals
    for p in xgs:
        for k in range(max_goals, 0, -1):
            dist[k] = dist[k] * (1 - p) + dist[k - 1] * p
        dist[0] *= 1 - p
    return dist

def match_xpts(home_xgs, away_xgs):
    h, a = goal_dist(home_xgs), goal_dist(away_xgs)
    p_home = sum(h[i] * a[j] for i in range(len(h)) for j in range(len(a)) if i > j)
    p_draw = sum(h[i] * a[i] for i in range(len(h)))
    p_away = sum(h[i] * a[j] for i in range(len(h)) for j in range(len(a)) if i < j)
    return 3 * p_home + p_draw, 3 * p_away + p_draw
```

`goal_dist` is a Poisson-binomial: each shot is an independent Bernoulli trial with its own `xg`. Do not use total xG as a Poisson mean for this: a sum of shot-sized Bernoulli trials has less variance than a Poisson with the same mean, so the goal distribution comes out wrong. Exclude penalties and shootout kicks from open-play analysis or label them. Season expected points are the sum across matches.

### D: Finishing (player or club)

```
goals_minus_xg = goals - sum(xg)          standard error ~ sqrt(sum(xg * (1 - xg)))
```

For a club on 60 xG the standard error is about 7 goals. Report the gap with that range.

## Worked Example

One match, both clubs: `get_shot_map {"game_id": "740968"}` (Crystal Palace 1, Arsenal 2):

```
shots_total 25   located 25   goals 3   on target 10   xg 3.29   xg/shot 0.132
zone           shots  goals  xg
six_yard_box     2      0    0.59
penalty_area    21      3    2.64
outside_box      2      0    0.06
penalty          0      0    0.00
```

Splitting the `shots` array by `team`: Crystal Palace 8 shots, 0.86 xG; Arsenal 17 shots, 2.43 xG (the box score in `get_game` shows 2.42, a rounding difference). Running both lists through `match_xpts`:

```
Crystal Palace 0.43 expected points    Arsenal 2.41 expected points
P(home win) 0.09   P(draw) 0.16   P(away win) 0.75
```

Arsenal won, which was the likeliest single outcome. Note that 84% of shots came from the penalty area and none were penalties.

Season level, `get_team_stats {"season": 2025}`: Arsenal 1.90 xG for and 0.83 against per match over 38 matches (xGD +1.07 per match, about +40.7 over the season) against Manchester City's +0.73 and Burnley's -1.18. The season shot map for Arsenal: 538 shots, 67 goals, 72.14 xG. Goals minus xG is about -5, within one standard error (about 8).

Both sides of the season for Arsenal, with `include_shots: false` (totals and zones only, no shots array):

```
                 shots  located  goals  xG      xG/shot   six-yard  box    outside  penalties
for (2025)        538     520     67    72.14   0.139     26.80     35.57  6.52     3.25 (4 shots)
against (2025)    302     297     26    31.63   0.106      8.50     18.60  4.53     0.00
```

Arsenal took 1.8 times as many shots as they allowed, and each shot was worth about a third more. The four penalties carried 3.25 xG, about 0.81 each, so 4.5% of the club's xG came from the spot; strip them before judging open-play finishing. Goals against (26) sat 5.6 below xG against (31.63), which is a defence over-performing or a goalkeeper having a very good year; with this sample size, do not tell the two apart.

Season leaders, October 2026, `get_leaders {"stat": "xg", "per90": true}` returned an empty list because the default needs 10 matches. See `player-scouting` for the minutes trap.

## Pitfalls

1. **Single-match xG is noisy.** A 2.4 versus 0.9 match result says Arsenal created the better chances, not that they are 2.5 times better. Use 10+ matches for a club view.
2. **Game state.** Teams that are ahead tend to shoot less, and from worse positions. xG totals are biased toward the team that scored first. Do not read the trailing team's volume as quality.
3. **Penalties** have their own `penalty` zone in `zones` and `penalty: true` on the shot. A club with many penalties looks like an overperformer in goals versus open-play xG. Subtract them from both sides when judging finishing.
4. **Blocked and unlocated shots.** Located shots only count toward `xg`. Compare club to club only within one league and season, because charting coverage varies.
5. **Own goals** are not shots; they sit in goals but not in xG.
6. **Do not mix** the xG of this API with another provider's. Models differ and so do scales.
7. **Regress finishing gaps.** Shrink an observed goals-minus-xG gap heavily toward zero. Even for strikers, most of a one-season gap is luck.

## Anti-patterns

| Rationalization | Why It's Wrong | Do This Instead |
|----------------|---------------|-----------------|
| "xG says they deserved to win" | One match is a sample of about 12 shots | Say who created more, with the range |
| "Use total xG as a Poisson mean to get win odds" | Wrong variance for a sum of shots | Use the shot-level Poisson-binomial |
| "Call `get_shot_map` once per match" | 10 credits each | One call per club-season returns up to 2,000 shots |
| "Compare Premier League and MLS xG per shot" | Different charting and defences | Compare within a competition |
| "He outscored his xG, buy" | Mostly noise | Show the standard error |

## Output Format

```
[Club/Player] - [competition] [season], [n] shots ([located] located)
xG [x.x], goals [g], gap [+/-x.x] (SE about [s])
Zones: six-yard [n] shots / [xg] xG; box [n] / [xg]; outside [n] / [xg]; penalties [n]
Against: xG per match [x.xx] vs for [x.xx]
Verdict: [one sentence with the sample-size caveat]
```

## What to Do Next

| What You Found | Next Action | Skill |
|----------------|-------------|-------|
| Strong or weak xG difference | Turn it into a score model | `poisson-score-models` |
| Player with a high xG share | Scout the rate | `player-scouting` |
| A scorer with strong chances in a covered league | Price his goal chance | `goalscorer-prop-modeling` |
