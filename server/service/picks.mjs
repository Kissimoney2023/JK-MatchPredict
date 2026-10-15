import {AppError} from '../errors.mjs';
import {hash, HOUR} from '../util.mjs';
import {isOpen, settle, sameMatch, matchKey} from '../model.mjs';

const FORECAST_MAX_AGE = 2 * HOUR;
const SETTLE_DELAY = 105 * 60_000;
const SETTLE_BATCH = 3;

/** Virtual picks: save, list and settle. `pickStore` hides where they are kept. */
export function createPicks({now, storage, lookup, pickStore}) {
  const {read} = storage;
  const {fresh} = lookup;

  const picks = (sid) => pickStore.list(sid);

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
    if (!isOpen(f, now())) throw new AppError(409, 'closed', 'Kickoff has passed.');

    const canonical = matchKey(f);
    const pick = {
      id: hash(canonical),
      canonical,
      outcome,
      createdAt: now(),
      forecast: f,
      result: null,
      score: null,
    };
    return {saved: await pickStore.add(sid, pick)};
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
    await pickStore.applyResults(sid, changes);
    return {checked: eligible.length, settled: changes.size, unavailable};
  }

  /**
   * Lets a person take back a pick, but only before kickoff and only while it has no result.
   * After that it is locked, so results cannot be hidden from statistics or share links.
   */
  async function deletePick(sid, pickId) {
    if (!/^[a-f0-9]{64}$/.test(pickId || '')) throw new AppError(400, 'pick', 'Invalid pick.');
    const pick = (await picks(sid)).find((p) => p.id === pickId);
    if (!pick) throw new AppError(404, 'pick', 'That pick no longer exists.');
    if (pick.result) throw new AppError(409, 'locked', 'Settled picks cannot be removed.');
    if (!(Date.parse(pick.forecast.kickoff) > now()))
      throw new AppError(409, 'locked', 'Kickoff has passed, so this pick is locked.');
    return {removed: await pickStore.remove(sid, pickId)};
  }

  return {picks, save, settlePicks, deletePick, mergePicks: pickStore.mergeInto};
}
