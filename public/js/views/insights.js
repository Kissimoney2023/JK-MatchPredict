import {api} from '../api.js';
import {$, esc, formatDate} from '../dom.js';
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

const pct = (rate) => Math.round(rate * 100);
const ROWS = [
  {label: 'Points per game', key: 'ppg', scale: 3, show: (v) => v.toFixed(2)},
  {label: 'Win rate', key: 'winRate', scale: 1, show: (v) => pct(v) + '%'},
  {label: 'Goals scored per game', key: 'scored', show: (v) => v.toFixed(2)},
  {
    label: 'Goals conceded per game',
    key: 'conceded',
    show: (v) => v.toFixed(2),
    lowerIsBetter: true,
  },
  {label: 'Clean sheets', key: 'cleanSheetRate', scale: 1, show: (v) => pct(v) + '%'},
  {label: 'Both teams scored', key: 'bttsRate', scale: 1, show: (v) => pct(v) + '%'},
  {label: 'Over 2.5 goals', key: 'over25Rate', scale: 1, show: (v) => pct(v) + '%'},
];

/** One half of a comparison row: the value and a bar (bars share a scale within a row). */
function side(stats, row, max) {
  if (!stats) return '<div class="compare-side"><span class="muted">n/a</span></div>';
  const v = stats[row.key];
  return `<div class="compare-side"><strong>${row.show(v)}</strong><progress max="${max}" value="${v}" aria-hidden="true"></progress></div>`;
}

function comparison(stats, names, venue) {
  const home = stats.home[venue];
  const away = stats.away[venue];
  if (!home && !away) return '<p class="muted">Not enough matches for this view.</p>';
  const rows = ROWS.map((row) => {
    const max = row.scale ?? Math.max(home?.[row.key] ?? 0, away?.[row.key] ?? 0, 0.01);
    return `<div class="compare-row"><span class="compare-label">${esc(row.label)}</span>${side(home, row, max)}${side(away, row, max)}</div>`;
  }).join('');
  const basis = (team, s) =>
    s
      ? `${esc(team)}: last ${s.played} (${s.wins}W ${s.draws}D ${s.losses}L)`
      : `${esc(team)}: no matches`;
  return `<div class="compare-head"><span></span><strong>${esc(names.home)}</strong><strong>${esc(names.away)}</strong></div>${rows}<p class="muted">${basis(names.home, home)} · ${basis(names.away, away)}</p>`;
}

/** Side-by-side team numbers with an Overall / Home-and-away switch. */
function statsBlock(stats, names) {
  if (!stats?.home?.overall && !stats?.away?.overall) return '';
  return `<h3>Team comparison</h3><div class="compare" data-view="overall"><div class="view-switch" role="group" aria-label="Matches to compare"><button type="button" class="secondary" data-stats-view="overall" aria-pressed="true">Overall</button><button type="button" class="secondary" data-stats-view="venue" aria-pressed="false">${esc(names.home)} at home · ${esc(names.away)} away</button></div><div class="compare-view" data-for="overall">${comparison(stats, names, 'overall')}</div><div class="compare-view" data-for="venue">${comparison(stats, names, 'venue')}</div></div><p class="muted">Completed regulation-time matches from football-data.org (up to ten per team). Small samples swing a lot.</p>`;
}

/** How often recent matches of the two teams went over each line (observed, not a forecast). */
function observedGoals(goals) {
  if (!goals) return '';
  const lines = goals.lines
    .map(
      (l) =>
        `<div class="goal-line"><span class="goal-name">Goals ${l.line}</span><span>Over <strong>${pct(l.over)}%</strong></span><progress max="100" value="${pct(l.over)}" aria-label="Over ${l.line}: ${pct(l.over)}%">${pct(l.over)}%</progress><span>Under <strong>${pct(l.under)}%</strong></span></div>`,
    )
    .join('');
  return `<h3>Recent goal trends</h3><div class="goal-lines">${lines}<div class="goal-line"><span class="goal-name">Both score</span><span>Yes <strong>${pct(goals.btts)}%</strong></span><progress max="100" value="${pct(goals.btts)}" aria-label="Both teams scored: ${pct(goals.btts)}%">${pct(goals.btts)}%</progress><span>No <strong>${100 - pct(goals.btts)}%</strong></span></div></div><p class="muted">What actually happened across ${goals.matches} recent matches of these two teams. Past frequencies, not a prediction.</p>`;
}

const ordinal = (n) => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
};

/** Table positions of the two teams, as two tiles (a team the table does not list is skipped). */
function positionBlock(position, names) {
  if (!position) return '';
  const tile = (name, row) =>
    row
      ? `<div class="stat-tile"><span class="stat-label">${esc(name)}</span><strong>${esc(ordinal(row.position))} of ${row.of}</strong><span class="stat-sub">${row.points} pts · ${row.won}W ${row.drawn}D ${row.lost}L · GD ${row.goalDifference > 0 ? '+' : ''}${row.goalDifference}${row.group ? ' · ' + esc(row.group) : ''}</span></div>`
      : '';
  const when = position.fetchedAt ? ' · updated ' + esc(formatDate(position.fetchedAt)) : '';
  const copy = position.stale ? ' (saved copy)' : '';
  return `<h3>League position</h3><div class="stat-tiles position-tiles">${tile(names.home, position.home)}${tile(names.away, position.away)}</div><p class="muted">${esc(position.competition)}${position.season ? ' · ' + esc(position.season) + ' season' : ''}${when}${copy} · source: ${esc(position.source)}</p>`;
}

