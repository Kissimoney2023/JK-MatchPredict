import {randomUUID} from 'node:crypto';

const DAY = 86_400;

/** Expiry (seconds) per key prefix, so caches and counters do not accumulate forever. */
const TTL_BY_PREFIX = {
  'budget/': 2 * DAY,
  'cache/': 2 * DAY,
  'cooldown/': DAY,
  'listing/': 7 * DAY,
  'forecast/': 30 * DAY,
};
const ttlFor = (key) => Object.entries(TTL_BY_PREFIX).find(([p]) => key.startsWith(p))?.[1];

// Values are stored as "<etag>\n<json>". Compare-and-set must be atomic, hence Lua.
const COMPARE_AND_SET = `
local cur = redis.call('GET', KEYS[1])
if not cur then return 0 end
local sep = string.find(cur, '\\n', 1, true)
if not sep or string.sub(cur, 1, sep - 1) ~= ARGV[1] then return 0 end
if tonumber(ARGV[3]) > 0 then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
else
  redis.call('SET', KEYS[1], ARGV[2])
end
return 1`;

const encode = (etag, value) => `${etag}\n${JSON.stringify(value)}`;
function decode(raw) {
  if (raw == null) return null;
  const text = String(raw);
  const sep = text.indexOf('\n');
  return {etag: text.slice(0, sep), data: JSON.parse(text.slice(sep + 1))};
}

/**
 * Store backed by an Upstash-compatible Redis client (`@upstash/redis`).
 * Implements get / getWithMetadata / setJSON with `onlyIfNew` and `onlyIfMatch` semantics.
 */
export function createRedisStore(redis) {
  return {
    kind: 'redis',
    async get(key) {
      return decode(await redis.get(key))?.data ?? null;
    },
    async getWithMetadata(key) {
      return decode(await redis.get(key));
    },
    async setJSON(key, value, opts = {}) {
      const etag = randomUUID();
      const payload = encode(etag, value);
      const ex = ttlFor(key);
      if (opts.onlyIfMatch) {
        const ok = await redis.eval(COMPARE_AND_SET, [key], [opts.onlyIfMatch, payload, ex ?? 0]);
        return {modified: Number(ok) === 1};
      }
      const options = {...(opts.onlyIfNew ? {nx: true} : {}), ...(ex ? {ex} : {})};
      const ok = await redis.set(key, payload, options);
      return {modified: ok === 'OK'};
    },
  };
}
