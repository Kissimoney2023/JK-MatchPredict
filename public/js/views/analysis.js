import {analyze, fairOdds} from '/analysis.js';
import {$, esc, formatDate} from '../dom.js';
import {state} from '../state.js';
import {otherMatches, otherMatchesTitle} from '../othermatches.js';
import {initValueCheck, valueBlockHtml} from './value.js';

const outcomeLabels = (f) => [f.home, 'Draw', f.away];

/** Decimal odds with two decimals, the way a betting slip prints them. */
const odds = (percent) => {
  const o = fairOdds(Number(percent));
  return o === null ? '—' : o.toFixed(2);
};

const probabilityBar = (f) => (p, n) =>
  `<div class="probability"><span>${esc(outcomeLabels(f)[n])}</span><strong>${p}%</strong><small class="fair-odds">Fair odds ${odds(p)}</small><progress max="100" value="${p}">${p}%</progress></div>`;

const tipCard = (t) =>
  `<article class="tip"><small>${esc(t.market)}</small><h4>${esc(t.selection)} · ${t.probability}%</h4><p>${esc(t.note)}</p></article>`;

const pickButton = (f) => (n) =>
  `<button class="secondary" data-save="${n}" ${f.demo ? 'disabled' : ''}>${esc(outcomeLabels(f)[n])}</button>`;

const PICK_LINE = 2.5; // the Over/Under line people can make a virtual pick on

const GOALS_SOURCE = {
  'market-total':
    'From the bookmakers’ total line (the goal total priced at even money), with the margin removed and goals assumed Poisson-distributed. Bookmaker prices, not an independent model.',
  model:
    'From the JK goal model’s scoreline estimates over 90 minutes. In testing on 1,835 matches it ran a little under the bookmakers on totals and said “over 2.5” slightly less often than it happened. Lineups and player availability are not considered.',
  'model-legacy':
    'From the older goal-average model’s expected goals with independent scoring. Not calibrated or backtested.',
};

const SCORES_SOURCE = {
  market:
    'Scorelines fitted to the bookmakers’ own three-way line and total (goal rates and a low-score correction solved to reproduce them), so they agree with the chances above.',
  model:
    'Scorelines from the JK goal model’s matrix over 90 minutes; the model tested a little worse than the bookmakers.',
};

/** Heat class for a grid cell: ten steps by probability, used by the stylesheet. */
const heat = (p) => 'heat-' + Math.min(9, Math.floor(Math.max(0, p) / 2));

/** Correct-score heatmap, most likely scores with fair odds, and Asian handicap lines. */
function scoresBlock(f) {
  const s = f.scores;
  if (!s?.grid?.length) return '';
  const header = s.grid[0].map((_, a) => `<th scope="col">${a}</th>`).join('');
  const rows = s.grid
    .map(
      (row, h) =>
        `<tr><th scope="row">${h}</th>${row.map((p) => `<td class="${heat(p)}">${p.toFixed(1)}</td>`).join('')}</tr>`,
    )
    .join('');
  const top = s.top
    .map(
      (t) =>
        `<li><strong>${t.home}–${t.away}</strong> ${t.p}% <small class="fair-odds">fair ${t.fairOdds.toFixed(2)}</small></li>`,
    )
    .join('');
  const lines = s.handicaps
    .filter((h) => Math.abs(h.line) <= 2.5)
    .map(
      (h) =>
        `<tr class="${h.line === s.levelLine ? 'level' : ''}"><td>${h.line > 0 ? '+' : ''}${h.line}</td><td class="num">${h.home}% <small class="fair-odds">${h.fairHome?.toFixed(2) ?? '—'}</small></td><td class="num">${h.push ? h.push + '%' : '—'}</td><td class="num">${h.away}% <small class="fair-odds">${h.fairAway?.toFixed(2) ?? '—'}</small></td></tr>`,
    )
    .join('');
  return `<h3>Correct score</h3>
  <div class="scores-wrap">
    <div class="table-scroll"><table class="score-grid" aria-label="Chance of each scoreline, home goals down, away goals across"><thead><tr><th scope="col">${esc(f.home.slice(0, 3))} \\ ${esc(f.away.slice(0, 3))}</th>${header}</tr></thead><tbody>${rows}</tbody></table></div>
    <div><h4>Most likely scores</h4><ol class="top-scores">${top}</ol><p class="muted">Scores of 7 or more goals for a side: ${s.remainder}% in total.</p></div>
  </div>
  <h3>Asian handicap</h3>
  <div class="table-scroll"><table class="handicap"><thead><tr><th>${esc(f.home)} line</th><th class="num">${esc(f.home)} covers · fair</th><th class="num">Push</th><th class="num">${esc(f.away)} covers · fair</th></tr></thead><tbody>${lines}</tbody></table></div>
  <p class="muted">A line of −1.5 means ${esc(f.home)} must win by two or more. Whole lines can push (stake returned); their fair odds leave the push out. The highlighted line is the closest to even. ${esc(SCORES_SOURCE[f.scoresSource] ?? SCORES_SOURCE.model)} Fair odds carry no margin; not a recommendation to bet.</p>`;
}

/**
 * Over/Under in betting format: each line with the chance of over and under and the fair
 * decimal odds for each, plus pick buttons on the 2.5 line.
 */
