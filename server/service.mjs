import {createStorage} from './service/storage.mjs';
import {createProviderClient} from './service/provider.mjs';
import {createCatalog} from './service/catalog.mjs';
import {createFixtures} from './service/fixtures.mjs';
import {createLookup} from './service/lookup.mjs';
import {createForecast} from './service/forecast.mjs';
import {createPicks} from './service/picks.mjs';

export {AppError} from './errors.mjs';
export {hash, dates} from './util.mjs';

/** Wires the football service from its parts. All I/O is injected for testability. */
export function createService({env, store, fetcher = fetch, now = Date.now}) {
  const storage = createStorage({store, now});
  const provider = createProviderClient({env, store, fetcher, now, storage});
  const {catalog, league} = createCatalog({env, provider});
  const {fixtures} = createFixtures({env, store, provider, league});
  const lookup = createLookup({env, provider});
  const {forecast} = createForecast({env, store, now, storage, provider, lookup});
  const {picks, save, settlePicks} = createPicks({now, storage, lookup});

  const status = () => ({
    connected: !!(env.API_FOOTBALL_KEY || env.FOOTBALL_DATA_ORG_KEY),
    providers: [
      {name: 'API-Football', configured: !!env.API_FOOTBALL_KEY, role: 'Primary'},
      {name: 'football-data.org', configured: !!env.FOOTBALL_DATA_ORG_KEY, role: 'Fallback'},
    ],
  });

  return {status, catalog, fixtures, forecast, picks, save, settlePicks, budget: storage.budget};
}
