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
// Groups whose selections can be saved as picks (settled from the scores; not the first goal).
const PICKABLE = new Set([
  ...COMBINABLE,
  'halfFull',
  'firstHalfResult',
  'firstHalfTotals',
  'firstHalfBtts',
]);
const MAX_LEGS = 4;
const SLIP_KEY = 'jk-slip-label';

const cellHtml = (c, selectable) => {
  const body = `<span class="book-label">${esc(c.label)}</span><strong>${c.p}%</strong><small>at least ${c.fair?.toFixed(2) ?? '—'}</small>`;
  return selectable
    ? `<button type="button" class="book-cell" data-combo-add="${esc(c.id)}" aria-pressed="false">${body}</button>`
    : `<span class="book-cell">${body}</span>`;
};

const groupHtml = (g) => {
  const selectable = PICKABLE.has(g.id);
  // The correct scores are many cells of one book: a wrapping grid, not a table row.
  if (g.id === 'correctScore')
    return `<section class="book book-scores"><h4>${esc(g.title)}</h4><div class="book-grid">${g.rows[0].cells.map((c) => cellHtml(c, selectable)).join('')}</div></section>`;
  const labelled = g.rows.some((r) => r.label);
  const rows = g.rows
    .map(
      (r) =>
        `<tr>${labelled ? `<th scope="row">${esc(r.label)}</th>` : ''}${r.cells.map((c) => `<td>${cellHtml(c, selectable)}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<section class="book"><h4>${esc(g.title)}</h4><table class="book-table"><tbody>${rows}</tbody></table></section>`;
};

const EMPTY_PANEL = `<p class="muted">Tap selections above to price them and save them as picks: up to ${MAX_LEGS} full-time selections together as a same-match combination (the chance comes from the scorelines where every leg holds, not from multiplying), or any selection on its own, with the price the slip offers.</p>`;

/** The markets as a betting slip lists them, each with the chance and the price to insist on. */
export function marketsBlock(f) {
  const groups = bettingMarkets(f);
  if (!groups.length) return '';
  return `<h3>Betting slip view</h3><p class="muted">The markets as a Swiss betting slip lists them, in its order and wording. Each cell shows this forecast’s chance and the price to insist on: a price on the slip <em>at least</em> that high is worth more than it costs by this forecast; a lower one is not. First-half markets assume 45% of the goals come before the break. Fair prices carry no margin; nothing here is a recommendation to bet.</p><div class="books">${groups.map(groupHtml).join('')}</div><div class="combo" id="combo"><h4>Price and save selections</h4><div id="combo-body">${EMPTY_PANEL}</div><div id="combo-message" role="status"></div></div>`;
}

/** A default slip label: the one used last in this session, else the match day. */
function defaultSlipLabel(f) {
  try {
    const kept = sessionStorage.getItem(SLIP_KEY);
    if (kept) return kept;
  } catch {
    // storage blocked: fall through
  }
  const day = new Date(f.kickoff);
  return Number.isFinite(day.getTime())
    ? 'Slip ' + day.toLocaleDateString([], {weekday: 'short', day: 'numeric', month: 'short'})
    : 'Slip';
}

/**
 * The panel under the markets for the chosen selections: each leg with its price box, the
 * joint chance (from the scorelines when every leg is full-time), the fair price, the slip's
 * price checked against it, and the slip label the picks will be saved under.
 */
export function comboPanel(f, {legs = [], legPrices = {}, slipLabel = '', priceText = ''} = {}) {
  const ids = [...legs];
  if (!ids.length) return EMPTY_PANEL;
  const cells = new Map(
    bettingMarkets(f).flatMap((g) =>
      g.rows.flatMap((r) => r.cells.map((c) => [c.id, {...c, group: g.title}])),
    ),
  );
  const chosen = ids.map((id) => cells.get(id)).filter(Boolean);
  const items = chosen
    .map(
      (c) =>
        `<li class="combo-leg"><span class="combo-leg-what">${esc(c.group)} · <strong>${esc(c.label)}</strong> ${c.p}% <small class="muted">at least ${c.fair?.toFixed(2) ?? '—'}</small></span><input data-leg-price="${esc(c.id)}" inputmode="decimal" placeholder="price" aria-label="Price for ${esc(c.label)}" value="${esc(legPrices[c.id] ?? '')}" autocomplete="off" /><button type="button" class="text-button" data-combo-remove="${esc(c.id)}">Remove</button></li>`,
    )
    .join('');
  const n = chosen.length;
  const joint = n === 1 ? chosen[0].p : comboProbability(ids, f);
  const naive = chosen.reduce((acc, c) => acc * (c.p / 100), 1) * 100;
  let tiles = '';
  let verdict = '';
  if (joint === null) {
    tiles =
      '<p class="muted">First-half and halftime/fulltime selections cannot be priced together with other legs here; save them one at a time.</p>';
  } else {
    const fair = joint > 0 ? (100 / joint).toFixed(2) : '—';
    const price = parseOdds(priceText);
    const ev = price && joint > 0 ? expectedValue(joint / 100, price) : null;
    tiles = `<div class="stat-tiles slip-tiles"><div class="stat-tile"><span class="stat-label">${n === 1 ? 'Chance' : `All ${n} legs hold`}</span><strong>${joint}%</strong><span class="stat-sub">${n === 1 ? 'by this forecast' : `from the scorelines; multiplying would say ${Math.round(naive * 10) / 10}%`}</span></div><div class="stat-tile"><span class="stat-label">Insist on at least</span><strong>${fair}</strong><span class="stat-sub">fair price, no margin</span></div></div><label class="slip-odds">${n === 1 ? 'The slip’s price' : 'The slip’s BetBuilder price'}<input id="combo-price" inputmode="decimal" placeholder="e.g. 5.20" value="${esc(priceText)}" autocomplete="off" /></label>`;
    verdict =
      ev === null
        ? ''
        : `<p><strong class="${ev > 0 ? 'value-yes' : 'value-no'}">${ev > 0 ? 'Worth it by this forecast' : 'Not worth it'}: ${ev > 0 ? '+' : ''}${(ev * 100).toFixed(1)}% expected return per unit at ${price.toFixed(2)}.</strong></p>`;
  }
  const save = `<div class="combo-save"><label class="slip-odds">Slip label (picks placed together share one)<input id="combo-slip" maxlength="40" value="${esc(slipLabel)}" autocomplete="off" /></label><button type="button" class="primary" data-save-picks ${f.demo ? 'disabled' : ''}>Save ${n} pick${n === 1 ? '' : 's'}</button></div><p class="muted">Each selection is saved as its own virtual pick with the price typed next to it, settled from the final and half-time scores, and grouped with the others under the slip label on My picks.</p>`;
  return `<ul class="combo-legs">${items}</ul>${tiles}<div class="combo-verdict">${verdict}</div>${save}`;
}

let current = null; // {f, legs: Set, legPrices, priceText, slipLabel}

function renderCombo() {
  const body = $('#combo-body');
  if (!body || !current) return;
  body.innerHTML = comboPanel(current.f, current);
  for (const b of document.querySelectorAll('[data-combo-add]'))
    b.setAttribute('aria-pressed', String(current.legs.has(b.dataset.comboAdd)));
}

let wired = false;

/** Wires the selections and the panel inside the analysis dialog. Call after every render. */
export function initMarkets(f) {
  current = {f, legs: new Set(), legPrices: {}, priceText: '', slipLabel: defaultSlipLabel(f)};
  if (wired) return;
  wired = true;
  const dialog = $('#analysis');
  dialog.addEventListener('click', (e) => {
    if (!current) return;
    const add = e.target.closest('[data-combo-add]');
    const remove = e.target.closest('[data-combo-remove]');
    const save = e.target.closest('[data-save-picks]');
    if (save) {
      try {
        sessionStorage.setItem(SLIP_KEY, current.slipLabel);
      } catch {
        // storage blocked: the label still goes with this save
      }
      document.dispatchEvent(
        new CustomEvent('jk:save-picks', {
          detail: {
            legs: [...current.legs].map((id) => ({
              selection: id,
              price: current.legPrices[id] ?? '',
            })),
            slip: current.slipLabel,
          },
        }),
      );
      return;
    }
    if (!add && !remove) return;
    if (remove) current.legs.delete(remove.dataset.comboRemove);
    else if (current.legs.has(add.dataset.comboAdd)) current.legs.delete(add.dataset.comboAdd);
    else if (current.legs.size < MAX_LEGS) current.legs.add(add.dataset.comboAdd);
    renderCombo();
  });
  dialog.addEventListener('input', (e) => {
    if (!current) return;
    const t = e.target;
    if (t.dataset.legPrice) current.legPrices[t.dataset.legPrice] = t.value;
    else if (t.id === 'combo-slip') current.slipLabel = t.value;
    else if (t.id === 'combo-price') {
      current.priceText = t.value;
      // Keep focus: swap only the tiles and the verdict.
      const fresh = document.createElement('div');
      fresh.innerHTML = comboPanel(current.f, current);
      const body = $('#combo-body');
      body.querySelector('.slip-tiles')?.replaceWith(fresh.querySelector('.slip-tiles'));
      body.querySelector('.combo-verdict')?.replaceWith(fresh.querySelector('.combo-verdict'));
    }
  });
}

/** Exposed for the tests only. */
export const marketsBlockForTest = marketsBlock;
export const comboPanelForTest = comboPanel;
