import {AppError} from '../errors.mjs';
import {DAY} from '../util.mjs';
import {LEAGUE_MAPPING} from './normalize.mjs';

export function createCatalog({env, provider}) {
  async function catalog() {
    const items = new Map();
    const warnings = [];

    if (env.API_FOOTBALL_KEY) {
      try {
        const r = await provider('ap', 'leagues?current=true', DAY);
        for (const x of r.body.response ?? []) {
          const season = x.seasons?.find((s) => s.current);
          if (!season || !Number.isInteger(x.league?.id)) continue;
          items.set('ap:' + x.league.id, {
            key: 'ap:' + x.league.id,
            name: x.league.name,
            country: x.country?.name || 'International',
            apId: x.league.id,
            fdCode: LEAGUE_MAPPING[x.league.id],
            season: season.year,
            predictions: !!season.coverage?.predictions,
            source: 'API-Football',
            type: x.league.type,
          });
        }
      } catch (e) {
        warnings.push(e.message);
      }
    }

    if (env.FOOTBALL_DATA_ORG_KEY) {
      try {
        const r = await provider('fd', 'competitions', DAY);
        for (const c of r.body.competitions ?? []) {
          if (!c.code) continue;
          const shared = [...items.values()].find((x) => x.fdCode === c.code);
          if (shared) {
            shared.fallback = true;
            continue;
          }
          items.set('fd:' + c.code, {
            key: 'fd:' + c.code,
            name: c.name,
            country: c.area?.name || 'International',
            fdCode: c.code,
            season: Number(c.currentSeason?.startDate?.slice(0, 4)),
            source: 'football-data.org',
            fallback: true,
            type: c.type,
          });
        }
      } catch (e) {
        warnings.push(e.message);
      }
    }

    const leagues = [...items.values()].sort(
      (a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name),
    );
    return {leagues, warnings};
  }

  /** Resolves a league key, or `null` for "all leagues". */
  async function league(key) {
    if (!key || key === 'all') return null;
    const {leagues} = await catalog();
    const found = leagues.find((x) => x.key === key);
    if (!found)
      throw new AppError(404, 'league', 'That league is unavailable through the configured APIs.');
    return found;
  }

  return {catalog, league};
}
