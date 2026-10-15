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
  // StrikerAPI: POST /v1/<tool> with a JSON body, results wrapped as {"data": ...}.
  sa: {
    name: 'StrikerAPI',
    baseUrl: 'https://mcp.strikerapi.com/v1/',
    keyEnv: 'STRIKERAPI_API_KEY',
    headers: (key) => ({'x-api-key': key, 'Content-Type': 'application/json'}),
    post: true,
  },
};
const PER_MINUTE_LIMIT = {ap: 9, fd: 9, sa: 8};
const COOLDOWN_MS = MINUTE;
const PLAN_BLOCK_MS = 6 * HOUR;
/** How long past its expiry a cached response may still be served if a refresh fails. */
const STALE_MS = DAY;
const REQUEST_TIMEOUT_MS = 10_000;

// StrikerAPI credit price per tool (docs: 1 / 2 / 5 / 10 credits). Unknown tools are priced high.
const SA_COSTS = {
  list_teams: 1,
  search_players: 1,
  list_games: 2,
  get_schedule: 2,
  get_standings: 2,
  get_ratings: 2,
  get_head_to_head: 2,
};
const SA_DEFAULT_COST = 10;
const SA_DEFAULT_MONTHLY_CREDITS = 450; // free tier is 500; keep a margin

/** Short single-line text for error messages (provider replies never contain our keys). */
const brief = (v) =>
  (typeof v === 'string' ? v : JSON.stringify(v)).replace(/\s+/g, ' ').trim().slice(0, 140);

/**
 * Returns `provider(kind, path, ttl, body?)`: a cached, de-duplicated, budgeted and
 * cooldown-protected request to API-Football (`ap`), football-data.org (`fd`) or
 * StrikerAPI (`sa`; `path` is the tool name and `body` its JSON arguments).
 *
 * - Fresh cache hits are returned with `fromCache: true` and cost nothing.
 * - If a refresh fails (rate limit, outage, cooldown) but an older copy exists within
 *   STALE_MS, that copy is returned with `stale: true` instead of an error.
 * - `provider.stats.fetches` counts real upstream requests (used to budget prefetching).
 * - StrikerAPI calls also spend credits from a monthly cap (STRIKERAPI_MONTHLY_CREDITS).
 */
