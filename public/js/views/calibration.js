import {reliabilityChart} from '/calibration.js';
import {api} from '../api.js';
import {$, esc, formatDate} from '../dom.js';
import {state} from '../state.js';

const REFRESH_MS = 5 * 60_000;
let loadedAt = 0;

const pct = (v) => (Number.isFinite(v) ? Math.round(v * 100) + '%' : '—');
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : '—');

const COMPETITION_NAMES = {
  CL: 'Champions League',
  PL: 'Premier League',
  PD: 'La Liga',
  BL1: 'Bundesliga',
  SA: 'Serie A',
  FL1: 'Ligue 1',
  DED: 'Eredivisie',
  PPL: 'Primeira Liga',
  ELC: 'Championship',
  BSA: 'Série A (Brazil)',
};

function sourceBlock(s, competitions) {
  const chart = reliabilityChart(s.bins);
  const outcomes = s.outcomes
    .map(
      (o) =>
        `<tr><td>${esc(o.label)}</td><td class="num">${pct(o.said)}</td><td class="num">${pct(o.happened)}</td></tr>`,
    )
    .join('');
  const totals = s.totals
    ? `<tr><td>Over 2.5 goals</td><td class="num">${pct(s.totals.said)}</td><td class="num">${pct(s.totals.happened)}</td></tr>`
    : '';
  const mine = competitions.filter((c) => c.source === s.key && c.n >= 10);
  const byCompetition = mine.length
    ? `<h5>By competition</h5><div class="table-scroll"><table><thead><tr><th>Competition</th><th class="num">Matches</th><th class="num">Accuracy</th><th class="num">Log loss</th></tr></thead><tbody>${mine
        .map(
          (c) =>
            `<tr><td>${esc(COMPETITION_NAMES[c.competition] ?? c.competition)}</td><td class="num">${c.n}</td><td class="num">${pct(c.accuracy)}</td><td class="num">${f3(c.logLoss)}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '';
  return `<div class="cal-source"><h4>${esc(s.label)}</h4><p class="muted">${s.n} settled match${s.n === 1 ? '' : 'es'} · accuracy ${pct(s.accuracy)} · log loss ${f3(s.logLoss)} · Brier ${f3(s.brier)}${s.small ? ' · <strong>fewer than 50: too few to judge</strong>' : ''}</p><div class="cal-wrap">${chart ? `<div>${chart}<p class="muted">Each dot is a band of forecasts: how likely the source said an outcome was (across) against how often it happened (up). On the diagonal is calibrated; above it, the source is too cautious; below it, too confident.</p></div>` : '<p class="muted">The reliability chart appears once a few probability bands hold five or more forecasts.</p>'}<div><h5>Said versus happened</h5><div class="table-scroll"><table><thead><tr><th>Outcome</th><th class="num">Said</th><th class="num">Happened</th></tr></thead><tbody>${outcomes}${totals}</tbody></table></div>${byCompetition}</div></div></div>`;
}

/** The record's markup from the report. */
export function calibrationHtml(report) {
  if (!report.sources.length)
    return `<p class="muted">No forecast has been settled yet${report.awaiting ? ` (${report.awaiting} awaiting results)` : ''}. The record fills in as matches finish.</p>`;
  const when = report.updatedAt ? ` Updated ${esc(formatDate(report.updatedAt))}.` : '';
  return `<p class="muted">${report.awaiting} forecast${report.awaiting === 1 ? '' : 's'} awaiting results.${when} Lower log loss and Brier are better; accuracy is how often the most likely outcome happened. Bookmaker-based forecasts should sit on the diagonal; the models are measured against them.</p>${report.sources.map((s) => sourceBlock(s, report.competitions)).join('')}`;
}

export async function loadCalibration() {
  const box = $('#calibration');
  if (!box || state.demo || Date.now() - loadedAt < REFRESH_MS) return;
  try {
    const report = await api('calibration');
    loadedAt = Date.now();
    box.innerHTML = calibrationHtml(report);
  } catch (e) {
    box.innerHTML = `<p class="muted">The record could not be loaded: ${esc(e.message)}</p>`;
  }
}