const dec = (v, places = 2) => (Number.isFinite(v) ? v.toFixed(places) : '—');

/** Expected goals for and against per match for both clubs, and the gap to real goals. */
function xgBlock(xg, names) {
  if (!xg) return '';
  const side = (name, s) => {
    if (!s)
      return `<div class="stat-tile"><span class="stat-label">${esc(name)}</span><strong>—</strong><span class="stat-sub">not in this competition’s averages</span></div>`;
    const xgd = s.xgFor !== null && s.xgAgainst !== null ? s.xgFor - s.xgAgainst : null;
    const gd = s.goalsFor !== null && s.goalsAgainst !== null ? s.goalsFor - s.goalsAgainst : null;
    const gap = xgd !== null && gd !== null ? gd - xgd : null;
    const luck =
      gap === null
        ? ''
        : s.games !== null && s.games < 10
          ? ` · gap to real goals ${gap > 0 ? '+' : ''}${dec(gap)} (too few matches to call luck)`
          : Math.abs(gap) >= 0.3
            ? ` · ${gap > 0 ? 'scoring well above' : 'scoring well below'} its chances (${gap > 0 ? '+' : ''}${dec(gap)} per match)`
            : ` · goals in line with chances (${gap > 0 ? '+' : ''}${dec(gap)})`;
    return `<div class="stat-tile"><span class="stat-label">${esc(name)}</span><strong>${dec(s.xgFor)} / ${dec(s.xgAgainst)}</strong><span class="stat-sub">xG for / against per match · goals ${dec(s.goalsFor)} / ${dec(s.goalsAgainst)}${s.games !== null ? ` · ${s.games} matches` : ''}${esc(luck)}</span></div>`;
  };
  return `<h3>Expected goals</h3><div class="stat-tiles position-tiles">${side(names.home, xg.home)}${side(names.away, xg.away)}</div><p class="muted">Per-match averages in this competition this season (StrikerAPI${xg.stale ? ', saved copy' : ''}). xG is the quality of the chances created and allowed; a side scoring far above its xG for long is usually due a correction, but under about ten matches the gap is noise.</p>`;
}

/** Confirmed starting elevens, once named. */
function lineupsBlock(l, names) {
  if (!l) return '';
  const side = (name, s) =>
    `<div><h4>${esc(name)}${s.formation ? ` <span class="muted">${esc(s.formation)}</span>` : ''}</h4><ol class="lineup">${s.starters.map((p) => `<li>${p.number !== null ? `<span class="muted">${p.number}</span> ` : ''}${esc(p.name)}${p.position ? ` <small class="muted">${esc(p.position)}</small>` : ''}</li>`).join('')}</ol></div>`;
  return `<h3>Confirmed line-ups</h3><div class="insight-grid">${side(names.home, l.home)}${side(names.away, l.away)}</div><p class="muted">Named about an hour before kickoff (StrikerAPI). Forecasts made earlier did not know them.</p>`;
}

function render(data) {
  const sections = [];
  const forecast = state.analysis ?? {};
  const names = {home: forecast.home, away: forecast.away};
  sections.push(lineupsBlock(data.lineups, names));
  sections.push(positionBlock(data.leaguePosition, names));
  sections.push(xgBlock(data.xg, names));
  if (data.stats) sections.push(statsBlock(data.stats, names), observedGoals(data.stats.goals));
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

/** Overall / home-and-away switch for the team comparison. */
function wireStatsSwitch(box) {
  const compare = box.querySelector('.compare');
  if (!compare) return;
  compare.addEventListener('click', (e) => {
    const button = e.target.closest('[data-stats-view]');
    if (!button) return;
    compare.dataset.view = button.dataset.statsView;
    for (const b of compare.querySelectorAll('[data-stats-view]'))
      b.setAttribute('aria-pressed', String(b === button));
  });
}

/** Fills the optional "form" section of the open analysis dialog. Never blocks the forecast. */
export async function loadInsights(matchKey, listing = state.listing) {
  const box = $('#insights');
  if (!box || state.demo) return;
  box.innerHTML = '<p class="muted">Loading recent form…</p>';
  try {
    const data = await api('insights', {key: matchKey, listing});
    if (state.analysis?.key === matchKey) {
      box.innerHTML = render(data);
      wireStatsSwitch(box);
    }
  } catch {
    if (state.analysis?.key === matchKey) box.innerHTML = '';
  }
}
export const xgBlockForTest = xgBlock;
export const lineupsBlockForTest = lineupsBlock;
