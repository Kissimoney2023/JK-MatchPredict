---
name: team-analysis
description: "Analyzes clubs: league table, points per game, home and away splits, form, goals and xG for and against, possession and discipline, head to head, and strength relative to the league. Use when the user asks how a club is doing, wants the table, compares two clubs, or asks whether a club is over- or under-performing. Do not use for a single match, see match-lookup. Do not use for player-level stats, see player-scouting. Do not use for building ratings, see elo-ratings."
metadata:
  version: 1.0.0
  author: StrikerAPI
---

# Team Analysis

> **Default data tool:** StrikerAPI (`strikerapi-tool`).
> `get_standings` (2 credits) for the table. `get_team_stats` (5) for per-match averages including xG, and it returns the whole league in one call when `team` is omitted. `get_head_to_head` (2) for meetings. `get_ratings` (2) for Elo.

You turn a table and a block of averages into a view of how good a club actually is, separating what the points say from what the underlying numbers say.

## When to Use

- "How is Chelsea doing?" / "Show me the Bundesliga table"
- "Is this club lucky?" (points versus xG)
- Home and away splits, recent form
- Comparing two clubs on attack and defence
- Strength of schedule context before a preview

## When NOT to Use

- One match in detail: `match-lookup`
- Shot locations and finishing: `xg-analysis`
- A named player: `player-scouting`
- Producing win probabilities from ratings: `elo-ratings`

## Commands Available

| Command | What It Does | Credits |
|---------|-------------|---------|
| `list_teams` | Club ids and abbreviations for a season | 1 |
| `get_standings` | Rank, played, W/D/L, goals for and against, points, deductions, qualification note, home and away records, form | 2 |
| `get_team_stats` | Per-match averages for and against: goals, `xg_for`, `xg_against`, shots, shots on target, possession, pass accuracy, corners, fouls, cards, tackles, clean sheets | 5 |
| `get_head_to_head` | Meetings in this competition: wins, draws, goals, first meeting, results newest first | 2 |
| `get_ratings` | Elo ratings, strongest first | 2 |

## Commands That Do NOT Exist

| Not Available | Use Instead |
|--------------|-------------|
| `get_table`, `get_league_table` | `get_standings` |
| `get_team` | `get_team_stats` with `team` set |
| `get_form` | The `form` field in `get_standings` (last results as letters), or `list_games` with `team` |
| `get_xg_table` | Build it from `get_team_stats`, see `xg-analysis` |
| `get_injuries` | Not available |

## How It Works

**Step 1: Resolve the competition and season.** Default is the Premier League, latest season. `get_standings` accepts every league except `ligamx` and `argentina`. In the Champions League it returns one table per group or the league phase.

**Step 2: Pull the table and the averages.**

```
get_standings {"season": 2025}
get_team_stats {"season": 2025}
```

Omit `team` in `get_team_stats` to get all clubs for 5 credits. One call per club would cost 5 each.

**Step 3: Compute the gaps.** From `get_team_stats`:

```
xGD per match   = xg_for - xg_against
goal diff/match = goals_for - goals_against
luck gap        = goal diff/match - xGD per match      (positive = outperforming)
```

From `get_standings`: points per game = `points / played`, and home and away records parse from strings like `"3-0-0"` (wins-draws-losses).

**Step 4: Judge sustainability.** Over a full 38-match season, goal difference tracks xG difference closely and, as a rule of thumb, a gap above about 0.3 goals per match is unusual. Over 5 or 6 matches, a gap of 0.5 is noise. Do not call a club lucky or unlucky on fewer than about 10 matches.

**Step 5: Add context.** Home and away splits (a club with 5 wins from 5 at home has played a different schedule than one with 3 and 2). `get_head_to_head` for the specific pairing, but it counts every meeting in this competition since the first, so recent meetings matter more than the lifetime record.

## Worked Example

2025-26 Premier League, `get_team_stats {"season": 2025}`, sorted by xG difference per match (38 matches each):

```
club  goals_for goals_against xg_for xg_against  xGD/match
ARS     1.87      0.71        1.90     0.83       +1.07
MNC     2.03      0.92        1.95     1.22       +0.73
MAN     1.82      1.32        1.76     1.32       +0.44
CHE     1.53      1.37        1.73     1.36       +0.37
...
BUR     1.00      1.97        0.94     2.12       -1.18
```

Read: Arsenal's goal difference per match (+1.16) sits just above its xG difference (+1.07), so the table position is earned, and the defence is the story: 0.83 xG conceded per match is the best in the league. Manchester City scored more than Arsenal but conceded more. Burnley's -1.18 xGD is the worst by 0.6, so its position is not bad luck.

The early-season table is a different read: `get_standings` with no season (2026-27) after 5 or 6 matches shows Manchester City and Arsenal level on 15 points, Brighton with the best goal difference (+13 from 6). That is six matches. Treat it as a starting point and pull `get_team_stats` before concluding anything.

## Interpreting Fields

| Field | Note |
|-------|------|
| `deductions` | Official points deductions are applied to `points`. Mention them |
| `note` | Qualification or relegation note from the table, null mid-table |
| `form` | Most recent results as letters, e.g. `WLWWW` |
| `possession_pct`, `pass_accuracy_pct` | Style descriptors, weakly related to results. Do not rank clubs by them |
| `red_cards_total` | Total red cards, not a per-match rate |
| any stat `null` | ESPN did not chart it. It is not 0 |

`get_team_stats` averages cover every final match in the season for the competition you query, "league and cup stages alike". In the Champions League that means group and knockout matches together. Other competitions are not included: a club's Premier League numbers do not contain its Champions League matches.

## Anti-patterns

| Rationalization | Why It's Wrong | Do This Instead |
|----------------|---------------|-----------------|
| "They are top, so they are best" | Six matches is noise | Show xGD and the sample size together |
| "Possession leaders are better" | Possession and results correlate weakly | Lead with xG for and against |
| "Lifetime head to head decides the preview" | Squads and managers change | Weight the last few meetings, state the count |
| "Call `get_team_stats` per club" | 5 credits x 20 clubs | One call without `team` |
| "Compare Elo across leagues" | Ratings move only on one competition's matches | Compare within a competition only |

## Output Format

```
[Competition] [season] after [N] matches

Table: [rank] [club] [pts] ([W-D-L], GD [x])  form [WWDLW]
Underlying: xG for [x.xx] / against [x.xx] per match, xGD [+x.xx]
Luck gap: [goal diff/match] vs [xGD/match]  -> [outperforming / in line / underperforming]
Home: [W-D-L]   Away: [W-D-L]
Caveat: [sample size, deductions, schedule]
```

## What to Do Next

| What You Found | Next Action | Skill |
|----------------|-------------|-------|
| Big goals-versus-xG gap | Where are the shots coming from | `xg-analysis` |
| Want win probabilities from strength | Convert ratings | `elo-ratings` |
| Comparing two clubs for a fixture | Full preview | `match-preview` |
| Want to model the league | Poisson team strengths | `poisson-score-models` |
