import {$, $$, esc, formatDate} from '../dom.js';
import {state, PAGE_SIZE, isLive, isFinished, isOpen} from '../state.js';
import {formChips} from './insights.js';

function scoreText(f) {
  return Number.isInteger(f.score?.home) && Number.isInteger(f.score?.away)
    ? f.score.home + '–' + f.score.away
    : 'vs';
}

function closedLabel(f) {
  if (isFinished(f)) return 'Match finished';
  return f.status === 'TBD' ? 'Kickoff unconfirmed' : 'Pre-match picks closed';
}

const team = (name, form) =>
  `<div class="team"><span class="crest">${esc(name.slice(0, 3).toUpperCase())}</span>${esc(name)}${formChips(form)}</div>`;

function matchCard(f) {
  const action = isOpen(f)
    ? `<button class="text-button" data-analyze="${esc(f.key)}" ${state.busy ? 'disabled' : ''}>Predict &amp; view tips</button>`
    : `<small>${closedLabel(f)}</small>`;
  return `<article class="match"><div class="match-top"><span>${esc(f.competition)}</span><span class="tag">${f.demo ? 'SAMPLE' : esc(f.status)}</span></div><div class="teams">${team(f.home, f.form?.home)}<span class="vs">${esc(scoreText(f))}</span>${team(f.away, f.form?.away)}</div><div class="match-bottom"><small>${esc(formatDate(f.kickoff))}<br>Your local time</small>${action}</div></article>`;
}

const STATUS_TESTS = {
  all: () => true,
  upcoming: (f) => ['NS', 'TBD'].includes(f.status),
  live: (f) => isLive(f),
  finished: (f) => isFinished(f),
};
const STATUS_LABELS = {
  all: 'All matches',
  upcoming: 'Upcoming',
  live: 'In progress',
  finished: 'Finished',
};
// How each status reads in a sentence ("No matches in progress right now").
const NONE_FOR = {
  upcoming: 'No upcoming matches in this date range',
  live: 'No matches are in progress right now',
  finished: 'No finished matches in this date range',
};

/** Fixtures matching the team search (every status): the base for the tab counts. */
const searched = () =>
  state.fixtures.filter(
    (f) => !state.query || (f.home + ' ' + f.away).toLowerCase().includes(state.query),
  );

export const matchesInView = () =>
  searched().filter(STATUS_TESTS[state.status] ?? STATUS_TESTS.all);

/** How many searched matches each tab would show. */
export function statusCounts() {
  const base = searched();
  return Object.fromEntries(
    Object.entries(STATUS_TESTS).map(([status, test]) => [status, base.filter(test).length]),
  );
}

export function emptyState() {
  const ready = state.connected || state.demo;
  // Loading only until the answer is in: the list is drawn before the busy flag clears.
  if (state.busy && !state.at)
    return '<div class="empty"><strong>Loading matches…</strong>One moment.</div>';
  if (!ready)
    return '<div class="empty"><strong>Your matchday starts here</strong>Add your API keys in Vercel, or preview the sample matches above.</div>';

  // Matches exist, just not under this tab or search: say so, and offer the tabs that have some.
  if (state.fixtures.length) {
    const counts = statusCounts();
    const others = Object.keys(STATUS_TESTS).filter(
      (status) => status !== state.status && status !== 'all' && counts[status] > 0,
    );
    if (state.query && !counts.all)
      return `<div class="empty"><strong>No team matches “${esc(state.query)}”</strong>Check the spelling, or clear the search to see all ${state.fixtures.length} matches.</div>`;
    const title = NONE_FOR[state.status] ?? 'No matches in this view';
    const offers = others
      .map(
        (status) =>
          `<button class="text-button" data-status="${status}">Show ${STATUS_LABELS[status].toLowerCase()} (${counts[status]})</button>`,
      )
      .join(' ');
    const more = counts.all
      ? `${counts.all} match${counts.all === 1 ? '' : 'es'} in this date range. `
      : '';
    return `<div class="empty"><strong>${title}</strong>${more}${offers}</div>`;
  }
  // The answer came back empty: say for what, and where it was looked up.
  const competition = state.leagues.find((l) => l.key === state.league)?.name;
  const range = state.range?.from
    ? state.range.to && state.range.to !== state.range.from
      ? ` between ${esc(state.range.from)} and ${esc(state.range.to)}`
      : ` on ${esc(state.range.from)}`
    : '';
  const where = state.source ? ` by ${esc(state.source)}` : '';
  const tournament = state.leagues.find((l) => l.key === state.league)?.type === 'CUP';
  const hint = tournament
    ? 'Tournaments only have fixtures around their finals and knockout rounds; try dates when it is being played, or another competition.'
    : 'Try other dates or another competition.';
  return `<div class="empty"><strong>No ${competition ? esc(competition) + ' ' : ''}matches${range}</strong>Nothing listed${where} for those dates. ${hint}</div>`;
}

export function renderMatches() {
  const list = matchesInView();
  const shown = state.page * PAGE_SIZE;
  const source = state.demo ? 'illustrative demo' : state.source || 'waiting for data';
  $('#match-count').textContent =
    `${list.length} match${list.length === 1 ? '' : 'es'} · ${source}`;
  $('#updated').textContent = state.at ? 'Fetched ' + formatDate(state.at) : '';
  $('#matches').innerHTML = list.length
    ? list.slice(0, shown).map(matchCard).join('')
    : emptyState();
  $('#more').classList.toggle('hidden', list.length <= shown);
  const counts = state.fixtures.length ? statusCounts() : null;
  $$('.filter-tabs [data-status]').forEach((b) => {
    b.classList.toggle('active', b.dataset.status === state.status);
    const status = b.dataset.status;
    b.textContent = STATUS_LABELS[status] + (counts ? ` (${counts[status]})` : '');
  });
}
