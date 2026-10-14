import {analyze} from '/analysis.js';
import {$, esc, formatDate} from '../dom.js';
import {state} from '../state.js';

const outcomeLabels = (f) => [f.home, 'Draw', f.away];

const probabilityBar = (f) => (p, n) =>
  `<div class="probability"><span>${esc(outcomeLabels(f)[n])}</span><strong>${p}%</strong><progress max="100" value="${p}">${p}%</progress></div>`;

const tipCard = (t) =>
  `<article class="tip"><small>${esc(t.market)}</small><h4>${esc(t.selection)} · ${t.probability}%</h4><p>${esc(t.note)}</p></article>`;

const pickButton = (f) => (n) =>
  `<button class="secondary" data-save="${n}" ${f.demo ? 'disabled' : ''}>${esc(outcomeLabels(f)[n])}</button>`;

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
    `<h3>Make a virtual pick</h3><div class="pick-buttons">${[0, 1, 2].map(pickButton(f)).join('')}</div>` +
    `<div id="save-message" role="status">${demoNote}</div>` +
    sourceBlock(f);
  if (!$('#analysis').open) $('#analysis').showModal();
}
