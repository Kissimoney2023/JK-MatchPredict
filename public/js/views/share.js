import {summarizePicks} from '/pickstats.js';
import {api} from '../api.js';
import {$, esc} from '../dom.js';
import {state} from '../state.js';
import {drawShareCard, loadCardFonts} from './sharecard.js';

const pct = (v) => Math.round(v * 100) + '%';
const problem = (text) => `<div class="message">${esc(text)}</div>`;
const closeDialog = () => $('#share-dialog').open && $('#share-dialog').close();

let summary = null;
let shareState = null; // {exists, enabled, url, showName} for signed-in people

function summaryText(link) {
  const s = summary;
  const base = `My virtual picks on JK MatchPredict: ${s.correct}–${s.incorrect} (${pct(s.accuracy.rate)} accuracy, 95% range ${pct(s.accuracy.low)}–${pct(s.accuracy.high)}). Virtual picks only, not betting advice.`;
  return link ? `${base} ${link}` : base;
}

function redraw() {
  drawShareCard($('#share-canvas'), summary, {
    name: $('#share-name')?.value.trim().slice(0, 30) ?? '',
    host: location.host,
  });
}

function linkSection() {
  if (!state.accounts?.enabled) return '';
  if (!state.account)
    return '<div class="stat-block"><h4>Public link</h4><p class="muted">Sign in with GitHub (button at the top) to create a link anyone can open. The image above works without an account.</p></div>';
  const live = shareState?.enabled;
  return `<div class="stat-block"><h4>Public link</h4>
    <p class="muted">A page anyone with the link can open: your accuracy, record, streaks and last 10 settled picks. Never your email or upcoming picks. You can switch it off at any time.</p>
    <label class="check"><input id="share-show-name" type="checkbox" ${shareState?.showName ? 'checked' : ''} /> Show my GitHub name (otherwise “A MatchPredict player”)</label>
    ${
      live
        ? `<div class="share-link"><input id="share-url" type="text" readonly value="${esc(shareState.url)}" aria-label="Public link" /><button id="copy-link" class="secondary">Copy link</button></div>
           <div class="actions"><button id="refresh-link" class="secondary">Update with my latest results</button><button id="stop-link" class="secondary">Stop sharing</button></div>`
        : `<div class="actions"><button id="create-link" class="primary">Create public link</button></div>`
    }
    <div id="share-link-message" role="status"></div></div>`;
}

function render() {
  $('#share-body').innerHTML = `<div class="eyebrow">SHARE</div><h2>Share your results</h2>
    <canvas id="share-canvas" aria-label="Preview of your result card"></canvas>
    <label class="share-name">Name on the card (optional)<input id="share-name" type="text" maxlength="30" placeholder="Leave empty for “My virtual picks”" /></label>
    <div class="actions share-actions"><button id="download-card" class="primary">Download image</button><button id="native-share" class="secondary hidden">Share…</button><button id="copy-text" class="secondary">Copy text</button></div>
    <div id="share-message" role="status"></div>
    ${linkSection()}`;
  redraw();
  const canShareFiles = !!(navigator.canShare && navigator.share);
  $('#native-share').classList.toggle('hidden', !canShareFiles);
}

async function cardBlob() {
  return new Promise((resolve) => $('#share-canvas').toBlob(resolve, 'image/png'));
}

async function copy(text, target) {
  try {
    await navigator.clipboard.writeText(text);
    $(target).innerHTML = '<p class="muted">Copied.</p>';
  } catch {
    $(target).innerHTML = problem(
      'Could not copy automatically. Select the text and copy it yourself.',
    );
  }
}

async function linkAction(action) {
  const box = $('#share-link-message');
  box.innerHTML = '';
  try {
    shareState =
      action === 'disable'
        ? await api('share-disable', {}, {action: 'share-disable'})
        : await api(
            'share-create',
            {},
            {action: 'share-create', showName: !!$('#share-show-name')?.checked},
          );
    render();
    $('#share-link-message').innerHTML =
      action === 'disable'
        ? '<p class="muted">The link has been switched off.</p>'
        : '<p class="muted">Link updated.</p>';
  } catch (e) {
    box.innerHTML = problem(e.message);
  }
}

async function onClick(e) {
  const id = e.target.closest('button')?.id;
  if (id === 'download-card') {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await cardBlob());
    link.download = 'jk-matchpredict-results.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  if (id === 'native-share') {
    const blob = await cardBlob();
    const file = new File([blob], 'jk-matchpredict-results.png', {type: 'image/png'});
    const data = {files: [file], text: summaryText(shareState?.enabled ? shareState.url : null)};
    try {
      if (navigator.canShare(data)) await navigator.share(data);
      else await navigator.share({text: data.text});
    } catch {
      /* the person cancelled the share sheet */
    }
  }
  if (id === 'copy-text')
    await copy(summaryText(shareState?.enabled ? shareState.url : null), '#share-message');
  if (id === 'copy-link') await copy($('#share-url').value, '#share-link-message');
  if (id === 'create-link' || id === 'refresh-link') await linkAction('create');
  if (id === 'stop-link') await linkAction('disable');
}

/** Opens the share dialog for the current picks. */
export async function openShare() {
  summary = summarizePicks(state.picks);
  if (!summary.settled) {
    $('#share-body').innerHTML =
      '<div class="eyebrow">SHARE</div><h2>Share your results</h2><p class="muted">Results appear here once the matches you picked have finished. Use “Check results” on this page first.</p>';
    $('#share-dialog').showModal();
    return;
  }
  shareState = null;
  if (state.account) {
    try {
      shareState = await api('share');
    } catch {
      shareState = null;
    }
  }
  await loadCardFonts();
  render();
  $('#share-dialog').showModal();
}

export function initShare() {
  $('#share-results').onclick = openShare;
  $('#close-share').onclick = closeDialog;
  $('#share-dialog').addEventListener('click', onClick);
  $('#share-dialog').addEventListener('input', (e) => {
    if (e.target.id === 'share-name') redraw();
  });
}
