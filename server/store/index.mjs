import {Redis} from '@upstash/redis';
import {createMemoryStore} from './memory.mjs';
import {createRedisStore} from './redis.mjs';

/**
 * Picks Redis when Upstash credentials are present (set automatically by the Vercel
 * Marketplace integration as KV_REST_API_*, or manually as UPSTASH_REDIS_REST_*),
 * otherwise a temporary in-memory store.
 */
export function createStore(env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token)
    return createRedisStore(new Redis({url, token, automaticDeserialization: false}));
  return createMemoryStore();
}
