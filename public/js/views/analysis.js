import {analyze, fairOdds} from '/analysis.js';
import {$, esc, formatDate} from '../dom.js';
import {state} from '../state.js';
import {otherMatches, otherMatchesTitle} from '../othermatches.js';

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
    `<h3>Make a virtual pick</h3><div class="pick-buttons">${[0, 1, 2].map(pickButton(f)).join('')}</div>` +
    `<div id="save-message" role="status">${demoNote}</div>` +
    otherMatchesBlock(f) +
    '<div id="insights"></div>' +
    sourceBlock(f);
  if (!$('#analysis').open) $('#analysis').showModal();
  $('#analysis').scrollTop = 0; // opening another match from the list starts at its top
}
