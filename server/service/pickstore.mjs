import {AppError} from '../errors.mjs';

export const MAX_PICKS = 500;

const ACCOUNT_PREFIX = 'acct:';
const isAccount = (sid) => String(sid).startsWith(ACCOUNT_PREFIX);
const userIdOf = (sid) => String(sid).slice(ACCOUNT_PREFIX.length);

const fromRow = (r) => ({
  id: r.pick_id,
  canonical: r.canonical,
  ...(r.market === 'totals' ? {market: 'totals', line: Number(r.line)} : {}),
  ...(r.market === 'selection'
    ? {market: 'selection', selection: r.selection, probability: Number(r.probability)}
    : {}),
  ...(r.price !== null && r.price !== undefined ? {price: Number(r.price)} : {}),
  ...(r.slip ? {slip: r.slip} : {}),
  outcome: r.outcome,
  createdAt: Date.parse(r.created_at),
  forecast: r.forecast,
  result: r.result ?? null,
  score: r.score ?? null,
  ...(r.settled_at ? {settledAt: Date.parse(r.settled_at)} : {}),
});

// The newer columns are only sent when a pick uses them, so a database created before they
// existed keeps accepting plain home/draw/away picks.
const toRow = (userId, p) => ({
  user_id: userId,
  pick_id: p.id,
  canonical: p.canonical,
  ...(p.market === 'totals' ? {market: 'totals', line: p.line} : {}),
  ...(p.market === 'selection'
    ? {market: 'selection', selection: p.selection, probability: p.probability}
    : {}),
  ...(p.price ? {price: p.price} : {}),
  ...(p.slip ? {slip: p.slip} : {}),
  outcome: p.outcome,
  created_at: new Date(p.createdAt).toISOString(),
  forecast: p.forecast,
  result: p.result ?? null,
  score: p.score ?? null,
});

/**
 * Where picks live. Anonymous browser profiles keep a JSON list in the key-value store;
 * signed-in accounts (`sid` = "acct:<user id>") keep one row per pick in Supabase.
 * Both expose the same operations, so the picks logic does not care which it is using.
 */
export function createPickStore({storage, supabase}) {
  const {read, atomic} = storage;

  function database() {
    if (!supabase) throw new AppError(503, 'accounts_disabled', 'Accounts are not configured.');
    return supabase;
  }

  /** All picks, newest first. */
  async function list(sid) {
    if (!isAccount(sid)) return (await read('picks/' + sid))?.items ?? [];
    const rows = await database().select('picks', {
      user_id: 'eq.' + userIdOf(sid),
      order: 'created_at.desc',
      limit: String(MAX_PICKS),
    });
    return rows.map(fromRow);
  }

  /** Stores a pick unless the match is already picked. Returns true if it was added. */
  async function add(sid, pick) {
    if (isAccount(sid)) {
      const db = database();
      const userId = userIdOf(sid);
      const existing = await db.select('picks', {
        user_id: 'eq.' + userId,
        select: 'pick_id',
        limit: String(MAX_PICKS),
      });
      if (existing.length >= MAX_PICKS)
        throw new AppError(
          409,
          'limit',
          'Your account has reached its 500-pick limit. Export your history.',
        );
      let inserted;
      try {
        inserted = await db.insert('picks', [toRow(userId, pick)], {
          onConflict: 'user_id,canonical',
          ignoreDuplicates: true,
        });
      } catch (e) {
        // A pick using newer columns on a database that predates them: say what to run.
        const newer = pick.market !== 'result' || pick.price || pick.slip;
        if (newer && /column|PGRST204/i.test(String(e?.detail ?? '')))
          throw new AppError(
            503,
            'schema',
            'This kind of pick needs a small database update: run supabase/schema.sql again in Supabase (it is safe to re-run).',
          );
        throw e;
      }
      return inserted.length > 0;
    }

    let added = false;
    await atomic('picks/' + sid, (old) => {
      const items = old?.items ?? [];
      if (items.some((x) => x.canonical === pick.canonical)) {
        added = false;
        return undefined;
      }
      if (items.length >= MAX_PICKS)
        throw new AppError(
          409,
          'limit',
          'This browser profile has reached its 500-pick limit. Export your history.',
        );
      added = true;
      return {items: [pick, ...items]};
    });
    return added;
  }

  /** Records results for pending picks. `changes` maps pick id -> {result, score, settledAt}. */
  async function applyResults(sid, changes) {
    if (!changes.size) return;
    if (isAccount(sid)) {
      const db = database();
      for (const [id, c] of changes)
        await db.update(
          'picks',
          {user_id: 'eq.' + userIdOf(sid), pick_id: 'eq.' + id, result: 'is.null'},
          {result: c.result, score: c.score, settled_at: new Date(c.settledAt).toISOString()},
        );
      return;
    }
    await atomic('picks/' + sid, (old) => ({
      items: (old?.items ?? []).map((p) =>
        changes.has(p.id) && !p.result ? {...p, ...changes.get(p.id)} : p,
      ),
    }));
  }

  /**
   * Copies an anonymous browser profile's picks into an account, skipping matches the account
   * already has. Safe to repeat. Returns how many were added.
   */
  async function mergeInto(accountSid, anonymousSid) {
    if (!isAccount(accountSid))
      throw new AppError(500, 'internal', 'Picks can only merge into an account.');
    const source = await list(anonymousSid);
    if (!source.length) return 0;
    const userId = userIdOf(accountSid);
    const room = Math.max(
      0,
      MAX_PICKS -
        (
          await database().select('picks', {
            user_id: 'eq.' + userId,
            select: 'pick_id',
            limit: String(MAX_PICKS),
          })
        ).length,
    );
    if (!room) return 0;
    const inserted = await database().insert(
      'picks',
      source.slice(0, room).map((p) => toRow(userId, p)),
      {onConflict: 'user_id,canonical', ignoreDuplicates: true},
    );
    return inserted.length;
  }

  /**
   * Removes a pick that has no result yet. Settled picks are never removed here (the caller
   * checks kickoff). Returns true if a pick was removed.
   */
  async function remove(sid, pickId) {
    if (isAccount(sid)) {
      const deleted = await database().delete('picks', {
        user_id: 'eq.' + userIdOf(sid),
        pick_id: 'eq.' + pickId,
        result: 'is.null',
      });
      return deleted.length > 0;
    }
    let removed = false;
    await atomic('picks/' + sid, (old) => {
      const items = old?.items ?? [];
      const target = items.find((p) => p.id === pickId && !p.result);
      if (!target) return undefined;
      removed = true;
      return {items: items.filter((p) => p !== target)};
    });
    return removed;
  }

  return {list, add, applyResults, remove, mergeInto};
}
