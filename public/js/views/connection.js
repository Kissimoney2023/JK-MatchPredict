import {$, esc} from '../dom.js';
import {state} from '../state.js';

export function renderConnection(error = '') {
  const div = $('#connection');
  div.classList.toggle('error', !state.connected && !state.demo);

  if (state.demo) {
    div.innerHTML =
      '<strong>DEMO PREVIEW.</strong> All matches, probabilities and tips below are illustrative. <button class="text-button" data-live>Return to real data →</button>';
    return;
  }

  const providers = state.providers
    .map(
      (p) =>
        `${esc(p.name)}: ${p.configured ? 'key configured' : p.role === 'Enrichment' ? 'optional' : 'key needed'}`,
    )
    .join(' · ');
  const title = state.connected ? 'Football data connected' : 'Connect your football data';
  const hint = state.connected
    ? 'Coverage depends on your API plans. Select a match for a forecast.'
    : 'In Vercel, add API_FOOTBALL_KEY and FOOTBALL_DATA_ORG_KEY as environment variables, then redeploy.';
  const storage =
    state.connected && state.storage === 'memory'
      ? '<br>Temporary storage: picks may reset. Add Upstash Redis in Vercel Storage.'
      : '';
  div.innerHTML = `<strong>${title}</strong> ${providers}<br>${hint}${storage} ${error ? '<br>' + esc(error) : ''} <button class="text-button" data-demo>Preview sample matches →</button>`;
}
