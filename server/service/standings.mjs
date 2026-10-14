import {AppError} from '../errors.mjs';
import {HOUR} from '../util.mjs';

const STANDINGS_TTL = 12 * HOUR;
const MAX_GROUPS = 16;

const row = (r) => ({
  position: r.position,
  team: r.team?.shortName || r.team?.name || '—',
  played: r.playedGames,
  won: r.won,
  drawn: r.draw,
  lost: r.lost,
  goalsFor: r.goalsFor,
  goalsAgainst: r.goalsAgainst,
  goalDifference: r.goalDifference,
  points: r.points,
});

/** Overall (TOTAL) standings tables from football-data.org, cached for 12 hours. */
export function createStandings({env, provider, league}) {
  async function standings(leagueKey) {
    if (!env.FOOTBALL_DATA_ORG_KEY)
      throw new AppError(503, 'not_configured', 'football-data.org key is not configured.');
    const selected = await league(leagueKey);
    if (!selected?.fdCode)
      throw new AppError(404, 'standings', 'Standings are not available for this competition.');

    const r = await provider('fd', `competitions/${selected.fdCode}/standings`, STANDINGS_TTL);
    const groups = (r.body.standings ?? [])
      .filter((s) => s.type === 'TOTAL' && Array.isArray(s.table) && s.table.length)
      .slice(0, MAX_GROUPS)
      .map((s) => ({
        name: s.group ? String(s.group).replace(/_/g, ' ') : null,
        table: s.table.map(row),
      }));
    return {
      competition: r.body.competition?.name || selected.name,
      season: r.body.season?.startDate?.slice(0, 4) ?? null,
      groups,
      fetchedAt: r.at,
      stale: !!r.stale,
    };
  }
  return {standings};
}
