import {pickLabel, pickPrice, pickProbability, slipsSummary} from '/pickstats.js';
import {$, esc} from '../dom.js';

const STATUS = {won: 'Won', lost: 'Lost', pending: 'Open', void: 'Void'};

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

/** The picks placed together, slip by slip, with how each one went. */
export function slipsBlock(picks) {
  const s = slipsSummary(picks);
  if (!s.slips.length) return '';
  const cards = s.slips
    .map(
      (slip) =>
        `<article class="slip-card slip-${slip.status}"><div class="match-top"><strong>${esc(slip.label)}</strong><span class="tag">${STATUS[slip.status]}</span></div><ul class="slip-card-legs">${slip.legs.map(legHtml).join('')}</ul><p class="muted">${slip.n} leg${slip.n === 1 ? '' : 's'}${slip.price ? ` · price ${slip.price.toFixed(2)}` : ''}${slip.probability ? ` · chance at placement ${slip.probability}% (fair ${slip.fairOdds.toFixed(2)})` : ''}${slip.status === 'lost' ? ` · lost on ${slip.lostLegs.map((p) => esc(pickLabel(p))).join(', ')}` : ''}</p></article>`,
    )
    .join('');
  return `<h3>Slips</h3><p class="muted">${s.won} won · ${s.lost} lost · ${s.pending} open · legs ${s.legsCorrect} of ${s.legsSettled} settled legs won.</p><div class="slip-cards">${cards}</div>`;
}

export function renderSlips(picks) {
  const box = $('#slips');
  if (!box) return;
  box.innerHTML = slipsBlock(picks);
  box.classList.toggle('hidden', !box.innerHTML);
}

/** Exposed for the tests only. */
export const slipsBlockForTest = slipsBlock;
