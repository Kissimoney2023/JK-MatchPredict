---
name: strikerapi-tool
description: "Default data source for the StrikerAPI skills. Routes every request for soccer results, lineups, box scores, events, shot maps, xG, Elo ratings, three-way sportsbook odds and anytime goalscorer prices to one of 19 tools across 17 competitions. Use when any other skill needs data, or when the user asks which tool to call, what a call costs, or how to hit the REST API. Do not use for analysis, modeling or bet sizing, see xg-analysis, poisson-score-models or edge-detection."
metadata:
  version: 1.0.0
  author: StrikerAPI
  user-invocable: false
---

# StrikerAPI Tool

Every other skill in this pack gets its data here. This skill owns the 19 tools, their credit costs, the response envelope, and the rules that keep a request cheap and correct.

- MCP server: `https://mcp.strikerapi.com/mcp` (key as `?key=`, an `x-api-key` header, or `Authorization: Bearer`)
- REST: `POST https://mcp.strikerapi.com/v1/<tool>` with a JSON body and the header `x-api-key: YOUR_API_KEY`
- Free tier: 500 credits every month, no card. Keys at https://strikerapi.com/signup. Plans and top-ups: https://strikerapi.com/pricing
- Full reference with example responses: https://strikerapi.com/docs

## The response envelope

Every REST response is wrapped as `{"data": ...}`. Unwrap it before reading fields. Over MCP the tool result carries the same payload.

```python
import os, requests

def call(tool, **args):
    r = requests.post(
        f"https://mcp.strikerapi.com/v1/{tool}",
        json=args,
        headers={"x-api-key": os.environ["STRIKERAPI_API_KEY"]},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["data"]

teams = call("list_teams", season=2025)
```

## The 19 tools

| Tool | What it returns | Credits | Skills that use it |
|------|-----------------|---------|--------------------|
| `list_teams` | Club ids, abbreviations, colours for a season | 1 | team-analysis, match-lookup |
| `search_players` | Player ids by name, with position, club, last season | 1 | player-scouting, goalscorer-prop-modeling |
| `list_games` | Fixtures and results by season, stage, date, range or club | 2 | match-lookup, poisson-score-models, elo-ratings |
| `get_schedule` | Upcoming fixtures (1-30 days) with the median three-way line | 2 | odds-explorer, match-preview |
| `get_standings` | League table with deductions, home/away, form | 2 | team-analysis |
| `get_ratings` | Our Elo ratings, strongest first, current or as of a date | 2 | elo-ratings, match-preview |
| `get_head_to_head` | Two clubs' record and meetings in this competition | 2 | match-preview, team-analysis |
| `get_game` | One match: score, both box scores with xG, player lines, key events, each book's line | 5 | match-lookup, match-preview |
| `get_lineups` | Formations, starting XIs, substitutions with minutes, unused bench | 5 | match-lookup, goalscorer-prop-modeling |
| `get_player` | Profile, per-season totals and per-90 rates, last 10 matches | 5 | player-scouting |
| `get_player_games` | A player's match log, newest first | 5 | player-scouting, goalscorer-prop-modeling |
| `get_leaders` | Season leaders in goals, assists, xG, shots, cards, saves, clean sheets | 5 | player-scouting, xg-analysis |
| `get_team_stats` | Per-match averages for and against, including xG | 5 | team-analysis, xg-analysis |
| `get_odds` | Per-book three-way moneyline, handicap, total, open and close | 5 (one match), 10 (one date), 2 per match (season) | odds-explorer, odds-analysis, backtesting |
| `get_line_movement` | Pre-kickoff snapshots of each book's line | 10 | odds-explorer |
| `get_events` | Ordered match events, shots with location and xG | 10 | match-lookup, xg-analysis |
| `get_shot_map` | Shots and zone totals for a club, player or match | 10 | xg-analysis, goalscorer-prop-modeling |
| `get_player_props` | Anytime goalscorer prices by book, opening or closing | 10 (0 with `estimate_only`) | goalscorer-prop-modeling |
| `get_prop_history` | A player's goalscorer price against whether he scored, per match | 10 for up to 200 games | goalscorer-prop-modeling, backtesting |

`get_odds` is priced by how you call it: pass `game_id` for one match, `date` for a day, or `season` (optionally with `team`) for priced matches, 100 per page.

## Parameters shared by most tools

