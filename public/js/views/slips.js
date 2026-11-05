import {pickLabel, pickPrice, pickProbability, slipsSummary} from '/pickstats.js';
import {shapeLines, shapeReturn, ticketOptions} from '/ticket.js';
import {$, esc} from '../dom.js';

const STATUS = {won: 'Won', lost: 'Lost', pending: 'Open', void: 'Void'};
const SHAPES_KEY = 'jk-slip-shapes'; // slip label -> {shape, stake}, this browser only
const DEFAULT_STAKE = 5;

function loadShapes() {
  try {
    const v = JSON.parse(localStorage.getItem(SHAPES_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
function saveShapes(shapes) {
  try {
    localStorage.setItem(SHAPES_KEY, JSON.stringify(shapes));
  } catch {
    // storage blocked: the choice lives in the page only
  }
}

const money = (x) => (x > 0 ? '+' : '') + x.toFixed(2);

const legHtml = (p) => {
  const f = p.forecast ?? {};
  const chance = pickProbability(p);
  const price = pickPrice(p);
  const mark =
    p.result === 'correct'
      ? '<i class="chip w" role="img" aria-label="won">✓</i>'
      : p.result === 'incorrect'
        ? '<i class="chip l" role="img" aria-label="lost">✗</i>'
        : p.result === 'void'
          ? '<span class="tag">void</span>'
          : '<span class="tag">open</span>';
  return `<li class="slip-card-leg">${mark}<span class="slip-card-what">${esc(f.home)} v ${esc(f.away)}: <strong>${esc(pickLabel(p))}</strong><small class="muted">${Number.isFinite(chance) ? chance + '%' : 'no estimate'}${price ? ' · at ' + price.toFixed(2) : ''}${p.score ? ' · ' + esc(p.score) : ''}</small></span></li>`;
};

/** The slip's legs in chance order, as the ticket module wants them, results included. */
const ticketLegs = (slip) =>
  [...slip.legs]
    .filter((p) => Number.isFinite(pickProbability(p)))
    .sort((a, b) => pickProbability(b) - pickProbability(a))
    .map((p) => ({
      label: pickLabel(p),
      p: pickProbability(p),
      odds: pickPrice(p),
      result: p.result ?? null,
    }));

/** The "bought as" controls and, once settled, the money, for one slip. */
function boughtHtml(slip, chosen) {
  const legs = ticketLegs(slip);
  if (!legs.length) return '';
  const stake = Number(chosen?.stake) > 0 ? Number(chosen.stake) : DEFAULT_STAKE;
  const options = ticketOptions(legs, {stake}) ?? [];
  const select = `<label>Bought as<select data-slip-shape="${esc(slip.label)}"><option value="">— choose —</option>${options
    .map(
      (o) =>
        `<option value="${esc(o.id)}" ${chosen?.shape === o.id ? 'selected' : ''}>${esc(o.title)}${o.recommended ? ' (recommended)' : ''}</option>`,
    )
    .join(
      '',
    )}</select></label><label>Stake<input data-slip-stake="${esc(slip.label)}" inputmode="decimal" value="${esc(chosen?.stake ? String(chosen.stake) : '')}" placeholder="${DEFAULT_STAKE}" autocomplete="off" /></label>`;
  let result = '';
  const bought = chosen?.shape ? shapeLines(chosen.shape, legs) : null;
  if (bought) {
    const r = shapeReturn(legs, bought, {stake});
    const title = options.find((o) => o.id === chosen.shape)?.title ?? chosen.shape;
    const rec = options.find((o) => o.recommended);
    const recReturn =
      rec && rec.id !== chosen.shape ? shapeReturn(legs, shapeLines(rec.id, legs), {stake}) : null;
    result = `<p class="slip-money">${esc(title)}: stake ${stake.toFixed(2)}${
      r.pending
        ? ` · ${r.linesWon ? `returned ${r.returned.toFixed(2)} so far, ` : ''}still open`
        : ` → returned ${r.returned.toFixed(2)} (${money(r.profit)})`
    }${r.fairPriced ? ' <small class="muted">some legs at fair odds</small>' : ''}</p>${
      recReturn && !recReturn.pending
        ? `<p class="muted">Recommended shape (${esc(rec.title)}) would have returned ${recReturn.returned.toFixed(2)} (${money(recReturn.profit)}).</p>`
        : ''
    }`;
  }
  return `<div class="slip-bought">${select}</div>${result}`;
}

/** Staked, returned and net over the settled slips with a shape, and had the recommendation been bought each time. */
function moneySummary(slips, shapes) {
  const t = {staked: 0, returned: 0, recommended: 0, n: 0};
  for (const slip of slips) {
    const chosen = shapes[slip.label];
    if (!chosen?.shape) continue;
    const legs = ticketLegs(slip);
    const lines = shapeLines(chosen.shape, legs);
    if (!lines) continue;
    const stake = Number(chosen.stake) > 0 ? Number(chosen.stake) : DEFAULT_STAKE;
    const r = shapeReturn(legs, lines, {stake});
    if (!r || r.pending) continue;
    const rec = (ticketOptions(legs, {stake}) ?? []).find((o) => o.recommended);
    const rr = rec ? shapeReturn(legs, shapeLines(rec.id, legs), {stake}) : null;
    t.n++;
    t.staked += stake;
    t.returned += r.returned;
    t.recommended += rr && !rr.pending ? rr.returned : r.returned;
  }
  if (!t.n) return '';
  return ` Money on ${t.n} settled slip${t.n === 1 ? '' : 's'}: staked ${t.staked.toFixed(2)}, returned ${t.returned.toFixed(2)} (${money(t.returned - t.staked)}); the recommended shape every time would have returned ${t.recommended.toFixed(2)} (${money(t.recommended - t.staked)}).`;
}

/** The picks placed together, slip by slip, with how each one went and what it returned. */
export function slipsBlock(picks, {shapes = loadShapes()} = {}) {
  const s = slipsSummary(picks);
  if (!s.slips.length) return '';
  const cards = s.slips
    .map(
      (slip) =>
        `<article class="slip-card slip-${slip.status}"><div class="match-top"><strong>${esc(slip.label)}</strong><span class="tag">${STATUS[slip.status]}</span></div><ul class="slip-card-legs">${slip.legs.map(legHtml).join('')}</ul><p class="muted">${slip.n} leg${slip.n === 1 ? '' : 's'}${slip.price ? ` · price ${slip.price.toFixed(2)}` : ''}${slip.probability ? ` · chance at placement ${slip.probability}% (fair ${slip.fairOdds.toFixed(2)})` : ''}${slip.status === 'lost' ? ` · lost on ${slip.lostLegs.map((p) => esc(pickLabel(p))).join(', ')}` : ''}</p>${boughtHtml(slip, shapes[slip.label])}</article>`,
    )
    .join('');
  return `<h3>Slips</h3><p class="muted">${s.won} won · ${s.lost} lost · ${s.pending} open · legs ${s.legsCorrect} of ${s.legsSettled} settled legs won.${esc(moneySummary(s.slips, shapes))}</p><div class="slip-cards">${cards}</div>`;
}

let wired = false;

export function renderSlips(picks) {
  const box = $('#slips');
  if (!box) return;
  box.innerHTML = slipsBlock(picks);
  box.classList.toggle('hidden', !box.innerHTML);
  if (wired) return;
  wired = true;
  const update = (label, patch) => {
    const shapes = loadShapes();
    shapes[label] = {...(shapes[label] ?? {}), ...patch};
    saveShapes(shapes);
    box.innerHTML = slipsBlock(picks, {shapes});
  };
  box.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.slipShape !== undefined) update(t.dataset.slipShape, {shape: t.value});
    else if (t.dataset.slipStake !== undefined)
      update(t.dataset.slipStake, {stake: Number(String(t.value).replace(',', '.')) || 0});
  });
}

/** Exposed for the tests only. */
export const slipsBlockForTest = slipsBlock;
