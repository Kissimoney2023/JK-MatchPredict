import {api} from './api.js';
import {run} from './busy.js';
import {demoLeagues, samples} from './demo.js';
import {$, $$, message, todayUtc} from './dom.js';
import {state} from './state.js';
import {showAnalysis} from './views/analysis.js';
import {renderConnection} from './views/connection.js';
import {renderLeagues} from './views/leagues.js';
import {renderMatches} from './views/matches.js';
import {exportPicks, loadPicks} from './views/picks.js';

// ---- Data loading ---------------------------------------------------------

async function loadMatches() {
  state.fixtures = [];
  state.page = 1;
  state.at = null;
  renderMatches();

  if (state.demo) {
    state.fixtures = samples().filter(
      (f) => state.league === 'all' || f.leagueKey === state.league,
    );
    state.source = 'Demo';
    renderMatches();
    return;
  }
  if (!state.connected) {
    renderMatches();
    return;
  }

  const from = $('#date-from').value;
  const to = state.league === 'all' ? from : $('#date-to').value;
  const data = await api('fixtures', {league: state.league, from, to});
  state.fixtures = data.fixtures;
  state.listing = data.listingId;
  state.source = data.source;
  state.at = data.fetchedAt;
  message((data.warnings || []).join(' '));
  renderMatches();
}

async function initialize() {
  state.demo = false;
  state.leagues = [];
  state.fixtures = [];
  state.league = 'all';
  try {
    const status = await api('status');
    state.providers = status.providers;
    state.connected = status.connected;
    renderConnection();
    if (status.connected) {
      const catalog = await api('leagues');
      state.leagues = catalog.leagues;
      message(catalog.warnings.join(' '));
    }
    renderLeagues();
    await loadMatches();
    await loadPicks();
  } catch (e) {
    renderConnection(e.message);
    renderLeagues();
    renderMatches();
    message(e.message);
  }
}

// ---- Navigation -----------------------------------------------------------

function switchView(view) {
  state.view = view;
  $('#explorer').classList.toggle('hidden', view !== 'matches');
  $('#picks-view').classList.toggle('hidden', view !== 'picks');
  $('#method-view').classList.toggle('hidden', view !== 'method');
  $$('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'picks') run(loadPicks, '#pick-message');
}

function startDemo() {
  state.demo = true;
  state.leagues = demoLeagues;
  state.league = 'all';
  renderConnection();
  renderLeagues();
  switchView('matches');
  loadMatches();
}

// ---- Actions --------------------------------------------------------------

const analyzeMatch = (key) =>
  run(async () => {
    const forecast = state.demo
      ? state.fixtures.find((f) => f.key === key)
      : await api('forecast', {key, listing: state.listing});
    showAnalysis(forecast);
  });

const savePick = (outcome) =>
  run(async () => {
    const result = await api(
      'save',
      {},
      {action: 'save', forecastId: state.analysis.forecastId, outcome},
    );
    message(
      result.saved
        ? 'Pick saved and locked. View it in My picks.'
        : 'You already saved a pick for this match.',
      '#save-message',
    );
    await loadPicks();
  }, '#save-message');

const settlePicks = () =>
  run(async () => {
    const d = await api('settle', {}, {action: 'settle'});
    await loadPicks();
    message(
      `Checked ${d.checked} eligible matches; ${d.settled} newly settled.${d.unavailable ? ' Some results are unavailable; try later.' : ''} Checks process up to three matches at a time.`,
      '#pick-message',
    );
  }, '#pick-message');

function onButtonClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.view) switchView(b.dataset.view);
  if (b.hasAttribute('data-demo') && !state.busy) startDemo();
  if (b.hasAttribute('data-live')) run(initialize);
  if (b.dataset.league && !state.busy) {
    state.league = b.dataset.league;
    renderLeagues();
    run(loadMatches);
  }
  if (b.dataset.status) {
    state.status = b.dataset.status;
    state.page = 1;
    renderMatches();
  }
  if (b.dataset.analyze) analyzeMatch(b.dataset.analyze);
  if (b.hasAttribute('data-save')) savePick(Number(b.dataset.save));
}

// ---- Wiring ---------------------------------------------------------------

$('#date-from').value = todayUtc();
$('#date-to').value = todayUtc();

$('#league-search').addEventListener('input', renderLeagues);
$('#team-search').addEventListener('input', (e) => {
  state.query = e.target.value.toLowerCase();
  state.page = 1;
  renderMatches();
});
$('#date-from').addEventListener('change', () => {
  if (state.league === 'all') $('#date-to').value = $('#date-from').value;
});
$('#filters').addEventListener('submit', (e) => {
  e.preventDefault();
  run(loadMatches);
});
$('#refresh').onclick = () => run(loadMatches);
$('#more').onclick = () => {
  state.page++;
  renderMatches();
};
$('#close-analysis').onclick = () => $('#analysis').close();
$('#settle').onclick = settlePicks;
$('#export').onclick = exportPicks;
document.addEventListener('click', onButtonClick);

run(initialize);
