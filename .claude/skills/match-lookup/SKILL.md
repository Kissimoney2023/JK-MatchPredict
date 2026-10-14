---
name: match-lookup
description: "Finds soccer fixtures and results and opens one match in full: score, box scores, xG, lineups, goals, cards, substitutions and VAR events, across 17 competitions. Use when the user asks who plays, what the score was, what happened in a match, who started, when a goal was scored, or for results by date, club, stage or season. Do not use for league tables or season averages, see team-analysis. Do not use for betting lines, see odds-explorer. Do not use for shot maps across many matches, see xg-analysis."
metadata:
  version: 1.0.0
  author: StrikerAPI
---

# Match Lookup

> **Default data tool:** StrikerAPI (`strikerapi-tool`).
> `list_games` (2 credits) finds matches. `get_schedule` (2) lists upcoming ones with a median line. `get_game` (5) opens one match. `get_lineups` (5) and `get_events` (10) go deeper.

You find the right match, then pull only as much detail as the question needs. Most mistakes here are wrong match ids, wrong competition, and paying 10 credits for events when the 5-credit box score already answered the question.

## When to Use

- "Who plays this weekend?" / "What are the fixtures for Arsenal?"
- "What was the score?" / "Results from last Saturday"
- "Who scored, and when?" / "Who came off the bench?"
- "What formation did they play?"
- Getting a `game_id` to feed another skill

## When NOT to Use

- League table, form, home and away records: `team-analysis`
- Season-long xG, shot maps for a club or player: `xg-analysis`
- Prices, line movement, best book: `odds-explorer`
- Player season totals and per-90 rates: `player-scouting`

## Commands Available

| Command | What It Does | Credits |
|---------|-------------|---------|
| `list_games` | Fixtures and results by `season`, `stage`, `date`, `from`/`to`, `team`, `status` | 2 |
| `get_schedule` | Upcoming fixtures, next `days` (1-30, default 7), median home/draw/away line | 2 |
| `get_game` | One match: score with shootout, both box scores, every player line, key events, each book's line | 5 |
| `get_lineups` | Formation, starting XI with positions, substitutes with minutes, unused bench | 5 |
| `get_events` | Every event in order. Filter with `kind`: goals, shots, cards, substitutions, set_pieces, fouls, all | 10 |
| `list_teams` | Club ids and abbreviations, to resolve a name | 1 |

## Commands That Do NOT Exist

| Not Available | Use Instead |
|--------------|-------------|
| `get_match`, `get_fixture` | `get_game` for one match, `list_games` for many |
| `get_live_score` | Not available. `get_schedule` shows `status` and `status_detail` for matches today |
| `get_team_schedule` | `list_games` with `team` |
| `search_games` | `list_games` with `team`, `date`, `from`, `to` |
| `get_referee`, `get_injuries` | Not available |

## How It Works

**Step 1: Identify the competition.** The default is the Premier League. For anything else pass `league` (`mls`, `laliga`, `seriea`, `bundesliga`, `ligue1`, `ucl`, and so on). A `game_id` is competition-scoped: passing a Champions League id without `league` set to `ucl` will not find it.

**Step 2: Find the match.**

```
list_games {"team": "ARS", "season": 2025, "status": "final", "limit": 5}
```

- `status` is `scheduled` or `final`. Results come back newest first.
- `stage: "league"` is league-table games (regular season, group stage, league phase). `stage: "knockout"` is qualifying, knockout rounds and playoffs.
- Page with `offset`, using the `next_offset` the response returns. `limit` goes up to 200.
- `date`, `from` and `to` are UTC. An evening kickoff in the Americas can land on the next UTC date.

**Step 3: Pick the lightest call that answers it.**

| Question | Call |
|----------|------|
| Score, winner | The `home.score`, `away.score` and `result` (`H`, `D`, `A`) already in `list_games` |
| Team stats, xG, who played | `get_game` |
| Who scored and assisted | `get_game` `key_events`, or `get_events` with `kind: "goals"` |
| Shots with location | `get_events` with `kind: "shots"` or `get_shot_map` with `game_id` |
| Formation and subs | `get_lineups` |

**Step 4: Read the box score honestly.** `get_game` returns `team_stats` with `goals`, `xg`, `possession_pct`, `shots`, `shots_on_target`, `corners`, `fouls`, cards, `passes`, `tackles` and `penalty_goals`. A stat ESPN did not chart is `null`, never 0. xG is StrikerAPI's own, computed from located shots, and is `null` for seasons without located shots.

## Worked Example

Arsenal at Crystal Palace, 24 May 2026, `game_id` 740968:

```
list_games {"team": "ARS", "season": 2025, "status": "final", "limit": 1}
get_game {"game_id": "740968"}
```

Trimmed to the fields that matter:

```
result: A   Crystal Palace 1, Arsenal 2   (Selhurst Park)
team_stats:
  CRY  goals 1  xg 0.86  possession 39.7  shots 8   on target 3
  ARS  goals 2  xg 2.42  possession 60.3  shots 17  on target 7
players: 40 lines   key_events: 14   odds: 8 books
```

Read: Arsenal won 2-1 and the xG (2.42 to 0.86) agrees with the scoreline. One match tells you little about quality; see `xg-analysis` for why a single xG gap is noisy.

For the goals, `get_events {"game_id": "740968", "kind": "goals"}` returns three events, each with the scorer, the assister (`player2`), the shot's `xg` (0.104, 0.035 and 0.164 in this match), `body_part`, `zone` and coordinates.

## Edge Cases

- **Old matches.** Events for older matches carry goals, cards and substitutions only. Shots, fouls and corners start with the seasons that have located shots (2012-13 for the longest-covered leagues).
- **Shootouts.** `get_game` returns the score with the shootout. Event rows carry a `shootout` flag. Exclude shootout rows from goal counts.
- **Own goals and penalties** are flagged on the event (`own_goal`, `penalty`). Filter before crediting a scorer.
- **Postponed or unplayed matches** appear as `scheduled`. Do not report a `null` score as 0-0.
- **Two-leg ties** are two separate matches. Use `stage: "knockout"` and sum the legs yourself.

## Anti-patterns

| Rationalization | Why It's Wrong | Do This Instead |
|----------------|---------------|-----------------|
| "Loop `get_game` over the season for scores" | 5 credits each; `list_games` returns 200 scores for 2 | Use `list_games` and open only the matches you need |
| "Use `get_events` to get the final score" | 10 credits for data already in the list | Read `result` and the scores from `list_games` |
| "Guess the game_id from a URL" | Ids are ESPN match ids per competition | Look it up with `list_games` or `get_schedule` |
| "Call a null xG zero" | Null means no located shots, not a blank attack | Report it as not available |

## Output Format

```
[Home] [score] - [score] [Away]   [date]   [competition, stage]
Venue: [venue]   xG: [home] to [away]   Shots: [h] to [a] (on target [h] to [a])
Goals: [min] [scorer] (assist [name], xG [x.xx]) ...
Cards/subs of note: ...
```

State the competition and `game_id`. Offer the next level of detail rather than dumping all 40 player lines.

## What to Do Next

| What You Found | Next Action | Skill |
|----------------|-------------|-------|
| Need the price for this match | Compare books | `odds-explorer` |
| xG gap looks interesting | Pull the shot map | `xg-analysis` |
| Want the whole table context | League position and form | `team-analysis` |
| Need a pre-match view | Form, Elo, head to head, line | `match-preview` |
| A player stood out | Season rates and log | `player-scouting` |