| Parameter | Meaning |
|-----------|---------|
| `league` | One of `soccer` (Premier League, the default), `mls`, `laliga`, `seriea`, `bundesliga`, `ligue1`, `ucl`, `championship`, `nwsl`, `ligamx`, `uel`, `uecl`, `eredivisie`, `primeira`, `scotland`, `brazil`, `argentina` |
| `season` | The year the season starts: `2025` is 2025-26. MLS, the NWSL, Liga MX, Brazil and Argentina use the calendar year |
| club arguments | A club id, abbreviation or name. Ids and abbreviations are safest |
| dates | `YYYY-MM-DD`, in UTC |
| paging | `limit` plus `offset`; the response carries `next_offset` |

Exceptions worth remembering: `get_standings` does not accept `ligamx` or `argentina`. `get_player_props` and `get_prop_history` accept only `soccer`, `mls`, `laliga`, `seriea`, `bundesliga`, `ligue1` and `ucl`.

## Season resolution

- European leagues: August to December, the season is the current calendar year (October 2026 is season `2026`, meaning 2026-27). January to July, it is the previous year (March 2026 is season `2025`).
- MLS, NWSL, Liga MX, Brazil, Argentina: the calendar year.
- Omit `season` for "the latest". Early in a season that means very small samples, see the per-90 warning in `player-scouting`.

## Coverage (from the StrikerAPI docs and README, check https://strikerapi.com/docs for the per-season counts)

- Results, lineups and goals from 2001-02 for the longest-covered leagues; shot locations and our xG from 2012-13. Start years differ by competition.
- Sportsbook lines from 2017-18, densest from 2021-22 to 2023-24. Opening and closing lines from The Odds API since June 2020 for 16 competitions, ESPN's lines from 2024.
- Anytime goalscorer prices for seven competitions: Premier League and MLS from April 2024, Ligue 1 from May 2024, La Liga, Serie A and Bundesliga from August 2024, Champions League from March 2025. Mostly DraftKings and FanDuel. No other player market exists.
- Older matches carry goals, cards and substitutions only in `get_events`. Shots, fouls and corners come later.

## Which tool, fast

| You need | Call | Not this |
|----------|------|----------|
| Club or player id | `list_teams`, `search_players` | Guessing ids |
| What is on this week, with a price | `get_schedule` | `list_games` (no lines) |
| Results for a club or date | `list_games` | `get_game` in a loop (5 each) |
| One match in full | `get_game` | `get_events` (10, events only) |
| League table | `get_standings` | `get_team_stats` |
| xG for and against, every club | `get_team_stats` with no `team` (5 for the whole league) | One call per club |
| Where a club's shots came from | `get_shot_map` | `get_events` per match |
| Best price on a match | `get_odds` with `game_id` | `get_line_movement` |
| How a price moved | `get_line_movement` | Re-polling `get_odds` |
| Goalscorer prices | `get_player_props` | `get_odds` (no player markets) |

## Commands That Do NOT Exist

| Not available | Use instead |
|---------------|-------------|
| `get_xg`, `get_player_xg` | `get_shot_map`, `get_team_stats`, `get_leaders` with `stat` set to `xg` |
| `get_table` | `get_standings` |
| `get_fixtures` | `get_schedule` (upcoming) or `list_games` |
| `get_match` | `get_game` |
| `get_player_stats` | `get_player` |
| `get_injuries`, `get_transfers`, `get_live_scores` | Not in the 19 tools. Lineups appear in `get_lineups` |
| Other player props (shots, cards, assists) | Not available. Only `player_goal_scorer_anytime` exists |
| Both-teams-to-score, corners, cards markets | Not available. `get_odds` carries the three-way moneyline, goal handicap and total |

## Credit discipline

1. Estimate before any loop. A Premier League season is 380 matches: `get_odds` by season is 760 credits, `get_game` per match is 1,900.
2. Prefer the call that covers more per credit. `list_games` returns up to 200 matches for 2 credits. `get_team_stats` without `team` returns the whole league for 5. `get_shot_map` returns up to 2,000 located shots for 10.
3. `get_player_props` takes `estimate_only: true` and returns the cost without charging or running.
4. Cache everything. Finished matches never change; save responses to disk keyed by tool and arguments.
5. The `X-Credits-Remaining` response header reports your balance.

## BYOD

If the user brings a CSV of results or odds, skip the API and check columns first: `date`, `home`, `away`, `home_goals`, `away_goals` for results; `home_ml`, `draw_ml`, `away_ml` (American) or decimal equivalents for odds. Flag, do not silently drop, missing rows. No credits are used.

## What to do next

| What you retrieved | Next |
|--------------------|------|
| Fixtures and a median line | `match-preview` or `odds-explorer` |
| Per-book prices | `odds-analysis` to remove the margin |
| Shot maps or team xG | `xg-analysis` |
| Results history | `elo-ratings` or `poisson-score-models` |
| Goalscorer prices | `goalscorer-prop-modeling` |
| Model probabilities in hand | `edge-detection`, then `backtesting` |