export function createProviderClient({env, store, fetcher, now, storage}) {
  const {read, budget} = storage;
  const pending = new Map();
  const stats = {fetches: 0};

  /** Identifies a request for caching: the path plus, for POST providers, the JSON body. */
  const target = (path, body) => (body ? path + '#' + JSON.stringify(body) : path);

  async function load(kind, path, ttl, body, cacheKey) {
    const {name, baseUrl, keyEnv, headers, post} = PROVIDERS[kind];

    // A plan/season restriction will not fix itself soon: do not spend quota retrying it.
    const blockKey = 'planblock/' + hash(kind + ':' + target(path, body));
    const blocked = await read(blockKey);
    if (blocked?.until > now()) throw new AppError(403, 'plan', blocked.reason);

    const cooldown = await read('cooldown/' + kind);
    if (cooldown?.until > now())
      throw new AppError(
        429,
        'cooldown',
        cooldown.reason
          ? `${cooldown.reason} (${name} is paused for a while.)`
          : `${name} is cooling down after an API error.`,
      );

    if (pending.has(cacheKey)) return pending.get(cacheKey);

    const task = (async () => {
      try {
        await budget(kind + '-minute', PER_MINUTE_LIMIT[kind], MINUTE);
        if (kind === 'ap') {
          const daily = Math.max(1, Math.min(150000, Number(env.API_FOOTBALL_DAILY_LIMIT) || 100));
          await budget('ap-day', daily, DAY);
        }
        if (kind === 'sa') {
          const cap = Math.max(
            1,
            Number(env.STRIKERAPI_MONTHLY_CREDITS) || SA_DEFAULT_MONTHLY_CREDITS,
          );
          await budget('sa-credits', cap, 30 * DAY, SA_COSTS[path] ?? SA_DEFAULT_COST);
        }
        stats.fetches++;
        const response = await fetcher(baseUrl + path, {
          method: post ? 'POST' : 'GET',
          headers: headers(env[keyEnv]),
          body: post ? JSON.stringify(body ?? {}) : undefined,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          const detail = brief(await response.text().catch(() => ''));
          console.warn(
            `[provider:${kind}] HTTP ${response.status} for ${path.split('?')[0]}: ${detail}`,
          );
          const status = response.status;
          const described = `${name} request failed (HTTP ${status}${detail ? ': ' + detail : ''}). Check plan access, API key and quota.`;
          // 403: this resource is not on the plan. Remember that for the request, but do not
          // pause the whole provider: its other endpoints still work.
          if (status === 403) {
            const reason = `${name} does not cover this request on your plan (HTTP 403${detail ? ': ' + detail : ''}).`;
            await store.setJSON(blockKey, {until: now() + PLAN_BLOCK_MS, reason});
            throw new AppError(403, 'plan', reason);
          }
          // 400 / 404: a problem with this one request, not with the provider.
          if (status === 400 || status === 404)
            throw new AppError(
              status === 404 ? 404 : 502,
              'request',
              `${name} request failed (HTTP ${status}${detail ? ': ' + detail : ''}).`,
            );
          // 401, 429, 5xx: the provider (or our key) is unusable for a while.
          const error = new AppError(status === 429 ? 429 : 502, 'provider', described);
          // Out of credits / bad key will not recover within a minute.
          if (kind === 'sa' && (status === 402 || status === 401)) error.cooldownMs = HOUR;
          throw error;
        }
        const raw = await response.json();
        const bodyJson = kind === 'sa' ? (raw?.data ?? null) : raw;
        if (kind === 'sa' && (raw?.error || bodyJson === null)) {
          const detail = brief(raw?.message ?? raw?.error ?? 'empty response');
          console.warn(`[provider:sa] rejected ${path}: ${detail}`);
          throw new AppError(502, 'provider', `${name} rejected this request: ${detail}.`);
        }
        if (kind !== 'sa' && bodyJson.errors?.plan) {
          const reason = `${name} plan limit: ${brief(bodyJson.errors.plan)}`;
          console.warn(`[provider:${kind}] ${reason} (${path.split('?')[0]})`);
          await store.setJSON(blockKey, {until: now() + PLAN_BLOCK_MS, reason});
          throw new AppError(403, 'plan', reason);
        }
        if (
          kind !== 'sa' &&
          ((bodyJson.errors && Object.keys(bodyJson.errors).length) || bodyJson.errorCode)
        ) {
          const detail = brief(bodyJson.errors ?? bodyJson.message ?? bodyJson.errorCode);
          console.warn(`[provider:${kind}] rejected ${path.split('?')[0]}: ${detail}`);
          throw new AppError(
            502,
            'provider',
            `${name} rejected this request: ${detail}. Your plan may not cover the selected season or league.`,
          );
        }
        if (bodyJson.paging?.total > 1)
          throw new AppError(
            502,
            'pagination',
            'Provider returned a partial result. Please narrow your date range.',
          );
        const value = {body: bodyJson, at: now(), until: now() + ttl};
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
            until: now() + (err.cooldownMs ?? COOLDOWN_MS),
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

  async function provider(kind, path, ttl, body) {
    const {name, keyEnv} = PROVIDERS[kind];
    if (!env[keyEnv]) throw new AppError(503, 'not_configured', `${name} key is not configured.`);

    const cacheKey = 'cache/' + hash(kind + ':' + target(path, body));
    const cached = await read(cacheKey);
    if (cached && cached.until > now()) return {...cached, fromCache: true};

    try {
      return await load(kind, path, ttl, body, cacheKey);
    } catch (e) {
      const usable = cached && now() - cached.until < STALE_MS;
      if (usable && e.code !== 'plan') return {...cached, stale: true};
      throw e;
    }
  }

  /** Cached copy of a request (any age up to `maxAgeMs`), never calling the provider. */
  provider.peek = async (kind, path, maxAgeMs, body) => {
    const cached = await read('cache/' + hash(kind + ':' + target(path, body)));
    return cached && now() - cached.at < maxAgeMs ? cached : null;
  };
  provider.stats = stats;
  return provider;
}
