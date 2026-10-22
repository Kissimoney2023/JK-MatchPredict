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

/**
 * Overall league tables, cached for 12 hours: football-data.org first, StrikerAPI as the
 * fallback when that provider is unconfigured, rate-limited or down.
 */
export function createStandings({env, provider, league, strikerApi}) {
  async function fromFootballData(selected) {
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
      source: 'football-data.org',
      season: r.body.season?.startDate?.slice(0, 4) ?? null,
      groups,
      fetchedAt: r.at,
      stale: !!r.stale,
    };
  }

  async function standings(leagueKey) {
    const selected = await league(leagueKey);
    if (!selected?.fdCode)
      throw new AppError(404, 'standings', 'Standings are not available for this competition.');

    let firstError = null;
    if (env.FOOTBALL_DATA_ORG_KEY && !selected.saOnly) {
      try {
        return await fromFootballData(selected);
      } catch (e) {
        firstError = e;
      }
    }
    const alternative = await strikerApi.standingsFor(selected.fdCode);
    if (alternative) {
      // A single table needs no heading.
      const groups =
        alternative.groups.length === 1
          ? [{...alternative.groups[0], name: null}]
          : alternative.groups.slice(0, MAX_GROUPS);
      return {competition: selected.name, source: 'StrikerAPI', ...alternative, groups};
    }
    throw (
      firstError ??
      new AppError(503, 'not_configured', 'No standings source is configured for this competition.')
    );
  }

  return {standings};
}
