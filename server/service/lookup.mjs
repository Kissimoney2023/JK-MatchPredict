import {AppError} from '../errors.mjs';
import {iso, DAY, MINUTE} from '../util.mjs';
import {fdSettlementRaw, sameMatch} from '../model.mjs';
import {normAP, normFD} from './normalize.mjs';

/** Single-match lookups, including cross-provider verification of the same fixture. */
export function createLookup({env, provider}) {
  /** Fetches a match by its `ap:<id>` / `fd:<id>` key from its own provider. */
  async function direct(key) {
    if (!/^(ap|fd):[1-9]\d{0,11}$/.test(key))
      throw new AppError(400, 'fixture', 'Invalid match ID.');
    const [kind, id] = key.split(':');
    const r = await provider(kind, kind === 'ap' ? `fixtures?id=${id}` : `matches/${id}`, MINUTE);
    const raw = kind === 'ap' ? r.body.response?.[0] : r.body;
    const f = kind === 'ap' ? normAP(raw) : normFD(raw);
    if (!f || f.key !== key) throw new AppError(404, 'fixture', 'Match data is unavailable.');
    return {f, raw: kind === 'fd' ? fdSettlementRaw(raw) : raw};
  }

  /** Finds the same match on football-data.org; fails unless exactly one verified match exists. */
  async function mappedFD(f) {
    if (f.provider === 'fd') return direct(f.key);
    if (!f.fdCode)
      throw new AppError(
        503,
        'mapping',
        'No verified fallback league mapping exists for this match.',
      );
    const t = Date.parse(f.kickoff);
    const r = await provider(
      'fd',
      `competitions/${f.fdCode}/matches?dateFrom=${iso(t - DAY)}&dateTo=${iso(t + DAY)}`,
      300_000,
    );
    const matches = (r.body.matches ?? [])
      .map(normFD)
      .filter((g) => g && g.canonicalLeague === f.canonicalLeague && sameMatch(g, f));
    if (matches.length !== 1)
      throw new AppError(
        503,
        'mapping',
        'The same match could not be uniquely verified on the fallback.',
      );
    return direct(matches[0].key);
  }

  /** Latest state of a match, using the fallback provider if the primary lookup fails. */
  async function fresh(f) {
    try {
      return await direct(f.key);
    } catch (e) {
      if (f.provider === 'ap' && env.FOOTBALL_DATA_ORG_KEY) return mappedFD(f);
      throw e;
    }
  }

  return {direct, mappedFD, fresh};
}
