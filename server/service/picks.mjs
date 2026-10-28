import {AppError} from '../errors.mjs';
import {hash, HOUR} from '../util.mjs';
import {isOpen, settleSelection, sameMatch, matchKey, GOAL_LINES} from '../model.mjs';
import {bettingMarkets, isPickableSelection} from '../scores.mjs';
import {parseOdds} from '../value.mjs';

const SLIP_LABEL_MAX = 40;

const FORECAST_MAX_AGE = 2 * HOUR;
const SETTLE_DELAY = 105 * 60_000;
const SETTLE_BATCH = 3;

/** Virtual picks: save, list and settle. `pickStore` hides where they are kept. */
export function createPicks({now, storage, lookup, pickStore, clv}) {
  const {read} = storage;
  const {fresh} = lookup;

  /** All picks, with closing line value attached where both consensus snapshots exist. */
  const picks = async (sid) => {
    const list = await pickStore.list(sid);
    return clv ? clv.decorate(list) : list;
  };

  /**
   * Saves a virtual pick on a forecast. `market` 'result' (outcome 0/1/2 = home, draw, away),
   * 'totals' (outcome 0 = over `line` goals, 1 = under) or 'selection' (`extra.selection` is
   * a betting-slip cell id; the forecast's chance for it is recorded with the pick). Any pick
   * may carry the price it was placed at and the label of the slip it belongs to. One pick
   * per match per market (per selection for selections).
   */
  async function save(sid, id, outcome, market = 'result', line, extra = {}) {
    const totals = market === 'totals';
    const selection = market === 'selection';
    if (!totals && !selection && market !== 'result')
      throw new AppError(400, 'pick', 'Unknown market.');
    const lineValue = totals ? Number(line) : undefined;
    const selectionId = selection ? String(extra?.selection ?? '') : undefined;
    if (selection && !isPickableSelection(selectionId))
      throw new AppError(
        400,
        'pick',
        'That selection cannot be settled from a score, so it cannot be picked.',
      );
    const outcomeValue = selection ? 0 : outcome;
    if (
      !/^[a-f0-9]{64}$/.test(id) ||
      ![0, 1, 2].includes(outcomeValue) ||
      (totals && (outcome > 1 || !GOAL_LINES.includes(lineValue)))
    )
      throw new AppError(400, 'pick', 'Invalid pick.');
    const priceText = String(extra?.price ?? '').trim();
    const price = priceText ? parseOdds(priceText) : null;
    if (priceText && !price)
      throw new AppError(400, 'price', 'That price could not be read; use decimal odds like 1.85.');
    const slip = String(extra?.slip ?? '')
      .trim()
      .slice(0, SLIP_LABEL_MAX);
    const f = await read('forecast/' + id);
    if (totals && !f?.goals?.lines?.some((l) => Number(l.line) === lineValue))
      throw new AppError(
        409,
        'no_goals',
        'This forecast has no Over/Under estimate for that line.',
      );
    const cell = selection
      ? bettingMarkets(f)
          .flatMap((g) => g.rows.flatMap((r) => r.cells))
          .find((c) => c.id === selectionId)
      : null;
    if (selection && !cell)
      throw new AppError(
        409,
        'no_market',
        'This forecast does not price that selection; refresh it.',
      );
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

    const canonical =
      matchKey(f) + (totals ? `|totals:${lineValue}` : selection ? `|sel:${selectionId}` : '');
    const pick = {
      id: hash(canonical),
      canonical,
      ...(totals ? {market: 'totals', line: lineValue} : {}),
      ...(selection ? {market: 'selection', selection: selectionId, probability: cell.p} : {}),
      ...(price ? {price} : {}),
      ...(slip ? {slip} : {}),
      outcome: outcomeValue,
      createdAt: now(),
      forecast: f,
      result: null,
      score: null,
    };
    const saved = await pickStore.add(sid, pick);
    if (saved && clv) await clv.noteUpcoming(f);
    return {saved};
  }

  /**
   * Looks up results for pending picks that should be finished by now. `skip` can exclude picks
   * (the scheduled job uses it to avoid re-checking too often); `limit` caps provider lookups.
   */
  async function settleDue(sid, {limit = SETTLE_BATCH, skip = () => false} = {}) {
    const history = await picks(sid);
    const eligible = history
      .filter((p) => !p.result && Date.parse(p.forecast.kickoff) + SETTLE_DELAY < now() && !skip(p))
      .slice(0, limit);
    const changes = new Map();
    let unavailable = 0;
    for (const p of eligible) {
      try {
        const current = await fresh(p.forecast);
        const result = settleSelection(current.raw, p);
        if (result) changes.set(p.id, {...result, settledAt: now()});
      } catch {
        unavailable++;
      }
    }
    await pickStore.applyResults(sid, changes);
    return {
      checked: eligible.length,
      settled: changes.size,
      unavailable,
      attempted: eligible,
      settledPicks: eligible
        .filter((p) => changes.has(p.id))
        .map((p) => ({pick: p, ...changes.get(p.id)})),
    };
  }

  async function settlePicks(sid) {
    const {checked, settled, unavailable} = await settleDue(sid);
    return {checked, settled, unavailable};
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

  return {picks, save, settlePicks, settleDue, deletePick, mergePicks: pickStore.mergeInto};
}
