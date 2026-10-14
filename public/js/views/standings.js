import {api} from '../api.js';
import {$, esc, formatDate} from '../dom.js';
import {state} from '../state.js';

const loaded = new Map(); // league key -> standings payload (server also caches for 12h)

const selectedLeague = () => state.leagues.find((l) => l.key === state.league);
const eligible = () => !state.demo && state.connected && !!selectedLeague()?.fdCode;

function renderTable(group) {
  const rows = group.table
    .map(
      (r) =>
        `<tr><td class="num">${esc(r.position)}</td><td class="team-name">${esc(r.team)}</td><td class="num">${esc(r.played)}</td><td class="num opt">${esc(r.won)}</td><td class="num opt">${esc(r.drawn)}</td><td class="num opt">${esc(r.lost)}</td><td class="num">${esc(r.goalDifference)}</td><td class="num pts">${esc(r.points)}</td></tr>`,
    )
    .join('');
  return `${group.name ? `<h4>${esc(group.name)}</h4>` : ''}<div class="table-scroll"><table><thead><tr><th class="num">#</th><th>Team</th><th class="num" title="Played">P</th><th class="num opt" title="Won">W</th><th class="num opt" title="Drawn">D</th><th class="num opt" title="Lost">L</th><th class="num" title="Goal difference">GD</th><th class="num" title="Points">Pts</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderStandings(data) {
  if (!data.groups.length)
    return '<p class="muted">No standings are published for this competition yet.</p>';
  const note = `<p class="muted">${esc(data.competition)}${data.season ? ' · ' + esc(data.season) + ' season' : ''} · updated ${esc(formatDate(data.fetchedAt))}${data.stale ? ' (saved copy)' : ''}</p>`;
  return note + data.groups.map(renderTable).join('');
}

/** Loads standings for the selected league into the open panel. Errors stay inside the panel. */
export async function loadStandings() {
  const body = $('#standings-body');
  const key = state.league;
  if (!eligible()) return;
  if (!loaded.has(key)) body.innerHTML = '<p class="muted">Loading standings…</p>';
  try {
    if (!loaded.has(key)) loaded.set(key, await api('standings', {league: key}));
    if (key === state.league) body.innerHTML = renderStandings(loaded.get(key));
  } catch (e) {
    if (key === state.league) body.innerHTML = `<div class="message">${esc(e.message)}</div>`;
  }
}

/** Shows the panel only for competitions that have standings; reloads it if it is open. */
export function updateStandingsBox() {
  const box = $('#standings-box');
  const show = eligible();
  box.classList.toggle('hidden', !show);
  if (!show) {
    box.open = false;
    return;
  }
  if (box.open) loadStandings();
}
