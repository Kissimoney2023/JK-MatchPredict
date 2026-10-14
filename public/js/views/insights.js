import {api} from '../api.js';
import {$, esc} from '../dom.js';
import {state} from '../state.js';

const WORDS = {W: 'win', D: 'draw', L: 'loss'};

/** Five coloured W/D/L chips, oldest to newest (input is newest first). Letters, not just colour. */
export function formChips(results) {
  if (!results?.length) return '';
  const ordered = [...results].reverse();
  const label = ordered.map((r) => WORDS[r]).join(', ');
  const chips = ordered.map((r) => `<i class="chip ${r.toLowerCase()}">${esc(r)}</i>`).join('');
  return `<span class="form" role="img" aria-label="Last ${ordered.length} results, oldest to newest: ${label}">${chips}</span>`;
}

function teamColumn(team) {
  const games = team.games.length
    ? team.games
        .map(
          (g) =>
            `<li><i class="chip ${g.result.toLowerCase()}">${esc(g.result)}</i> ${esc(g.score)} <span class="muted">${g.venue === 'H' ? 'vs' : 'at'} ${esc(g.opponent)}</span></li>`,
        )
        .join('')
    : '<li class="muted">No recent results found.</li>';
  const r = team.record;
  return `<div><h4>${esc(team.name)}</h4><p class="muted">Last ${team.games.length}: ${r.w}W ${r.d}D ${r.l}L</p><ul class="games">${games}</ul></div>`;
}

function headToHeadBlock(data) {
  const h = data.headToHead;
  if (!h.matches.length) return `<p class="muted">No meetings found in the last 12 months.</p>`;
  const list = h.matches
    .map((m) => `<li>${esc(m.date)} · ${esc(m.home)} ${esc(m.score)} ${esc(m.away)}</li>`)
    .join('');
  return `<p class="muted">${esc(data.home.name)} ${h.winsA}W · ${h.draws}D · ${esc(data.away.name)} ${h.winsB}W (last 12 months)</p><ul class="games">${list}</ul>`;
}

function render(data) {
  return `<h3>Form &amp; head-to-head</h3><div class="insight-grid">${teamColumn(data.home)}${teamColumn(data.away)}</div><h4>Recent meetings</h4>${headToHeadBlock(data)}`;
}

/** Fills the optional "form" section of the open analysis dialog. Never blocks the forecast. */
export async function loadInsights(matchKey) {
  const box = $('#insights');
  if (!box || state.demo) return;
  box.innerHTML = '<p class="muted">Loading recent form…</p>';
  try {
    const data = await api('insights', {key: matchKey, listing: state.listing});
    if (state.analysis?.key === matchKey) box.innerHTML = render(data);
  } catch {
    if (state.analysis?.key === matchKey) box.innerHTML = '';
  }
}
