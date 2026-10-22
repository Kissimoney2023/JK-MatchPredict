import {api} from './api.js';
import {run} from './busy.js';
import {demoLeagues, samples} from './demo.js';
import {$, $$, addDays, message, todayUtc, notice} from './dom.js';
import {state} from './state.js';
import {showAnalysis} from './views/analysis.js';
import {renderConnection} from './views/connection.js';
import {renderLeagues} from './views/leagues.js';
import {renderMatches} from './views/matches.js';
import {exportPicks, loadPicks, removePickClick} from './views/picks.js';
import {loadStandings} from './views/standings.js';
import {loadInsights} from './views/insights.js';
import {initShare} from './views/share.js';
import {initReminders} from './views/reminders.js';
import {loadPotd} from './views/potd.js';
import {initDiagnostics} from './views/diagnostics.js';
import {initAccountUi, renderAccount, finishLogin, takeLoginReturn} from './views/account.js';

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
  notice(data.warnings, {loaded: data.fixtures.length > 0, source: data.source});
  renderMatches();
}

const UPCOMING_WINDOW_DAYS = 30;

/** Default view: the Champions League over the next 30 days, upcoming matches only. */
function showUpcomingChampionsLeague() {
  const champions = state.leagues.find((l) => l.fdCode === 'CL');
  if (!champions) return;
  state.league = champions.key;
  state.status = 'upcoming';
  $('#date-from').value = todayUtc();
  $('#date-to').value = todayUtc(UPCOMING_WINDOW_DAYS);
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
    state.storage = status.storage;
    state.accounts = status.accounts ?? {enabled: false};
    state.account = status.account ?? null;
    state.push = status.push ?? {enabled: false};
    if (status.accountError)
      message('Could not verify your sign-in right now. Reload the page to try again.');
    renderAccount();
    renderConnection();
    if (status.connected) loadPotd(); // optional card; never blocks the page
    if (status.connected) {
      const catalog = await api('leagues');
      state.leagues = catalog.leagues;
      message(catalog.warnings.join(' '));
      showUpcomingChampionsLeague();
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
  showUpcomingChampionsLeague();
  renderConnection();
  renderLeagues();
  switchView('matches');
  loadMatches();
}

// ---- Actions --------------------------------------------------------------

// `listing` is the match list the key belongs to: the pick of the day comes from the server's
// own list, not the one on screen.
const analyzeMatch = (key, listing = state.listing) =>
  run(async () => {
    const forecast = state.demo
      ? state.fixtures.find((f) => f.key === key)
      : await api('forecast', {key, listing});
    showAnalysis(forecast);
    loadInsights(forecast.key, listing); // optional extra; does not block or fail the forecast
  });

/** Saves a pick: {outcome} for home/draw/away, {market: 'totals', line, outcome} for Over/Under. */
const savePick = (selection) =>
  run(async () => {
    const result = await api(
      'save',
      {},
      {action: 'save', forecastId: state.analysis.forecastId, ...selection},
    );
    message(
      result.saved
        ? 'Pick saved. You can remove it in My picks until kickoff; after that it is locked.'
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
    // "All leagues" browses a single day. Leaving it for one competition restores a 30-day
    // window, otherwise that competition would show an empty one-day list.
    if (state.league === 'all' && b.dataset.league !== 'all')
      $('#date-to').value = addDays($('#date-from').value, UPCOMING_WINDOW_DAYS);
    state.league = b.dataset.league;
    renderLeagues();
    run(loadMatches);
  }
  if (b.dataset.status) {
    state.status = b.dataset.status;
    state.page = 1;
    renderMatches();
  }
  if (b.hasAttribute('data-leagues-toggle')) {
    state.showAllLeagues = !state.showAllLeagues;
    renderLeagues();
  }
  if (b.hasAttribute('data-remove-pick')) removePickClick(b);
  if (b.dataset.analyze) analyzeMatch(b.dataset.analyze, b.dataset.listing || state.listing);
  if (b.hasAttribute('data-save')) savePick({outcome: Number(b.dataset.save)});
  if (b.hasAttribute('data-save-totals'))
    savePick({
      market: 'totals',
      line: Number(b.dataset.line),
      outcome: Number(b.dataset.saveTotals),
    });
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
$('#standings-box').addEventListener('toggle', (e) => {
  if (e.target.open) loadStandings();
});
$('#settle').onclick = settlePicks;
$('#export').onclick = exportPicks;
document.addEventListener('click', onButtonClick);

initAccountUi();
initReminders();
initDiagnostics();
initShare();
const returnedFromLogin = takeLoginReturn();
// Offline shell and installability. A failure here must never affect the app.
if ('serviceWorker' in navigator)
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

run(initialize).then(() => {
  if (returnedFromLogin) finishLogin(returnedFromLogin);
});
