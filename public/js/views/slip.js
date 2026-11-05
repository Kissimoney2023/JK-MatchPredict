import {combinedPrice, parseOdds, slipSummary} from '/value.js';
import {pickLabel, pickProbability} from '/pickstats.js';
import {tierOf} from '/analysis.js';
import {manualLeg, ticketOptions, MAX_TICKET_LEGS} from '/ticket.js';
import {$, esc} from '../dom.js';
import {state} from '../state.js';

const selected = new Set(); // pick ids in the slip (this page load only)
let combinedOddsText = '';
const legOddsText = {}; // pick id -> the price typed for that leg
let boostText = '';
let stakeText = '10';
let manual = []; // legs typed in by hand: {label, odds, p, manual: true}

const LONG_SHOT = 0.1; // below this chance the slip is called what it is
const MANUAL_KEY = 'jk-manual-legs';

const pending = () =>
  state.picks.filter((p) => !p.result && Date.parse(p.forecast.kickoff) > Date.now());

export const inSlip = (pick) => selected.has(pick.id);

function loadManual() {
  try {
    const kept = JSON.parse(sessionStorage.getItem(MANUAL_KEY) || '[]');
    if (Array.isArray(kept)) manual = kept.filter((l) => l && l.label && l.odds > 1 && l.p > 0);
  } catch {
    manual = [];
  }
}
function saveManual() {
  try {
    sessionStorage.setItem(MANUAL_KEY, JSON.stringify(manual));
  } catch {
    // storage blocked: the legs live in the page only
  }
}

const pct = (x) =>
  (x * 100 < 1 ? (x * 100).toFixed(2) : (x * 100).toFixed(x * 100 < 10 ? 1 : 0)) + '%';

/** The ticket shapes for the legs, with the recommendation marked. */
function ticketHtml(legs, stakeValue) {
  const usable = legs.filter((l) => Number.isFinite(l.p) && l.p > 0);
  if (usable.length < 3)
    return `<h4>Build my ticket</h4><p class="muted">With three or more legs, this compares one Kombi with short Kombis, system bets and the ticket without its weakest legs: how often each pays, and what it returns on average.</p>`;
  const stake = Number.isFinite(stakeValue) && stakeValue > 0 ? stakeValue : 10;
  const opts = ticketOptions(usable, {stake});
  if (!opts)
    return `<h4>Build my ticket</h4><p class="muted">The builder works with up to ${MAX_TICKET_LEGS} legs; remove some to compare ticket shapes.</p>`;
  const rows = opts
    .map(
      (o) =>
        `<tr class="${o.recommended ? 'recommended' : ''}"><td><strong>${esc(o.title)}</strong>${o.recommended ? ' <span class="tag">Recommended</span>' : ''}${o.note ? `<br><small class="muted">${esc(o.note)}</small>` : ''}</td><td class="num">${o.linesCount}${o.linesCount > 1 ? `<br><small class="muted">${o.stakePerLine.toFixed(2)} each</small>` : ''}</td><td class="num">${pct(o.payProbability)}<br><small class="muted">${o.oneIn ? `1 in ${o.oneIn}` : '—'}</small></td><td class="num">${pct(o.profitProbability)}</td><td class="num">${o.expectedReturn.toFixed(2)}</td><td class="num">${o.maxWin.toFixed(2)}</td></tr>`,
    )
    .join('');
  const fair = opts[0].fairPriced
    ? ' Legs without a typed price are priced at their fair odds, which flatters them a little.'
    : '';
  return `<h4>Build my ticket</h4><div class="table-scroll"><table class="ticket-table"><thead><tr><th>Shape</th><th class="num">Lines</th><th class="num">Pays</th><th class="num">Profit</th><th class="num">Avg return per 1</th><th class="num">Max win</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted">The whole stake (${stake.toFixed(2)}) is split equally over a shape’s lines. “Pays” is any money back, “Profit” more than the stake back, “Avg return” what one unit staked comes back as on average (below 1 is the bookmaker’s margin; shorter lines lose less of it). The recommendation is the shape that profits most often among those within five cents of the best average return. Legs are treated as independent.${fair} System bets are only worth it where the slip offers them.</p>`;
}

/**
 * The slip's markup for the chosen picks and any legs typed in by hand. Prices can be typed
 * per leg (the combination's price is then their product, plus any boost on the winnings) or
 * as one combined price.
 */
