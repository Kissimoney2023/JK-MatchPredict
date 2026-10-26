import {bettingMarkets, comboProbability} from '/scores.js';
import {expectedValue, parseOdds} from '/value.js';
import {$, esc} from '../dom.js';

// Groups whose selections can go into a same-match combination (full-time markets only).
const COMBINABLE = new Set([
  'result',
  'doubleChance',
  'btts',
  'totals',
  'handicap',
  'correctScore',
]);
const MAX_LEGS = 4;

const cellHtml = (c, combinable) => {
  const body = `<span class="book-label">${esc(c.label)}</span><strong>${c.p}%</strong><small>at least ${c.fair?.toFixed(2) ?? '—'}</small>`;
  return combinable
    ? `<button type="button" class="book-cell" data-combo-add="${esc(c.id)}" aria-pressed="false">${body}</button>`
    : `<span class="book-cell">${body}</span>`;
};

const groupHtml = (g) => {
  const combinable = COMBINABLE.has(g.id);
  // The correct scores are many cells of one book: a wrapping grid, not a table row.
  if (g.id === 'correctScore')
    return `<section class="book book-scores"><h4>${esc(g.title)}</h4><div class="book-grid">${g.rows[0].cells.map((c) => cellHtml(c, combinable)).join('')}</div></section>`;
  const labelled = g.rows.some((r) => r.label);
  const rows = g.rows
    .map(
      (r) =>
        `<tr>${labelled ? `<th scope="row">${esc(r.label)}</th>` : ''}${r.cells.map((c) => `<td>${cellHtml(c, combinable)}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<section class="book"><h4>${esc(g.title)}</h4><table class="book-table"><tbody>${rows}</tbody></table></section>`;
};

/** The markets as a betting slip lists them, each with the chance and the price to insist on. */
export function marketsBlock(f) {
  const groups = bettingMarkets(f);
  if (!groups.length) return '';
  return `<h3>Betting slip view</h3><p class="muted">The markets as a Swiss betting slip lists them, in its order and wording. Each cell shows this forecast’s chance and the price to insist on: a price on the slip <em>at least</em> that high is worth more than it costs by this forecast; a lower one is not. First-half markets assume ${Math.round(45)}% of the goals come before the break. Fair prices carry no margin; nothing here is a recommendation to bet.</p><div class="books">${groups.map(groupHtml).join('')}</div><div class="combo" id="combo"><h4>Same-match combination (BetBuilder)</h4><div id="combo-body"><p class="muted">Tap up to ${MAX_LEGS} selections above (full-time markets) to price them together. The chance comes from the scorelines where every leg holds, which is not the product of the legs: a draw and both teams scoring go together more often than multiplying says.</p></div></div>`;
}

let current = null; // {f, legs: Set, priceText}

function comboHtml() {
  const {f, legs, priceText} = current;
  const ids = [...legs];
  if (!ids.length)
    return `<p class="muted">Tap up to ${MAX_LEGS} selections above (full-time markets) to price them together. The chance comes from the scorelines where every leg holds, which is not the product of the legs: a draw and both teams scoring go together more often than multiplying says.</p>`;
  const cells = new Map(
    bettingMarkets(f)
      .flatMap((g) => g.rows.flatMap((r) => r.cells.map((c) => [c.id, {...c, group: g.title}])))
      .map(([id, c]) => [id, c]),
  );
  const items = ids
    .map((id) => cells.get(id))
    .filter(Boolean)
    .map(
      (c) =>
        `<li>${esc(c.group)} · <strong>${esc(c.label)}</strong> ${c.p}% <button type="button" class="text-button" data-combo-remove="${esc(c.id)}">Remove</button></li>`,
    )
    .join('');
  const joint = comboProbability(ids, f);
  const naive = ids.reduce((acc, id) => acc * ((cells.get(id)?.p ?? 0) / 100), 1) * 100;
  if (joint === null)
    return `<ul class="combo-legs">${items}</ul><p class="muted">These legs cannot be priced together.</p>`;
  const fair = joint > 0 ? (100 / joint).toFixed(2) : '—';
  const price = parseOdds(priceText);
  const ev = price && joint > 0 ? expectedValue(joint / 100, price) : null;
  const verdict =
    ev === null
      ? ''
      : `<p><strong class="${ev > 0 ? 'value-yes' : 'value-no'}">${ev > 0 ? 'Worth it by this forecast' : 'Not worth it'}: ${ev > 0 ? '+' : ''}${(ev * 100).toFixed(1)}% expected return per unit at ${price.toFixed(2)}.</strong></p>`;
  return `<ul class="combo-legs">${items}</ul><div class="stat-tiles slip-tiles"><div class="stat-tile"><span class="stat-label">All ${ids.length} legs hold</span><strong>${joint}%</strong><span class="stat-sub">from the scorelines; multiplying would say ${Math.round(naive * 10) / 10}%</span></div><div class="stat-tile"><span class="stat-label">Insist on at least</span><strong>${fair}</strong><span class="stat-sub">fair price, no margin</span></div></div><label class="slip-odds">The slip’s BetBuilder price<input id="combo-price" inputmode="decimal" placeholder="e.g. 5.20" value="${esc(priceText)}" autocomplete="off" /></label>${verdict}`;
}

function renderCombo() {
  const body = $('#combo-body');
  if (!body || !current) return;
  body.innerHTML = comboHtml();
  for (const b of document.querySelectorAll('[data-combo-add]'))
    b.setAttribute('aria-pressed', String(current.legs.has(b.dataset.comboAdd)));
}

let wired = false;

/** Wires the selections and the combination inside the analysis dialog. Call after every render. */
export function initMarkets(f) {
  current = {f, legs: new Set(), priceText: ''};
  if (wired) return;
  wired = true;
  const dialog = $('#analysis');
  dialog.addEventListener('click', (e) => {
    const add = e.target.closest('[data-combo-add]');
    const remove = e.target.closest('[data-combo-remove]');
    if (!add && !remove) return;
    if (!current) return;
    if (remove) current.legs.delete(remove.dataset.comboRemove);
    else if (current.legs.has(add.dataset.comboAdd)) current.legs.delete(add.dataset.comboAdd);
    else if (current.legs.size < MAX_LEGS) current.legs.add(add.dataset.comboAdd);
    renderCombo();
  });
  dialog.addEventListener('input', (e) => {
    if (e.target.id !== 'combo-price' || !current) return;
    current.priceText = e.target.value;
    // Keep focus: swap the tiles and the verdict only.
    const fresh = document.createElement('div');
    fresh.innerHTML = comboHtml();
    const body = $('#combo-body');
    body.querySelector('.slip-tiles')?.replaceWith(fresh.querySelector('.slip-tiles'));
    body.querySelector('p:last-child strong')?.closest('p')?.remove();
    const verdict = fresh.querySelector('p:last-child strong')?.closest('p');
    if (verdict) body.append(verdict);
  });
}

/** Exposed for the tests only. */
export const marketsBlockForTest = marketsBlock;
