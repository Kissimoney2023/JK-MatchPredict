import {$, esc} from '../dom.js';
import {state} from '../state.js';
import {updateStandingsBox} from './standings.js';

const ALL_LEAGUES_BUTTON = (active) =>
  `<button class="league ${active ? 'active' : ''}" data-league="all"><span class="league-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg></span><span>All available leagues<small>One UTC date at a time</small></span></button>`;

const leagueButton = (l) =>
  `<button class="league ${l.key === state.league ? 'active' : ''}" data-league="${esc(l.key)}"><span class="league-icon">${esc(l.country?.slice(0, 2).toUpperCase())}</span><span>${esc(l.name)}<small>${esc(l.country)}${l.fallback ? ' · fallback available' : ''}${l.saOnly ? ' · via StrikerAPI, market forecasts' : ''}</small></span></button>`;

export function renderLeagues() {
  const query = $('#league-search').value.toLowerCase();
  const matching = state.leagues.filter((l) =>
    (l.name + ' ' + l.country).toLowerCase().includes(query),
  );
  // By default show featured competitions (and the selected one); searching looks at all.
  const collapsed = !query && !state.showAllLeagues;
  const leagues = collapsed
    ? matching.filter((l) => l.featured || l.key === state.league)
    : matching;
  const hidden = matching.length - leagues.length;
  const toggle =
    hidden > 0 || (!query && state.showAllLeagues && state.leagues.some((l) => !l.featured))
      ? '<button class="text-button league-more" data-leagues-toggle>' +
        (state.showAllLeagues
          ? 'Show fewer competitions'
          : 'Show all competitions (' + hidden + ' more)') +
        '</button>'
      : '';
  $('#league-count').textContent = state.leagues.length;
  $('#leagues').innerHTML =
    ALL_LEAGUES_BUTTON(state.league === 'all') + leagues.map(leagueButton).join('') + toggle;

  const selected = state.leagues.find((x) => x.key === state.league);
  $('#competition-title').textContent = selected?.name || 'All available leagues';
  $('#competition-country').textContent = selected?.country || 'MATCH EXPLORER';
  $('#date-to').disabled = state.league === 'all';
  if (state.league === 'all') $('#date-to').value = $('#date-from').value;
  updateStandingsBox();
}