export function slipHtml(
  picks,
  oddsText = '',
  {legOdds = {}, boost = '', manual: typed = [], stake = '10'} = {},
) {
  if (!picks.length && !typed.length) return '';
  const legs = [
    ...picks.map((p) => ({
      id: p.id,
      label: `${p.forecast.home} v ${p.forecast.away}: ${pickLabel(p)}`,
      p: pickProbability(p),
      oddsText: legOdds[p.id] ?? '',
      odds: parseOdds(legOdds[p.id] ?? ''),
    })),
    ...typed.map((l, i) => ({
      id: 'manual-' + i,
      manualIndex: i,
      label: l.label,
      p: l.p,
      oddsText: String(l.odds),
      odds: l.odds,
    })),
  ];
  const fromLegs = combinedPrice(
    legs.map((l) => l.oddsText),
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
      const price =
        l.manualIndex === undefined
          ? `<input data-leg-odds="${esc(l.id)}" inputmode="decimal" placeholder="price" aria-label="Price for ${esc(l.label)}" value="${esc(l.oddsText)}" autocomplete="off" />`
          : `<span class="slip-leg-price">${l.odds.toFixed(2)} <button type="button" class="text-button" data-manual-remove="${l.manualIndex}">Remove</button></span>`;
      return `<li class="slip-leg ${tier ? 'tier-' + tier.replace(/\s/g, '-') : ''}">${badge}<span class="slip-leg-what">${esc(l.label)} <span class="muted">${Number.isFinite(l.p) ? l.p + '%' : 'no estimate'}${l.manualIndex !== undefined ? ' · typed in' : ''}</span></span>${price}</li>`;
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
  const stakeValue = Number(String(stake).replace(',', '.'));
  const ticket = `<div class="ticket-block">${ticketHtml(legs, stakeValue)}</div>`;
  const manualForm = `<form id="manual-leg" class="manual-leg"><label class="slip-odds">Add a leg by hand (a match the app does not list)<input id="manual-label" maxlength="60" placeholder="e.g. Reims win" autocomplete="off" /></label><label class="slip-odds">Its price on the slip<input id="manual-odds" inputmode="decimal" placeholder="e.g. 1.57" autocomplete="off" /></label><button type="submit" class="secondary">Add leg</button></form><p class="muted">A typed leg’s chance is read from its price with a typical 5% margin removed; the app has no forecast for it.</p>`;
  return `<h3>Slip calculator</h3><ul class="slip-legs">${rows}</ul>${summary}${skipped}<div class="slip-prices"><label class="slip-odds">Total stake<input id="slip-stake" inputmode="decimal" value="${esc(String(stake))}" autocomplete="off" /></label><label class="slip-odds">Boost on the winnings, % (a CombiBoost)<input id="slip-boost" inputmode="decimal" placeholder="e.g. 5" value="${esc(boost)}" autocomplete="off" /></label><label class="slip-odds">Or the combined price as printed<input id="slip-odds" inputmode="decimal" placeholder="e.g. 80.35" value="${esc(oddsText)}" autocomplete="off" /></label></div>${ticket}${manualForm}<p class="muted">Type each leg’s price from the slip to get the combination’s price, or the printed combined price. Legs are treated as independent, which flatters a slip whose legs are related (two picks on one match, or on the same team’s matches). Every extra leg multiplies the chance of losing the lot; the fair odds show what the chain is worth before any margin. Virtual picks only.</p>`;
}

export function renderSlip() {
  const box = $('#slip');
  if (!box) return;
  for (const id of selected) if (!pending().some((p) => p.id === id)) selected.delete(id);
  const picks = pending().filter(inSlip);
  box.classList.toggle('hidden', !picks.length && !manual.length);
  box.innerHTML = slipHtml(picks, combinedOddsText, {
    legOdds: legOddsText,
    boost: boostText,
    manual,
    stake: stakeText,
  });
}

/** A checkbox for a pending pick's card. */
export const slipToggleHtml = (pick) =>
  `<label class="slip-toggle"><input type="checkbox" data-slip="${esc(pick.id)}" ${inSlip(pick) ? 'checked' : ''} /> Add to slip</label>`;

export function initSlip() {
  loadManual();
  $('#picks').addEventListener('change', (e) => {
    const box = e.target.closest('[data-slip]');
    if (!box) return;
    if (box.checked) selected.add(box.dataset.slip);
    else selected.delete(box.dataset.slip);
    renderSlip();
  });
  $('#slip').addEventListener('submit', (e) => {
    if (e.target.id !== 'manual-leg') return;
    e.preventDefault();
    const leg = manualLeg({label: $('#manual-label').value, odds: $('#manual-odds').value});
    if (!leg) {
      $('#manual-odds').setCustomValidity('Give the leg a name and a decimal price above 1.');
      $('#manual-odds').reportValidity();
      $('#manual-odds').setCustomValidity('');
      return;
    }
    manual.push(leg);
    saveManual();
    renderSlip();
    $('#manual-label')?.focus();
  });
  $('#slip').addEventListener('click', (e) => {
    const b = e.target.closest('[data-manual-remove]');
    if (!b) return;
    manual.splice(Number(b.dataset.manualRemove), 1);
    saveManual();
    renderSlip();
  });
  $('#slip').addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'slip-odds') combinedOddsText = t.value;
    else if (t.id === 'slip-boost') boostText = t.value;
    else if (t.id === 'slip-stake') stakeText = t.value;
    else if (t.dataset.legOdds) legOddsText[t.dataset.legOdds] = t.value;
    else return;
    const picks = pending().filter(inSlip);
    // Re-render only the tiles, the warning and the ticket table so typing keeps focus.
    const fresh = document.createElement('div');
    fresh.innerHTML = slipHtml(picks, combinedOddsText, {
      legOdds: legOddsText,
      boost: boostText,
      manual,
      stake: stakeText,
    });
    const swap = (selector) => {
      const old = $('#slip ' + selector);
      const next = fresh.querySelector(selector);
      if (old && next) old.replaceWith(next);
    };
    swap('.slip-tiles');
    swap('.ticket-block');
    $('#slip .slip-warning')?.remove();
    const warning = fresh.querySelector('.slip-warning');
    if (warning) $('#slip .slip-tiles')?.after(warning);
  });
}
