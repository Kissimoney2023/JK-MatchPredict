import {AppError} from '../errors.mjs';
import {hash} from '../util.mjs';

/** Blob-store helpers: JSON reads, optimistic-concurrency updates and fixed-window budgets. */
export function createStorage({store, now}) {
  const read = (key) => store.get(key, {type: 'json'});

  /** Applies `mutate` with compare-and-swap retries. Returning `undefined` aborts the write. */
  async function atomic(key, mutate) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const old = await store.getWithMetadata(key, {type: 'json'});
      const next = mutate(old?.data ?? null);
      if (next === undefined) return null;
      const result = await store.setJSON(
        key,
        next,
        old ? {onlyIfMatch: old.etag} : {onlyIfNew: true},
      );
      if (result.modified) return next;
    }
    throw new AppError(409, 'busy', 'Another request is updating this record. Please retry.');
  }

  /** Spends `cost` units from a fixed-window budget, or throws when it would exceed `limit`. */
  async function budget(key, limit, windowMs, cost = 1) {
    const window = Math.floor(now() / windowMs);
    await atomic('budget/' + hash(key), (old) => {
      const count = old?.window === window ? old.count : 0;
      if (count + cost > limit)
        throw new AppError(429, 'quota', 'Request budget reached. Please try later.');
      return {window, count: count + cost};
    });
  }

  return {read, atomic, budget};
}
