import {HOUR, DAY} from '../util.mjs';
import {eloExpectedScore, findGame, marketFromLine, saLeagueFor, sameTeam} from '../strikerapi.mjs';

const TTL = {schedule: 12 * HOUR, ratings: 24 * HOUR, standings: 12 * HOUR, headToHead: 7 * DAY};
const SCHEDULE_DAYS = 30;
const RATINGS_LIMIT = 200;
const H2H_LIST = 5;

const off = (v) => ['off', 'false', '0', 'no'].includes(String(v ?? '').toLowerCase());

/**
 * StrikerAPI enrichment: market consensus, Elo ratings, full head-to-head and standings.
 * Everything here is optional; failures return null so the app falls back to other sources.
 * Calls are cached for hours or days and capped by STRIKERAPI_MONTHLY_CREDITS.
 */
export function createStrikerApi({env, provider}) {
  const enabled = () => !!env.STRIKERAPI_API_KEY;
  const marketEnabled = () => enabled() && !off(env.STRIKERAPI_MARKET_FORECASTS);

  const schedule = (league) =>
    provider('sa', 'get_schedule', TTL.schedule, {league, days: SCHEDULE_DAYS});
  const ratings = (league) =>
    provider('sa', 'get_ratings', TTL.ratings, {league, limit: RATINGS_LIMIT});
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
  };
}
