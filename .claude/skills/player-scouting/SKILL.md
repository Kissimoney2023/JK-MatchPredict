---
name: player-scouting
description: "Scouts soccer players: finds ids, builds per-season and per-90 profiles for goals, assists, shots, xG and goalkeeping, reads match logs and minutes, ranks league leaders and compares players. Use when the user names a player, asks who the top scorers or creators are, wants to compare forwards, or asks whether a player is finishing above his xG. Do not use for team tables, see team-analysis. Do not use for goalscorer prices, see goalscorer-prop-modeling. Do not use for shot-by-shot locations, see xg-analysis."
metadata:
  version: 1.0.0
  author: StrikerAPI
---

# Player Scouting

> **Default data tool:** StrikerAPI (`strikerapi-tool`).
> `search_players` (1 credit) to find the id. `get_player` (5) for the profile and per-season rates. `get_player_games` (5) for the match log. `get_leaders` (5) for league-wide rankings.

You find the right player, then judge him on rates and minutes rather than raw totals, and you say how much evidence you have.

## When to Use

- "Tell me about Erling Haaland" / "How has Saka's season gone?"
- "Top scorers by xG per 90"
- Comparing two players across seasons
- Checking whether a striker is over- or under-finishing
- Goalkeepers: saves and clean sheets

## When NOT to Use

- Goalscorer prices or props: `goalscorer-prop-modeling`
- Where a player's shots come from: `xg-analysis` (`get_shot_map` with `player`)
- A club's table position: `team-analysis`

## Commands Available

| Command | What It Does | Credits |
|---------|-------------|---------|
| `search_players` | Find a player by name (accents optional), optionally within `team`. Returns id, position, club, last season, appearances | 1 |
| `get_player` | Profile, per-season appearances, starts, minutes, goals, assists, shots, our xG, cards, goalkeeping, per-90 rates, last 10 matches | 5 |
| `get_player_games` | Match log newest first: opponent, score, minutes on and off, goals, assists, shots, xG, fouls, cards | 5 |
| `get_leaders` | Season leaders. `stat`: goals, assists, goal_contributions, shots, shots_on_target, xg, yellow_cards, red_cards, saves, clean_sheets. `per90`, `min_games`, `limit` | 5 |

## Commands That Do NOT Exist

| Not Available | Use Instead |
|--------------|-------------|
| `get_player_stats` | `get_player` |
| `get_top_scorers` | `get_leaders` with `stat` set to `goals` |
| `compare_players` | Call `get_player` twice and compare per-90 rows |
| `get_player_xg` | `xg` fields in `get_player`, or `get_shot_map` with `player` |
| `get_market_value`, `get_injuries`, `get_transfers` | Not available |
| `get_assists_expected` (xA) | Not available. Assists are counted, expected assists are not provided |

## How It Works

**Step 1: Get the id.** `get_player` takes an ESPN player id, not a name.

```
search_players {"name": "Haaland"}
```

Returns `player_id` 253989, Forward, Manchester City, 137 appearances. A common surname returns several rows; narrow with `team`.

**Step 2: Pull the profile.**

```
get_player {"player_id": "253989"}
```

Each season row carries `appearances`, `starts`, `minutes`, `goals`, `assists`, `shots`, `shots_on_target`, `xg`, and the per-90 rates `goals_per90`, `assists_per90`, `shots_per90`, `xg_per90`.

**Step 3: Normalize and compare.** Totals reward minutes. Per-90 rewards role. Use both:

```
finishing gap   = goals - xg                      (positive = above expectation)
shot quality    = xg / shots
conversion      = goals / shots
minutes share   = minutes / (team matches x 90)   (role security)
```

**Step 4: Check the sample.** A season of 2,000+ minutes carries real signal on shot volume and location. Goals over xG does not: the standard error of a season goal total around its xG is roughly the square root of the xG, so a striker on 20 xG can land anywhere from about 11 to 29 goals on luck alone. Treat a one-season gap under about 4 goals as noise. Persistent over-performance across three or more seasons is more credible, and the best strikers do hold a small positive gap.

**Step 5: Rank with guardrails.** For leaders:

```
get_leaders {"stat": "xg", "per90": true, "min_games": 20, "limit": 10}
```

## Worked Example

Haaland, `get_player {"player_id": "253989"}`, Premier League, season rows trimmed:

```
season  apps  minutes  goals  xg     shots  xg_per90
2023     31    2558     27   24.75    115     0.87
2024     31    2742     22   19.93    109     0.65
2025     35    2959     27   23.12    126     0.70
2026      5     450      5    3.87     20     0.77   (five matches)
```

Read: across three full seasons he has scored 76 against 67.8 xG, about +8, with minutes above 2,500 each year. That is consistent with a small positive finishing gap but each single season (+2.3, +2.1, +3.9) is inside the noise. The 2026 line is five matches and should not be extrapolated.

## The Early-Season Per-90 Trap

`get_leaders` with `per90: true` requires a minimum of 10 appearances by default. Early in a season it returns an empty list. In October 2026, `{"stat": "xg", "per90": true}` returned `leaders: []`. Lowering `min_games` to 3 returns names, but `min_games` filters appearances, not minutes:

```
rank 1: Callum Wilson  games 4  minutes 18   xg 0.26  per90 1.28
rank 2: Zian Flemming  games 3  minutes 70   xg 0.85  per90 1.09
rank 3: Lewis Koumas   games 3  minutes 21   xg 0.21  per90 0.91
```

Eighteen minutes of substitute appearances produced the top per-90 rate. Always compute your own minutes filter (for example 450 minutes) from `get_player` before ranking, and say so.

## Position and Role

- `position` can be `null` for young or recently added players (Koumas above). Do not drop him silently.
- Goalkeepers use `saves`, `goals_conceded`, `clean_sheets`. Shot-stopping quality needs post-shot xG, which is not provided. A save rate alone mixes defence quality with keeper quality.
- Assist counts depend on scorer and passer and are far noisier than goals per 90.
- A player who moved clubs has separate season rows per club. Sum them for a career view but compare per 90.
- Stats are per competition. A player's Champions League numbers are in a separate call with `league` set to `ucl`.

## Anti-patterns

| Rationalization | Why It's Wrong | Do This Instead |
|----------------|---------------|-----------------|
| "He leads per 90, so he is best" | Tiny minutes inflate rates | Set a minutes floor and show the minutes |
| "27 goals from 23 xG means elite finisher" | One season is inside luck | Look across seasons and give the standard error |
| "Compare Eredivisie and Premier League totals" | Different leagues, different defences | Compare within a league or flag the gap |
| "Search by name in `get_player`" | It needs the numeric id | `search_players` first |
| "Use goals as a proxy for threat" | Penalties and luck | Prefer xG and shots, and separate penalties via `get_shot_map` |

## Output Format

```
[Player] ([position], [club]) - [competition]
Season    Apps  Min   G   xG    G-xG   Shots  xG/90
...
Read: [finishing gap with sample size], [role and minutes], [one caveat]
```

## What to Do Next

| What You Found | Next Action | Skill |
|----------------|-------------|-------|
| Interesting shot profile | Locations, body part, penalties | `xg-analysis` |
| Player is a regular starter in a covered league | Price his goal chance | `goalscorer-prop-modeling` |
| Comparing his club's context | Team strength and xG | `team-analysis` |
