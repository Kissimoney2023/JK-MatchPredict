import {combinedPrice, parseOdds, slipSummary} from '/value.js';
import {pickLabel, pickProbability} from '/pickstats.js';
import {tierOf} from '/analysis.js';
import {$, esc} from '../dom.js';
import {state} from '../state.js';

const selected = new Set(); // pick ids in the slip (this page load only)
let combinedOddsText = '';
const legOddsText = {}; // pick id -> the price typed for that leg
let boostText = '';

const LONG_SHOT = 0.1; // below this chance the slip is called what it is

const pending = () =>
  state.picks.filter((p) => !p.result && Date.parse(p.forecast.kickoff) > Date.now());

export const inSlip = (pick) => selected.has(pick.id);

/**
 * The slip's markup for the chosen picks. Prices can be typed per leg (the combination's price
 * is then their product, plus any boost on the winnings) or as one combined price.
 */
export function slipHtml(picks, oddsText = '', {legOdds = {}, boost = ''} = {}) {
  if (!picks.length) return '';
  const legs = picks.map((p) => ({
    id: p.id,
    label: `${p.forecast.home} v ${p.forecast.away}: ${pickLabel(p)}`,
    p: pickProbability(p),
    odds: legOdds[p.id] ?? '',
  }));
  const fromLegs = combinedPrice(
    legs.map((l) => l.odds),
    boost,
  );
  const combined = fromLegs ?? parseOdds(oddsText);
  const s = slipSummary(
    legs.map((l) => l.p),
    combined,
  );
  const rows = legs
    .map((l) => {
      const tier = Number.isFinite(l.p) ? tierOf(l.p) : null;
      const badge = tier ? `<span class="likely-tier">${esc(tier)}</span>` : '';
      return `<li class="slip-leg ${tier ? 'tier-' + tier.replace(/\s/g, '-') : ''}">${badge}<span class="slip-leg-what">${esc(l.label)} <span class="muted">${Number.isFinite(l.p) ? l.p + '%' : 'no estimate'}</span></span><input data-leg-odds="${esc(l.id)}" inputmode="decimal" placeholder="price" aria-label="Price for ${esc(l.label)}" value="${esc(l.odds)}" autocomplete="off" /></li>`;
    })
    .join('');
  const priceTile = s.combinedOdds
    ? `<div class="stat-tile"><span class="stat-label">Combined price ${s.combinedOdds.toFixed(2)}</span><strong class="${s.value ? 'value-yes' : 'value-no'}">${s.expectedValuePercent > 0 ? '+' : ''}${s.expectedValuePercent}%</strong><span class="stat-sub">expected return per unit (implies ${s.impliedProbabilityPercent}%)${fromLegs ? '; the leg prices multiplied' + (Number(boost) > 0 ? `, +${esc(String(boost))}% boost on the winnings` : '') : ''}</span></div>`
    : '';
  const summary = s.probability
    ? `<div class="stat-tiles slip-tiles"><div class="stat-tile"><span class="stat-label">All ${s.legs} legs win</span><strong>${s.probabilityPercent}%</strong><span class="stat-sub">about 1 in ${s.oneIn}</span></div><div class="stat-tile"><span class="stat-label">Fair combined odds</span><strong>${s.fairOdds.toFixed(2)}</strong><span class="stat-sub">1 ÷ combined chance, no margin</span></div>${priceTile}</div>${
        s.probability < LONG_SHOT
          ? `<p class="slip-warning">A long shot: fewer than one slip in ${s.oneIn >= 100 ? 'a hundred' : 'ten'} like this wins. Dropping the toss-up legs raises the chance more than it lowers the price.</p>`
          : ''
      }`
    : '<p class="muted">None of the chosen picks has a usable chance.</p>';
  const skipped = s.skipped
    ? `<p class="muted">${s.skipped} pick${s.skipped === 1 ? ' has' : 's have'} no estimate and ${s.skipped === 1 ? 'is' : 'are'} left out.</p>`
    : '';
  return `<h3>Slip calculator</h3><ul class="slip-legs">${rows}</ul>${summary}${skipped}<div class="slip-prices"><label class="slip-odds">Boost on the winnings, % (a CombiBoost)<input id="slip-boost" inputmode="decimal" placeholder="e.g. 5" value="${esc(boost)}" autocomplete="off" /></label><label class="slip-odds">Or the combined price as printed<input id="slip-odds" inputmode="decimal" placeholder="e.g. 80.35" value="${esc(oddsText)}" autocomplete="off" /></label></div><p class="muted">Type each leg’s price from the slip to get the combination’s price, or the printed combined price. Legs are treated as independent, which flatters a slip whose legs are related (two picks on one match, or on the same team’s matches). Every extra leg multiplies the chance of losing the lot; the fair odds show what the chain is worth before any margin. Virtual picks only.</p>`;
}

export function renderSlip() {
  const box = $('#slip');
  if (!box) return;
  for (const id of selected) if (!pending().some((p) => p.id === id)) selected.delete(id);
  const picks = pending().filter(inSlip);
  box.classList.toggle('hidden', !picks.length);
  box.innerHTML = slipHtml(picks, combinedOddsText, {legOdds: legOddsText, boost: boostText});
}

/** A checkbox for a pending pick's card. */
export const slipToggleHtml = (pick) =>
  `<label class="slip-toggle"><input type="checkbox" data-slip="${esc(pick.id)}" ${inSlip(pick) ? 'checked' : ''} /> Add to slip</label>`;

export function initSlip() {
  $('#picks').addEventListener('change', (e) => {
    const box = e.target.closest('[data-slip]');
    if (!box) return;
    if (box.checked) selected.add(box.dataset.slip);
    else selected.delete(box.dataset.slip);
    renderSlip();
  });
  $('#slip').addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'slip-odds') combinedOddsText = t.value;
    else if (t.id === 'slip-boost') boostText = t.value;
    else if (t.dataset.legOdds) legOddsText[t.dataset.legOdds] = t.value;
    else return;
    const picks = pending().filter(inSlip);
    // Re-render only the tiles and the warning so typing keeps focus.
    const fresh = document.createElement('div');
    fresh.innerHTML = slipHtml(picks, combinedOddsText, {legOdds: legOddsText, boost: boostText});
    const oldTiles = $('#slip .slip-tiles');
    const newTiles = fresh.querySelector('.slip-tiles');
    if (oldTiles && newTiles) oldTiles.replaceWith(newTiles);
    $('#slip .slip-warning')?.remove();
    const warning = fresh.querySelector('.slip-warning');
    if (warning) $('#slip .slip-tiles')?.after(warning);
  });
}
