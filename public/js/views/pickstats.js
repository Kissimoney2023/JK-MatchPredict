import {accuracyTrend, summarizePicks} from '/pickstats.js';
import {trendChart} from '../trend.js';
import {$, esc} from '../dom.js';

const pct = (v) => (v === null || v === undefined ? '—' : Math.round(v * 100) + '%');

const tile = (label, value, sub) =>
  `<div class="stat-tile"><span class="stat-label">${esc(label)}</span><strong>${value}</strong><span class="stat-sub">${sub}</span></div>`;

function table(title, head, rows) {
  if (!rows.length) return '';
  const header = head.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('');
  const body = rows
    .map(
      (cells) =>
        '<tr>' +
        cells.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('') +
        '</tr>',
    )
    .join('');
  return `<div class="stat-block"><h4>${esc(title)}</h4><div class="table-scroll"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div></div>`;
}

const recentChip = (result) =>
  result === 'correct'
    ? '<i class="chip w" role="img" aria-label="correct">✓</i>'
    : '<i class="chip l" role="img" aria-label="incorrect">✗</i>';

/** Renders the accuracy dashboard for the signed-in or anonymous person's picks. */
export function renderPickStats(picks) {
  const box = $('#pick-stats');
  if (!picks.length) {
    box.innerHTML = '';
    return;
  }
  const s = summarizePicks(picks);
  if (!s.settled) {
    box.innerHTML =
      '<p class="muted">Accuracy statistics appear once the matches you picked have finished. Use “Check results” to update them.</p>';
    return;
  }

  const streak = s.currentStreak
    ? `${s.currentStreak.length} ${s.currentStreak.type === 'correct' ? 'correct' : 'wrong'}`
    : '—';
  const tiles = [
    tile(
      'Accuracy',
      pct(s.accuracy.rate),
      `95% range ${pct(s.accuracy.low)}–${pct(s.accuracy.high)}`,
    ),
    tile(
      'Record',
      `${s.correct}–${s.incorrect}`,
      `${s.settled} settled${s.pending ? ` · ${s.pending} pending` : ''}${s.voided ? ` · ${s.voided} void` : ''}`,
    ),
    tile('Current run', streak, `Best run: ${s.bestWinStreak} correct`),
    tile(
      'Versus forecasts',
      `${s.correct} / ${s.expectedCorrect}`,
      'correct / expected from the forecasts',
    ),
  ].join('');

  const chart = trendChart(accuracyTrend(picks));
  const trend = chart
    ? `<div class="stat-block"><h4>Accuracy over time</h4>${chart}<p class="muted trend-legend"><span class="key accuracy"></span> Your accuracy so far <span class="key expected"></span> What the forecasts expected for these picks. Starts at your third settled pick.</p></div>`
    : '';
  const recent = `<div class="stat-block"><h4>Last ${s.recent.length} results</h4><div class="form">${s.recent.map(recentChip).join('')}</div></div>`;

  const confidence = table(
    'By how confident the forecast was',
    ['Forecast chance', 'Picks', 'You got', 'Forecast said'],
    s.byConfidence.map((b) => [b.range, b.settled, pct(b.accuracy), pct(b.averagePredicted)]),
  );
  const competitions = table(
    'By competition',
    ['Competition', 'Picks', 'Accuracy'],
    s.byCompetition.map((c) => [c.name, c.settled, pct(c.accuracy)]),
  );
  const outcomes = table(
    'By kind of pick',
    ['Pick', 'Settled', 'Accuracy'],
    s.byOutcome.filter((o) => o.settled).map((o) => [o.label, o.settled, pct(o.accuracy)]),
  );

  const {following, against} = s.followedModel;
  const followText = following.settled
    ? `<p class="muted">Backing the forecast’s favourite: ${pct(following.accuracy)} of ${following.settled}.${against.settled ? ` Going against it: ${pct(against.accuracy)} of ${against.settled}.` : ''}</p>`
    : '';

  const caution = s.smallSample
    ? `<p class="muted">Only ${s.settled} settled pick${s.settled === 1 ? '' : 's'} so far. Percentages swing a lot with so few, which is why the range is shown. About ${s.minReliableSample} or more gives a steadier picture.</p>`
    : '';

  box.innerHTML = `<h3>Your results</h3><div class="stat-tiles">${tiles}</div>${caution}${trend}${recent}<div class="stat-grid">${confidence}${competitions}${outcomes}</div>${followText}`;
}
