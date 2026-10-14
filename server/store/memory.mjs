/**
 * In-memory store with the same contract as the Redis store. Used when no Redis is configured
 * (local development, previews). Data lives only as long as the function instance.
 */
export function createMemoryStore() {
  const data = new Map();
  let seq = 0;
  return {
    kind: 'memory',
    async get(key) {
      return structuredClone(data.get(key)?.data ?? null);
    },
    async getWithMetadata(key) {
      return structuredClone(data.get(key) ?? null);
    },
    async setJSON(key, value, opts = {}) {
      const old = data.get(key);
      if ((opts.onlyIfNew && old) || (opts.onlyIfMatch && old?.etag !== opts.onlyIfMatch))
        return {modified: false};
      data.set(key, {data: structuredClone(value), etag: String(++seq)});
      return {modified: true};
    },
  };
}
