import {AppError} from '../errors.mjs';
import {hash, MINUTE, HOUR, DAY} from '../util.mjs';

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
const PLAN_BLOCK_MS = 6 * HOUR;
/** How long past its expiry a cached response may still be served if a refresh fails. */
const STALE_MS = DAY;
const REQUEST_TIMEOUT_MS = 10_000;

/** Short single-line text for error messages (provider replies never contain our keys). */
const brief = (v) =>
  (typeof v === 'string' ? v : JSON.stringify(v)).replace(/\s+/g, ' ').trim().slice(0, 140);

/**
 * Returns `provider(kind, path, ttl)`: a cached, de-duplicated, budgeted and
 * cooldown-protected GET against API-Football (`ap`) or football-data.org (`fd`).
 *
 * - Fresh cache hits are returned with `fromCache: true` and cost nothing.
 * - If a refresh fails (rate limit, outage, cooldown) but an older copy exists within
 *   STALE_MS, that copy is returned with `stale: true` instead of an error.
 * - `provider.stats.fetches` counts real upstream requests (used to budget prefetching).
 */
export function createProviderClient({env, store, fetcher, now, storage}) {
  const {read, budget} = storage;
  const pending = new Map();
  const stats = {fetches: 0};

  async function load(kind, path, ttl, cacheKey) {
    const {name, baseUrl, keyEnv, headers} = PROVIDERS[kind];

    // A plan/season restriction will not fix itself soon: do not spend quota retrying it.
    const blockKey = 'planblock/' + hash(kind + ':' + path);
    const blocked = await read(blockKey);
    if (blocked?.until > now()) throw new AppError(403, 'plan', blocked.reason);

    const cooldown = await read('cooldown/' + kind);
    if (cooldown?.until > now())
      throw new AppError(
        429,
        'cooldown',
        cooldown.reason
          ? `${cooldown.reason} (${name} is paused for a minute.)`
          : `${name} is cooling down after an API error.`,
      );

    if (pending.has(cacheKey)) return pending.get(cacheKey);

    const task = (async () => {
      try {
        await budget(kind + '-minute', PER_MINUTE_LIMIT, MINUTE);
        if (kind === 'ap') {
          const daily = Math.max(1, Math.min(150000, Number(env.API_FOOTBALL_DAILY_LIMIT) || 100));
          await budget('ap-day', daily, DAY);
        }
        stats.fetches++;
        const response = await fetcher(baseUrl + path, {
          headers: headers(env[keyEnv]),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          const detail = brief(await response.text().catch(() => ''));
          console.warn(
            `[provider:${kind}] HTTP ${response.status} for ${path.split('?')[0]}: ${detail}`,
          );
          throw new AppError(
            response.status === 429 ? 429 : 502,
            'provider',
            `${name} request failed (HTTP ${response.status}${detail ? ': ' + detail : ''}). Check plan access, API key and quota.`,
          );
        }
        const body = await response.json();
        if (body.errors?.plan) {
          const reason = `${name} plan limit: ${brief(body.errors.plan)}`;
          console.warn(`[provider:${kind}] ${reason} (${path.split('?')[0]})`);
          await store.setJSON(blockKey, {until: now() + PLAN_BLOCK_MS, reason});
          throw new AppError(403, 'plan', reason);
        }
        if ((body.errors && Object.keys(body.errors).length) || body.errorCode) {
          const detail = brief(body.errors ?? body.message ?? body.errorCode);
          console.warn(`[provider:${kind}] rejected ${path.split('?')[0]}: ${detail}`);
          throw new AppError(
            502,
            'provider',
            `${name} rejected this request: ${detail}. Your plan may not cover the selected season or league.`,
          );
        }
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
            : new AppError(
                502,
                'provider',
                `${name} is temporarily unavailable (${e?.name ?? 'error'}).`,
              );
        if (!(e instanceof AppError)) console.error(`[provider:${kind}] unexpected failure`, e);
        if (err.code === 'provider')
          await store.setJSON('cooldown/' + kind, {
            until: now() + COOLDOWN_MS,
            reason: err.message,
          });
        throw err;
      } finally {
        pending.delete(cacheKey);
      }
    })();
    pending.set(cacheKey, task);
    return task;
  }

  async function provider(kind, path, ttl) {
    const {name, keyEnv} = PROVIDERS[kind];
    if (!env[keyEnv]) throw new AppError(503, 'not_configured', `${name} key is not configured.`);

    const cacheKey = 'cache/' + hash(kind + ':' + path);
    const cached = await read(cacheKey);
    if (cached && cached.until > now()) return {...cached, fromCache: true};

    try {
      return await load(kind, path, ttl, cacheKey);
    } catch (e) {
      const usable = cached && now() - cached.until < STALE_MS;
      if (usable && e.code !== 'plan') return {...cached, stale: true};
      throw e;
    }
  }

  provider.stats = stats;
  return provider;
}
