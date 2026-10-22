import {parseOdds, slipSummary} from '/value.js';
import {pickLabel, pickProbability} from '/pickstats.js';
import {$, esc} from '../dom.js';
import {state} from '../state.js';

const selected = new Set(); // pick ids in the slip (this page load only)
let combinedOddsText = '';

const pending = () =>
  state.picks.filter((p) => !p.result && Date.parse(p.forecast.kickoff) > Date.now());

export const inSlip = (pick) => selected.has(pick.id);

/** The slip's markup for the chosen picks and an optional bookmaker's combined price. */
export function slipHtml(picks, oddsText = '') {
  if (!picks.length) return '';
  const legs = picks.map((p) => ({
    label: `${p.forecast.home} v ${p.forecast.away}: ${pickLabel(p)}`,
    p: pickProbability(p),
  }));
  const combined = parseOdds(oddsText);
  const s = slipSummary(
    legs.map((l) => l.p),
    combined,
  );
  const rows = legs
    .map(
      (l) =>
        `<li>${esc(l.label)} <span class="muted">${Number.isFinite(l.p) ? l.p + '%' : 'no estimate'}</span></li>`,
    )
    .join('');
  const summary = s.probability
    ? `<div class="stat-tiles slip-tiles"><div class="stat-tile"><span class="stat-label">All ${s.legs} legs win</span><strong>${s.probabilityPercent}%</strong><span class="stat-sub">about 1 in ${s.oneIn}</span></div><div class="stat-tile"><span class="stat-label">Fair combined odds</span><strong>${s.fairOdds.toFixed(2)}</strong><span class="stat-sub">1 ÷ combined chance, no margin</span></div>${
        s.combinedOdds
          ? `<div class="stat-tile"><span class="stat-label">Bookmaker’s price ${s.combinedOdds.toFixed(2)}</span><strong class="${s.value ? 'value-yes' : 'value-no'}">${s.expectedValuePercent > 0 ? '+' : ''}${s.expectedValuePercent}%</strong><span class="stat-sub">expected return per unit (implies ${s.impliedProbabilityPercent}%)</span></div>`
          : ''
      }</div>`
    : '<p class="muted">None of the chosen picks has a usable chance.</p>';
  const skipped = s.skipped
    ? `<p class="muted">${s.skipped} pick${s.skipped === 1 ? ' has' : 's have'} no estimate and ${s.skipped === 1 ? 'is' : 'are'} left out.</p>`
    : '';
  return `<h3>Slip calculator</h3><ul class="slip-legs">${rows}</ul>${summary}${skipped}<label class="slip-odds">Bookmaker’s combined price (the product of the leg prices)<input id="slip-odds" inputmode="decimal" placeholder="e.g. 80.35" value="${esc(oddsText)}" autocomplete="off" /></label><p class="muted">Legs are treated as independent, which flatters a slip whose legs are related (two picks on one match, or on the same team’s matches). Every extra leg multiplies the chance of losing the lot; the fair odds show what the chain is worth before any margin. Virtual picks only.</p>`;
}

export function renderSlip() {
  const box = $('#slip');
  if (!box) return;
  for (const id of selected) if (!pending().some((p) => p.id === id)) selected.delete(id);
  const picks = pending().filter(inSlip);
  box.classList.toggle('hidden', !picks.length);
  box.innerHTML = slipHtml(picks, combinedOddsText);
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
    if (e.target.id !== 'slip-odds') return;
    combinedOddsText = e.target.value;
    const picks = pending().filter(inSlip);
    // Re-render only the tiles so typing keeps focus.
    const fresh = document.createElement('div');
    fresh.innerHTML = slipHtml(picks, combinedOddsText);
    const oldTiles = $('#slip .slip-tiles');
    const newTiles = fresh.querySelector('.slip-tiles');
    if (oldTiles && newTiles) oldTiles.replaceWith(newTiles);
  });
}
