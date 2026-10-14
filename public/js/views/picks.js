import {api} from '../api.js';
import {$, esc, formatDate} from '../dom.js';
import {state} from '../state.js';

function pickCard(p) {
  const f = p.forecast;
  const label = [f.home + ' win', 'Draw', f.away + ' win'][p.outcome];
  return `<article class="match"><div class="match-top"><span>${esc(f.competition)}</span><span class="tag">${esc(p.result || 'Pending')}</span></div><h3>${esc(f.home)} vs ${esc(f.away)}</h3><p><strong>${esc(label)} · ${f.p[p.outcome]}%</strong></p><p class="muted">Kickoff ${esc(formatDate(f.kickoff))}<br>Saved ${esc(formatDate(p.createdAt))}${p.score ? '<br>Regulation score ' + esc(p.score) : ''}<br>${esc(f.source)}</p></article>`;
}

const EMPTY_PICKS =
  '<div class="empty"><strong>No virtual picks yet</strong>Open a match forecast and choose an outcome. Your saved pick will lock immediately.</div>';

export async function loadPicks() {
  const data = await api('picks');
  state.picks = data.picks;
  $('#pick-count').textContent = state.picks.length;
  $('#picks').innerHTML = state.picks.length ? state.picks.map(pickCard).join('') : EMPTY_PICKS;
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
