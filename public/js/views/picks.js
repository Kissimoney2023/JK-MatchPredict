import {api} from '../api.js';
import {$, esc, formatDate} from '../dom.js';
import {state} from '../state.js';
import {run} from '../busy.js';
import {message} from '../dom.js';
import {renderPickStats} from './pickstats.js';
import {renderReminders} from './reminders.js';
import {pickLabel, pickProbability} from '/pickstats.js';
import {fairOdds} from '/analysis.js';
import {renderSlip, slipToggleHtml} from './slip.js';

/** A pick can be taken back until kickoff, and only while it has no result. */
const canRemove = (p) => !p.result && Date.parse(p.forecast.kickoff) > Date.now();

function pickCard(p) {
  const f = p.forecast;
  const chance = pickProbability(p);
  const chanceText = Number.isFinite(chance)
    ? ` · ${chance}% · fair ${fairOdds(chance)?.toFixed(2) ?? '—'}`
    : '';
  return `<article class="match"><div class="match-top"><span>${esc(f.competition)}</span><span class="tag">${esc(p.result || 'Pending')}</span></div><h3>${esc(f.home)} vs ${esc(f.away)}</h3><p><strong>${esc(pickLabel(p) + chanceText)}</strong></p><p class="muted">Kickoff ${esc(formatDate(f.kickoff))}<br>Saved ${esc(formatDate(p.createdAt))}${p.score ? '<br>Regulation score ' + esc(p.score) : ''}<br>${esc(f.source)}</p>${canRemove(p) ? `<div class="pick-actions"><button class="text-button danger" data-remove-pick="${esc(p.id)}">Remove pick</button><small class="muted">Until kickoff</small>${slipToggleHtml(p)}</div>` : ''}</article>`;
}

const EMPTY_PICKS =
  '<div class="empty"><strong>No virtual picks yet</strong>Open a match forecast and choose an outcome. You can remove a pick until kickoff; after that it is locked.</div>';

export async function loadPicks() {
  const data = await api('picks');
  state.picks = data.picks;
  renderPickStats(state.picks);
  renderReminders();
  $('#pick-count').textContent = state.picks.length;
  $('#picks').innerHTML = state.picks.length ? state.picks.map(pickCard).join('') : EMPTY_PICKS;
  renderSlip();
}

export function exportPicks() {
  const blob = new Blob([JSON.stringify(state.picks, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'jk-matchpredict-picks.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const CONFIRM_MS = 4000;

/**
 * Two-click removal: the first click arms the button ("Click again to confirm"), the second
 * removes the pick. The server enforces the rules (before kickoff, no result yet).
 */
export function removePickClick(button) {
  if (!button.dataset.armed) {
    button.dataset.armed = '1';
    button.textContent = 'Click again to confirm';
    button.classList.add('armed');
    setTimeout(() => {
      if (!button.isConnected) return;
      delete button.dataset.armed;
      button.textContent = 'Remove pick';
      button.classList.remove('armed');
    }, CONFIRM_MS);
    return;
  }
  run(async () => {
    await api('delete-pick', {}, {action: 'delete-pick', pickId: button.dataset.removePick});
    await loadPicks();
    message('Pick removed. You can pick that match again until kickoff.', '#pick-message');
  }, '#pick-message');
}