function goalsBlock(f, goals) {
  if (!goals?.lines?.length)
    return '<h3>Over / Under</h3><p class="muted">No goal estimate for this match: neither a bookmakers’ total line nor enough match history is available.</p>';
  const side = (label, p) =>
    `<span class="ou-side"><span>${esc(label)}</span><strong>${p}%</strong><small class="fair-odds">${odds(p)}</small></span>`;
  const lines = goals.lines
    .map(
      (l) =>
        `<div class="goal-line"><span class="goal-name">${l.line} goals</span>${side('Over', l.over)}<progress max="100" value="${l.over}" aria-label="Over ${l.line}: ${l.over}%">${l.over}%</progress>${side('Under', l.under)}</div>`,
    )
    .join('');
  const btts =
    goals.btts === null || goals.btts === undefined
      ? ''
      : `<div class="goal-line"><span class="goal-name">Both score</span>${side('Yes', goals.btts)}<progress max="100" value="${goals.btts}" aria-label="Both teams score: ${goals.btts}%">${goals.btts}%</progress>${side('No', Math.round((100 - goals.btts) * 10) / 10)}</div>`;
  const pickLine = goals.lines.find((l) => l.line === PICK_LINE);
  const buttons = pickLine
    ? `<div class="pick-buttons ou-picks"><button class="secondary" data-save-totals="0" data-line="${PICK_LINE}" ${f.demo ? 'disabled' : ''}>Over ${PICK_LINE} · ${pickLine.over}% · ${odds(pickLine.over)}</button><button class="secondary" data-save-totals="1" data-line="${PICK_LINE}" ${f.demo ? 'disabled' : ''}>Under ${PICK_LINE} · ${pickLine.under}% · ${odds(pickLine.under)}</button></div>`
    : '';
  const total = goals.expectedTotal
    ? ` Bookmakers’ total line: ${esc(String(f.marketTotal ?? goals.expectedTotal))} goals.`
    : '';
  return `<h3>Over / Under · betting view</h3><div class="goal-lines">${lines}${btts}</div><p class="muted">Each side shows the forecast chance and its fair decimal odds (1 ÷ chance, no margin). A bookmaker price below the fair odds offers no value by this forecast.${total} ${esc(GOALS_SOURCE[f.goalsSource] ?? GOALS_SOURCE.model)}</p><h4>Virtual Over/Under pick</h4>${buttons}`;
}

const timeOf = (iso) => new Date(iso).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

/** Other matches from the same day in the list being browsed, each one tap from its own forecast. */
function otherMatchesBlock(f) {
  const rows = otherMatches(state.fixtures, f);
  if (!rows.length) return '';
  const items = rows
    .map(
      (m) =>
        `<li><div><strong>${esc(m.home)} vs ${esc(m.away)}</strong><small class="muted">${esc(m.competition)} · ${esc(timeOf(m.kickoff))}</small></div><button class="text-button" data-analyze="${esc(m.key)}">Analyse</button></li>`,
    )
    .join('');
  return `<h3>${esc(otherMatchesTitle(f))}</h3><ul class="other-matches">${items}</ul><p class="muted">From the matches you are browsing; times are in your local time.</p>`;
}

function sourceBlock(f) {
  return `<div class="analysis-source"><strong>Source:</strong> ${esc(f.source)}<br>Forecast created ${esc(formatDate(f.forecastAt))}${f.providerFetchedAt ? '<br>Provider data fetched ' + esc(formatDate(f.providerFetchedAt)) : ''}${f.historyFetchedAt ? '<br>History fetched ' + esc(formatDate(f.historyFetchedAt)) : ''}${f.explanation ? '<br>' + esc(f.explanation) : ''}</div>`;
}

export function showAnalysis(f) {
  state.analysis = f;
  const a = f.analysis || analyze(f);
  const demoNote = f.demo
    ? '<p class="muted">Demo picks are previews only. Real picks become available after connecting your APIs.</p>'
    : '';
  $('#analysis-body').innerHTML =
    `<div class="eyebrow">${f.demo ? 'ILLUSTRATIVE DEMO' : 'MATCH ANALYSIS'} · 90 MINUTES</div>` +
    `<h2>${esc(f.home)} vs ${esc(f.away)}</h2>` +
    `<p class="muted">${esc(f.competition)} · ${esc(formatDate(f.kickoff))}</p>` +
    `<div class="prediction"><div class="eyebrow">PREDICTED OUTCOME</div><h3>${esc(a.predictedOutcome)}</h3><span class="number">${a.probability}%</span><p>${esc(a.strength)} · ${a.margin} percentage-point lead over the next outcome.<br>${esc(a.verdict)}</p></div>` +
    `<div class="probabilities">${f.p.map(probabilityBar(f)).join('')}</div>` +
    `<h3>Betting tips · probability-based</h3><div class="tips">${a.tips.map(tipCard).join('')}</div>` +
    `<p class="muted">${esc(a.disclaimer)}</p>` +
    goalsBlock(f, f.goals ?? a.goals) +
    scoresBlock(f) +
    `<h3>Make a virtual pick</h3><div class="pick-buttons">${[0, 1, 2].map(pickButton(f)).join('')}</div>` +
    `<div id="save-message" role="status">${demoNote}</div>` +
    valueBlockHtml(f) +
    otherMatchesBlock(f) +
    '<div id="insights"></div>' +
    sourceBlock(f);
  initValueCheck(f);
  if (!$('#analysis').open) $('#analysis').showModal();
  $('#analysis').scrollTop = 0; // opening another match from the list starts at its top
}

/** Exposed for the tests only. */
export const scoresBlockForTest = scoresBlock;
