import {$, $$, esc, formatDate} from '../dom.js';
import {state, PAGE_SIZE, isLive, isFinished, isOpen} from '../state.js';

function scoreText(f) {
  return Number.isInteger(f.score?.home) && Number.isInteger(f.score?.away)
    ? f.score.home + '–' + f.score.away
    : 'vs';
}

function closedLabel(f) {
  if (isFinished(f)) return 'Match finished';
  return f.status === 'TBD' ? 'Kickoff unconfirmed' : 'Pre-match picks closed';
}

const team = (name) =>
  `<div class="team"><span class="crest">${esc(name.slice(0, 3).toUpperCase())}</span>${esc(name)}</div>`;

function matchCard(f) {
  const action = isOpen(f)
    ? `<button class="text-button" data-analyze="${esc(f.key)}" ${state.busy ? 'disabled' : ''}>Predict & view tips ↗</button>`
    : `<small>${closedLabel(f)}</small>`;
  return `<article class="match"><div class="match-top"><span>${esc(f.competition)}</span><span class="tag">${f.demo ? 'SAMPLE' : esc(f.status)}</span></div><div class="teams">${team(f.home)}<span class="vs">${esc(scoreText(f))}</span>${team(f.away)}</div><div class="match-bottom"><small>${esc(formatDate(f.kickoff))}<br>Your local time</small>${action}</div></article>`;
}

function matchesInView() {
  return state.fixtures.filter(
    (f) =>
      (!state.query || (f.home + ' ' + f.away).toLowerCase().includes(state.query)) &&
      (state.status === 'all' ||
        (state.status === 'upcoming' && ['NS', 'TBD'].includes(f.status)) ||
        (state.status === 'live' && isLive(f)) ||
        (state.status === 'finished' && isFinished(f))),
  );
}

function emptyState() {
  const ready = state.connected || state.demo;
  const title = state.busy
    ? 'Loading matches…'
    : ready
      ? 'No matches in this view'
      : 'Your matchday starts here';
  const hint = ready
    ? 'Try a different date, competition or status filter.'
    : 'Add your API keys in Netlify, or preview the sample matches above.';
  return `<div class="empty"><strong>${title}</strong>${hint}</div>`;
}

export function renderMatches() {
  const list = matchesInView();
  const shown = state.page * PAGE_SIZE;
  const source = state.demo ? 'illustrative demo' : state.source || 'waiting for data';
  $('#match-count').textContent = `${list.length} matches · ${source}`;
  $('#updated').textContent = state.at ? 'Fetched ' + formatDate(state.at) : '';
  $('#matches').innerHTML = list.length
    ? list.slice(0, shown).map(matchCard).join('')
    : emptyState();
  $('#more').classList.toggle('hidden', list.length <= shown);
  $$('[data-status]').forEach((b) =>
    b.classList.toggle('active', b.dataset.status === state.status),
  );
}
