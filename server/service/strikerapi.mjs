import {HOUR, DAY} from '../util.mjs';
import {
  eloExpectedScore,
  findGame,
  marketFromLine,
  normSA,
  saLeagueFor,
  saSettlementRaw,
  sameTeam,
  SA_ONLY_COMPETITIONS,
} from '../strikerapi.mjs';
import {AppError} from '../errors.mjs';

const TTL = {
  schedule: 12 * HOUR,
  ratings: 24 * HOUR,
  standings: 12 * HOUR,
  headToHead: 7 * DAY,
  teamStats: 7 * DAY, // per-match averages move slowly; 5 credits per league per week
  lineups: 10 * 60_000, // short: an answer before the teams are named must not stick
  games: 2 * HOUR, // results of a competition over a date range
};
const GAMES_LIMIT = 200;

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

/**
 * One club's per-match averages from a team-stats row. Field names follow the StrikerAPI
 * docs (`xg_for`, `xg_against`, goals for and against); a few likely variants are accepted
 * and anything unreadable becomes null rather than an error.
 */
export function parseTeamStats(row) {
  if (!row) return null;
  const pick = (...keys) => {
    for (const k of keys) if (row[k] !== undefined) return num(row[k]);
    return null;
  };
  const stats = {
    name: row.name ?? row.team ?? row.team_name ?? null,
    games: pick('games', 'played', 'matches', 'gp'),
    xgFor: pick('xg_for', 'xg', 'xgf'),
    xgAgainst: pick('xg_against', 'xga'),
    goalsFor: pick('goals_for', 'goals', 'gf'),
    goalsAgainst: pick('goals_against', 'ga'),
    shots: pick('shots', 'shots_for'),
    shotsOnTarget: pick('shots_on_target', 'sot'),
  };
  return stats.xgFor === null && stats.xgAgainst === null ? null : stats;
}
const SCHEDULE_DAYS = 30;
const RATINGS_LIMIT = 200;
const H2H_LIST = 5;

const off = (v) => ['off', 'false', '0', 'no'].includes(String(v ?? '').toLowerCase());

/**
 * StrikerAPI enrichment: market consensus, Elo ratings, full head-to-head and standings.
 * Everything here is optional; failures return null so the app falls back to other sources.
 * Calls are cached for hours or days and capped by STRIKERAPI_MONTHLY_CREDITS.
 */
