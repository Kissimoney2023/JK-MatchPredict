import {api} from '../api.js';
import {$, esc, formatDate} from '../dom.js';
import {state} from '../state.js';

const RETRY_MS = 8000;
const MAX_RETRIES = 4;

const WORDS = ['', 'Top pick', 'Top 2 picks', 'Top 3 picks'];

/** One pick: rank, match, the forecast winner with its probability, and the way in. */
function pickCard(p, rank) {
  const chance = Math.round(Number(p.probability));
  return `<article class="potd-pick">
    <span class="potd-rank" aria-hidden="true">${rank}</span>
    <div class="potd-match">
      <h3>${esc(p.home)} vs ${esc(p.away)}</h3>
      <p class="muted">${esc(p.competition)} · ${esc(formatDate(p.kickoff))}</p>
    </div>
    <div class="potd-forecast">
      <span class="potd-outcome">${esc(p.predictedOutcome)}</span>
      <strong class="number">${chance}%</strong>
      <progress max="100" value="${chance}" aria-label="Forecast probability ${chance}%">${chance}%</progress>
    </div>
    <button class="secondary" data-analyze="${esc(p.key)}" data-listing="${esc(p.listingId)}">Analyse &amp; pick</button>
  </article>`;
}

const percent = (v) => Math.round(Number(v) * 100);

/** How the picks shown here have turned out so far: honest about small samples. */
function recordLine(record) {
  if (!record || !(record.settled > 0)) return '';
  const done = `${Number(record.correct)} of ${Number(record.settled)}`;
  return record.reliable
    ? `<p class="muted potd-record">Track record of the picks shown here: <strong>${done}</strong> correct (${percent(record.rate)}%, 95% range ${percent(record.low)}–${percent(record.high)}%).</p>`
    : `<p class="muted potd-record">Track record so far: ${done} correct. Too few finished matches to judge yet.</p>`;
}

/** The card for one to three stored picks (everything is escaped; numbers are numbers). */
export function potdCards(data) {
  const picks = data.picks.slice(0, 3);
  const scope =
    data.checked > 1
      ? `Ranked by forecast probability among ${data.checked} matches checked in the main competitions.`
      : 'The clearest forecasts among today’s matches in the main competitions.';
  return `<div class="eyebrow">PICKS OF THE DAY</div>
  <h2>${WORDS[picks.length]} to win today</h2>
  <div class="potd-grid">${picks.map((p, i) => pickCard(p, i + 1)).join('')}</div>
  <p class="muted">${esc(scope)} Probabilities, not certainties: even a 70% favourite fails three times in ten. Virtual picks only; not betting advice.</p>${recordLine(data.record)}`;
}

const PENDING =
  '<div class="eyebrow">PICKS OF THE DAY</div><p class="muted">Working out today’s strongest forecasts…</p>';

/**
 * Fills the dashboard card, or leaves it hidden when there are no picks. While the very first
 * computation is under way it shows a short note and looks again a few times. Never shows an
 * error: this card is an extra.
 */
export async function loadPotd(attempt = 0) {
  const box = $('#potd');
  if (!box || state.demo) return;
  try {
    const data = await api('potd');
    if (data.picks?.length) {
      box.classList.remove('hidden');
      box.innerHTML = potdCards(data);
    } else if (data.pending && attempt < MAX_RETRIES) {
      box.classList.remove('hidden');
      box.innerHTML = PENDING;
      setTimeout(() => loadPotd(attempt + 1), RETRY_MS);
    } else {
      box.classList.add('hidden');
      box.innerHTML = '';
    }
  } catch {
    box.classList.add('hidden');
    box.innerHTML = '';
  }
}
