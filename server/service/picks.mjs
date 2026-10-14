import {AppError} from '../errors.mjs';
import {hash, HOUR} from '../util.mjs';
import {isOpen, settle, sameMatch, matchKey} from '../model.mjs';

const MAX_PICKS = 500;
const FORECAST_MAX_AGE = 2 * HOUR;
const SETTLE_DELAY = 105 * 60_000;
const SETTLE_BATCH = 3;

export function createPicks({now, storage, lookup}) {
  const {read, atomic} = storage;
  const {fresh} = lookup;

  async function picks(sid) {
    return (await read('picks/' + sid))?.items ?? [];
  }

  async function save(sid, id, outcome) {
    if (!/^[a-f0-9]{64}$/.test(id) || ![0, 1, 2].includes(outcome))
      throw new AppError(400, 'pick', 'Invalid pick.');
    const f = await read('forecast/' + id);
    if (!f || !isOpen(f, now()) || now() - f.forecastAt > FORECAST_MAX_AGE)
      throw new AppError(
        409,
        'expired',
        'Refresh this forecast; it is expired or kickoff has passed.',
      );
    const current = await fresh(f);
    if (!isOpen(current.f, now()) || !sameMatch(f, current.f))
      throw new AppError(409, 'closed', 'This match changed or is no longer open.');

    const canonical = matchKey(f);
    let added = false;
    await atomic('picks/' + sid, (old) => {
      const items = old?.items ?? [];
      if (!isOpen(f, now())) throw new AppError(409, 'closed', 'Kickoff has passed.');
      if (items.some((x) => x.canonical === canonical)) {
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
      const pick = {
        id: hash(canonical),
        canonical,
        outcome,
        createdAt: now(),
        forecast: f,
        result: null,
        score: null,
      };
      return {items: [pick, ...items]};
    });
    return {saved: added};
  }

  async function settlePicks(sid) {
    const history = await picks(sid);
    const eligible = history
      .filter((p) => !p.result && Date.parse(p.forecast.kickoff) + SETTLE_DELAY < now())
      .slice(0, SETTLE_BATCH);
    const changes = new Map();
    let unavailable = 0;
    for (const p of eligible) {
      try {
        const current = await fresh(p.forecast);
        const result = settle(current.raw, p.outcome);
        if (result) changes.set(p.id, {...result, settledAt: now()});
      } catch {
        unavailable++;
      }
    }
    if (changes.size)
      await atomic('picks/' + sid, (old) => ({
        items: (old?.items ?? []).map((p) =>
          changes.has(p.id) && !p.result ? {...p, ...changes.get(p.id)} : p,
        ),
      }));
    return {checked: eligible.length, settled: changes.size, unavailable};
  }

  return {picks, save, settlePicks};
}
