import {api} from '../api.js';
import {$, esc, formatDate} from '../dom.js';
import {state} from '../state.js';

/** The card's markup for one stored pick (everything is escaped; numbers are numbers). */
export function potdCard(data) {
  const p = data.pick;
  const chance = Math.round(Number(p.probability));
  const scope =
    data.checked > 1
      ? `Highest forecast probability among ${data.checked} matches checked in the main competitions.`
      : 'The clearest forecast among today’s matches in the main competitions.';
  return `<div class="potd-body">
    <div>
      <div class="eyebrow">PICK OF THE DAY</div>
      <h2>${esc(p.home)} vs ${esc(p.away)}</h2>
      <p class="muted">${esc(p.competition)} · ${esc(formatDate(p.kickoff))}</p>
    </div>
    <div class="potd-forecast">
      <span class="potd-outcome">${esc(p.predictedOutcome)}</span>
      <strong class="number">${chance}%</strong>
      <progress max="100" value="${chance}" aria-label="Forecast probability ${chance}%">${chance}%</progress>
    </div>
  </div>
  <p class="muted">${esc(scope)} A probability, not a certainty: even a 70% favourite fails three times in ten. Source: ${esc(p.source)}. Virtual picks only; not betting advice.</p>
  <button class="primary" data-analyze="${esc(p.key)}" data-listing="${esc(p.listingId)}">View analysis &amp; make a pick</button>`;
}

/** Fills the dashboard card, or leaves it hidden when there is no pick. Never shows an error. */
export async function loadPotd() {
  const box = $('#potd');
  if (!box || state.demo) return;
  try {
    const data = await api('potd');
    box.classList.toggle('hidden', !data.pick);
    box.innerHTML = data.pick ? potdCard(data) : '';
  } catch {
    box.classList.add('hidden');
    box.innerHTML = '';
  }
}
