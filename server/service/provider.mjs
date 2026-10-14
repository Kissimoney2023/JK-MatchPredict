import {AppError} from '../errors.mjs';
import {hash, MINUTE, DAY} from '../util.mjs';

const PROVIDERS = {
  ap: {
    name: 'API-Football',
    baseUrl: 'https://v3.football.api-sports.io/',
    keyEnv: 'API_FOOTBALL_KEY',
    headers: (key) => ({'x-apisports-key': key}),
  },
  fd: {
    name: 'football-data.org',
    baseUrl: 'https://api.football-data.org/v4/',
    keyEnv: 'FOOTBALL_DATA_ORG_KEY',
    headers: (key) => ({'X-Auth-Token': key}),
  },
};
const PER_MINUTE_LIMIT = 9;
const COOLDOWN_MS = MINUTE;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Returns `provider(kind, path, ttl)`: a cached, de-duplicated, budgeted and
 * cooldown-protected GET against API-Football (`ap`) or football-data.org (`fd`).
 */
export function createProviderClient({env, store, fetcher, now, storage}) {
  const {read, budget} = storage;
  const pending = new Map();

  return async function provider(kind, path, ttl) {
    const {name, baseUrl, keyEnv, headers} = PROVIDERS[kind];
    const key = env[keyEnv];
    if (!key) throw new AppError(503, 'not_configured', `${name} key is not configured.`);

    const cacheKey = 'cache/' + hash(kind + ':' + path);
    const cached = await read(cacheKey);
    if (cached && cached.until > now()) return cached;

    const cooldown = await read('cooldown/' + kind);
    if (cooldown?.until > now())
      throw new AppError(429, 'cooldown', `${name} is cooling down after an API error.`);

    if (pending.has(cacheKey)) return pending.get(cacheKey);

    const task = (async () => {
      try {
        await budget(kind + '-minute', PER_MINUTE_LIMIT, MINUTE);
        if (kind === 'ap') {
          const daily = Math.max(1, Math.min(150000, Number(env.API_FOOTBALL_DAILY_LIMIT) || 100));
          await budget('ap-day', daily, DAY);
        }
        const response = await fetcher(baseUrl + path, {
          headers: headers(key),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok)
          throw new AppError(
            response.status === 429 ? 429 : 502,
            'provider',
            `${name} request failed. Check plan access, API key and quota.`,
          );
        const body = await response.json();
        if ((body.errors && Object.keys(body.errors).length) || body.errorCode)
          throw new AppError(
            502,
            'provider',
            `${name} rejected this request. Your plan may not cover the selected season or league.`,
          );
        if (body.paging?.total > 1)
          throw new AppError(
            502,
            'pagination',
            'Provider returned a partial result. Please narrow your date range.',
          );
        const value = {body, at: now(), until: now() + ttl};
        await store.setJSON(cacheKey, value);
        return value;
      } catch (e) {
        const err =
          e instanceof AppError
            ? e
            : new AppError(502, 'provider', `${name} is temporarily unavailable.`);
        if (err.code === 'provider')
          await store.setJSON('cooldown/' + kind, {until: now() + COOLDOWN_MS});
        throw err;
      } finally {
        pending.delete(cacheKey);
      }
    })();
    pending.set(cacheKey, task);
    return task;
  };
}
