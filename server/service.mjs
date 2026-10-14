import {createStorage} from './service/storage.mjs';
import {createProviderClient} from './service/provider.mjs';
import {createCatalog} from './service/catalog.mjs';
import {createFixtures} from './service/fixtures.mjs';
import {createLookup} from './service/lookup.mjs';
import {createHistory} from './service/history.mjs';
import {createStandings} from './service/standings.mjs';
import {createStrikerApi} from './service/strikerapi.mjs';
import {createInsights} from './service/insights.mjs';
import {createForecast} from './service/forecast.mjs';
import {createPicks} from './service/picks.mjs';
import {createPrefetch} from './service/prefetch.mjs';

export {AppError} from './errors.mjs';
export {hash, dates} from './util.mjs';

/** Wires the football service from its parts. All I/O is injected for testability. */
export function createService({env, store, fetcher = fetch, now = Date.now}) {
  const storage = createStorage({store, now});
  const provider = createProviderClient({env, store, fetcher, now, storage});
  const {catalog, league} = createCatalog({env, provider});
  const {fixtures} = createFixtures({env, store, provider, league});
  const lookup = createLookup({env, provider});
  const history = createHistory({provider, now});
  const strikerApi = createStrikerApi({env, provider});
  const {standings} = createStandings({env, provider, league, strikerApi});
  const {withForm, insights} = createInsights({
    env,
    now,
    storage,
    history,
    lookup,
    strikerApi,
  });
  // Fixture lists include each team's recent form when its history is already cached.
  const fixturesWithForm = async (params) => {
    const result = await fixtures(params);
    return {...result, fixtures: await withForm(result.fixtures)};
  };
  const {forecast} = createForecast({
    env,
    store,
    now,
    storage,
    provider,
    lookup,
    history,
    strikerApi,
  });
  const {picks, save, settlePicks} = createPicks({now, storage, lookup});
  const prefetch = createPrefetch({
    env,
    now,
    provider,
    catalog,
    fixtures,
    standings,
    history,
    strikerApi,
  });

  const status = () => ({
    connected: !!(env.API_FOOTBALL_KEY || env.FOOTBALL_DATA_ORG_KEY),
    storage: store.kind ?? 'unknown',
    providers: [
      {name: 'API-Football', configured: !!env.API_FOOTBALL_KEY, role: 'Primary'},
      {name: 'football-data.org', configured: !!env.FOOTBALL_DATA_ORG_KEY, role: 'Fallback'},
      {name: 'StrikerAPI', configured: !!env.STRIKERAPI_API_KEY, role: 'Enrichment'},
    ],
  });

  return {
    status,
    catalog,
    fixtures: fixturesWithForm,
    insights,
    standings,
    forecast,
    picks,
    save,
    settlePicks,
    prefetch: prefetch.run,
    budget: storage.budget,
  };
}
