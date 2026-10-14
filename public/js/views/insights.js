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

/** All-time meetings in this competition (StrikerAPI). */
function competitionMeetings(h, home, away) {
  if (!h.meetings) return '<p class="muted">No meetings in this competition.</p>';
  const since = h.firstMeeting ? ' since ' + esc(h.firstMeeting.slice(0, 4)) : '';
  const list = h.matches
    .map((m) => `<li>${esc(m.date)} · ${esc(m.home)} ${esc(m.score)} ${esc(m.away)}</li>`)
    .join('');
  return `<p class="muted">${h.meetings} meetings${since}: ${esc(home)} ${h.winsHome}W · ${h.draws}D · ${esc(away)} ${h.winsAway}W (goals ${h.goalsHome}–${h.goalsAway})</p><ul class="games">${list}</ul>`;
}

function eloBlock(elo) {
  const pct = Math.round(elo.expectedHomeScore * 100);
  return `<p class="muted">${esc(elo.home.name)} ${Math.round(elo.home.elo)} · ${esc(elo.away.name)} ${Math.round(elo.away.elo)}. Expected score for the home side: ${pct}% (includes a 60-point home bonus). Ratings move only on this competition’s matches, so they are thin and not comparable across leagues.</p>`;
}

function marketBlock(m) {
  const [h, d, a] = m.p;
  const books = m.books ? ` across ${m.books} sportsbooks` : '';
  return `<p class="muted">Home ${h}% · Draw ${d}% · Away ${a}%${books}, margin removed. Bookmaker prices, shown for comparison only.</p>`;
}

function render(data) {
  const sections = [];
  const forecast = state.analysis ?? {};
  if (data.home && data.away)
    sections.push(
      `<h3>Form &amp; head-to-head</h3><div class="insight-grid">${teamColumn(data.home)}${teamColumn(data.away)}</div><h4>Recent meetings</h4>${headToHeadBlock(data)}`,
    );
  if (data.competitionHeadToHead)
    sections.push(
      `<h4>All-time meetings in this competition</h4>${competitionMeetings(data.competitionHeadToHead, forecast.home, forecast.away)}`,
    );
  if (data.elo) sections.push(`<h4>Competition Elo</h4>${eloBlock(data.elo)}`);
  if (data.market && !String(forecast.modelVersion || '').startsWith('market'))
    sections.push(`<h4>Market view</h4>${marketBlock(data.market)}`);
  return sections.join('');
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