export function createStrikerApi({env, provider, now = Date.now}) {
  const enabled = () => !!env.STRIKERAPI_API_KEY;
  const marketEnabled = () => enabled() && !off(env.STRIKERAPI_MARKET_FORECASTS);

  /** The league's schedule with lines; `maxAge` forces a fresher copy (costs credits). */
  const schedule = (league, maxAge = TTL.schedule) =>
    provider('sa', 'get_schedule', maxAge, {league, days: SCHEDULE_DAYS});
  const ratings = (league) =>
    provider('sa', 'get_ratings', TTL.ratings, {league, limit: RATINGS_LIMIT});
  /** Every club's per-match averages (including xG) in one call. */
  const teamStats = (league) => provider('sa', 'get_team_stats', TTL.teamStats, {league});

  /** Rows of a team-stats response, whatever the envelope is called. */
  const statRows = (body) =>
    body?.stats ?? body?.teams ?? body?.rows ?? (Array.isArray(body) ? body : []);

  /** xG for and against per match for both clubs, from the league's averages. */
  const xgFor = (fixture) =>
    optional(async () => {
      const league = saLeagueFor(fixture.fdCode);
      if (!enabled() || !league) return null;
      const r = await teamStats(league);
      const rows = statRows(r.body);
      const find = (name) =>
        parseTeamStats(rows.find((row) => sameTeam(row.name ?? row.team ?? row.team_name, name)));
      const home = find(fixture.home);
      const away = find(fixture.away);
      if (!home && !away) return null;
      return {home, away, league, fetchedAt: r.at, stale: !!r.stale, asOf: r.body?.as_of ?? null};
    });

  /** The schedule's game id for a fixture (from the cached schedule), or null. */
  const gameIdFor = (fixture) =>
    optional(async () => {
      const league = saLeagueFor(fixture.fdCode);
      if (!enabled() || !league) return null;
      const game = findGame((await schedule(league)).body.games ?? [], fixture);
      return game ? {gameId: game.game_id, league} : null;
    });

  /** Line-ups for a game (5 credits); the raw body, parsed by the lineups service. */
  const lineups = (league, gameId) =>
    provider('sa', 'get_lineups', TTL.lineups, {league, game_id: gameId});

  /** Games of a competition between two dates (results included), 2 credits per call. */
  const listGames = (league, from, to) =>
    provider('sa', 'list_games', TTL.games, {league, from, to, limit: GAMES_LIMIT});

  const gameRows = (body) => body?.games ?? body?.rows ?? (Array.isArray(body) ? body : []);

  /** The competitions served from StrikerAPI alone (when it is configured). */
  const onlyCompetitions = () => (enabled() ? SA_ONLY_COMPETITIONS : []);

  /**
   * Fixtures of a StrikerAPI-only competition for a date range (UTC days, inclusive): the
   * schedule for what is to come, the games list for what was played. Merged by game id.
   */
  async function fixturesFor(competition, from, to) {
    const byId = new Map();
    let at = 0;
    let stale = false;
    const start = Date.parse(from);
    const end = Date.parse(to) + DAY;
    const take = (rows) => {
      for (const game of rows) {
        const f = normSA(game, competition);
        if (!f) continue;
        const t = Date.parse(f.kickoff);
        if (t >= start && t < end) byId.set(f.key, f);
      }
    };
    // Results and anything already played: only when the range reaches into the past.
    if (start < now()) {
      const r = await listGames(competition.league, from, to);
      take(gameRows(r.body));
      at = Math.max(at, r.at ?? 0);
      stale = stale || !!r.stale;
    }
    // Upcoming matches, with their market line, from the schedule (cached for hours).
    if (end > now()) {
      const r = await schedule(competition.league);
      take(r.body.games ?? []);
      at = Math.max(at, r.at ?? 0);
      stale = stale || !!r.stale;
    }
    return {items: [...byId.values()], at: at || now(), stale};
  }

  /** The current state of one StrikerAPI fixture (for settlement), from its day's games. */
  async function gameState(fixture) {
    const league = saLeagueFor(fixture.fdCode);
    if (!enabled() || !league) throw new AppError(404, 'fixture', 'Match data is unavailable.');
    const day = String(fixture.kickoff).slice(0, 10);
    const r = await listGames(league, day, day);
    const game = gameRows(r.body).find((g) => String(g.game_id ?? g.id) === fixture.externalId);
    if (!game) {
      // Not yet in the games list: the schedule still knows it (upcoming, maybe live).
      const s = await schedule(league);
      const upcoming = (s.body.games ?? []).find(
        (g) => String(g.game_id ?? g.id) === fixture.externalId,
      );
      if (!upcoming) throw new AppError(404, 'fixture', 'Match data is unavailable.');
      const f = normSA(upcoming, {name: fixture.competition, league, code: fixture.fdCode});
      return {f, raw: saSettlementRaw(upcoming)};
    }
    const f = normSA(game, {name: fixture.competition, league, code: fixture.fdCode});
    return {f, raw: saSettlementRaw(game)};
  }
  const standingsData = (league) => provider('sa', 'get_standings', TTL.standings, {league});

  /** Runs an optional lookup; any failure (quota, outage, bad data) becomes null. */
  async function optional(fn) {
    try {
      return await fn();
    } catch {
      return null;
    }
  }

  /** Margin-free market probabilities for a fixture, from the cached StrikerAPI schedule. */
  const marketFor = (fixture) =>
    optional(async () => {
      const league = saLeagueFor(fixture.fdCode);
      if (!marketEnabled() || !league) return null;
      const r = await schedule(league);
      const game = findGame(r.body.games ?? [], fixture);
      if (!game) {
        // Diagnostic for the logs: what the schedule offered around that kickoff.
        const kickoff = Date.parse(fixture.kickoff);
        const near = (r.body.games ?? [])
          .filter((g) => Math.abs(Date.parse(g.starts_at) - kickoff) <= 6 * 3_600_000)
          .map((g) => `${g.home?.name} vs ${g.away?.name}`);
        console.warn(
          `[strikerapi] no schedule game matched "${fixture.home} vs ${fixture.away}" (${fixture.kickoff}); schedule near kickoff: ${near.join(' | ') || 'none'}`,
        );
      }
      const market = game && marketFromLine(game.line);
      if (!market) return null;
      return {...market, gameId: game.game_id, league, fetchedAt: r.at, stale: !!r.stale};
    });

  const ratingRow = (rows, name) => rows.find((row) => sameTeam(row.name, name));

  /** Elo ratings of both teams in the fixture's competition (competition-only ratings). */
  const eloFor = (fixture) =>
    optional(async () => {
      const league = saLeagueFor(fixture.fdCode);
      if (!enabled() || !league) return null;
      const r = await ratings(league);
      const rows = r.body.ratings ?? [];
      const home = ratingRow(rows, fixture.home);
      const away = ratingRow(rows, fixture.away);
      if (!home || !away) return null;
      return {
        home: {name: home.name, elo: home.elo},
        away: {name: away.name, elo: away.elo},
        asOf: r.body.as_of ?? null,
        expectedHomeScore: Math.round(eloExpectedScore(home.elo, away.elo) * 1000) / 1000,
        league,
        fetchedAt: r.at,
      };
    });

  /** All-time meetings between the two clubs in this competition. */
  const headToHeadFor = (fixture) =>
    optional(async () => {
      const league = saLeagueFor(fixture.fdCode);
      if (!enabled() || !league) return null;
      const rows = (await ratings(league)).body.ratings ?? [];
      const home = ratingRow(rows, fixture.home);
      const away = ratingRow(rows, fixture.away);
      if (!home || !away) return null;
      const r = await provider('sa', 'get_head_to_head', TTL.headToHead, {
        league,
        team: home.team_id,
        opponent: away.team_id,
        limit: H2H_LIST,
      });
      const s = r.body.summary ?? {};
      return {
        meetings: s.meetings ?? 0,
        winsHome: s.team_wins ?? 0,
        draws: s.draws ?? 0,
        winsAway: s.opponent_wins ?? 0,
        goalsHome: s.team_goals ?? 0,
        goalsAway: s.opponent_goals ?? 0,
        firstMeeting: s.first_meeting ?? null,
        matches: (r.body.games ?? []).map((g) => ({
          date: g.date,
          home: g.home?.name,
          away: g.away?.name,
          score: `${g.home?.score}–${g.away?.score}`,
        })),
        fetchedAt: r.at,
      };
    });

  /** League table as {groups: [{name, table}]}, or null. Used when football-data.org cannot. */
  const standingsFor = (fdCode) =>
    optional(async () => {
      const league = saLeagueFor(fdCode);
      if (!enabled() || !league) return null;
      const r = await standingsData(league);
      const byGroup = new Map();
      for (const s of r.body.standings ?? []) {
        const name = s.group_name || null;
        if (!byGroup.has(name)) byGroup.set(name, []);
        byGroup.get(name).push({
          position: s.rank,
          team: s.display_name || s.abbrev,
          played: s.played,
          won: s.wins,
          drawn: s.draws,
          lost: s.losses,
          goalsFor: s.goals_for,
          goalsAgainst: s.goals_against,
          goalDifference: s.goal_diff,
          points: s.points,
        });
      }
      return {
        season: r.body.season ?? null,
        groups: [...byGroup].map(([name, table]) => ({name, table})),
        fetchedAt: r.at,
        stale: !!r.stale,
      };
    });

  return {
    enabled,
    marketEnabled,
    schedule,
    ratings,
    marketFor,
    eloFor,
    headToHeadFor,
    standingsFor,
    xgFor,
    gameIdFor,
    lineups,
    onlyCompetitions,
    fixturesFor,
    gameState,
  };
}
