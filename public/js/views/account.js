import {api} from '../api.js';
import {$, esc} from '../dom.js';
import {state} from '../state.js';
import {loadPicks} from './picks.js';

const label = (account) => account.name || account.email || 'Account';
const shorten = (text) => (text.length > 22 ? text.slice(0, 21) + '…' : text);

const GITHUB_MARK =
  '<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

function dialogHtml(title, body) {
  return `<div class="eyebrow">ACCOUNT</div><h2>${esc(title)}</h2>${body}`;
}
function openDialog(html) {
  $('#auth-body').innerHTML = html;
  if (!$('#auth-dialog').open) $('#auth-dialog').showModal();
}
const closeDialog = () => $('#auth-dialog').open && $('#auth-dialog').close();
const problem = (text) => `<div class="message">${esc(text)}</div>`;

/** Updates the header button and the picks-page note to match the sign-in state. */
export function renderAccount() {
  const button = $('#account-button');
  const enabled = !!state.accounts?.enabled;
  button.classList.toggle('hidden', !enabled);
  button.textContent = state.account ? shorten(label(state.account)) : 'Sign in';
  button.setAttribute(
    'aria-label',
    state.account ? `Account: ${label(state.account)}` : 'Sign in with GitHub',
  );
  $('#picks-note').textContent = !enabled
    ? 'Picks lock when saved and live in a private server-side browser profile. Keep this browser’s cookies to retain access. This is not a cross-device account.'
    : state.account
      ? `Signed in as ${label(state.account)}. Picks lock when saved and follow you to every device where you sign in.`
      : 'Picks lock when saved. Without signing in they live in this browser’s profile; sign in with GitHub to keep them on every device.';
}

function showSignIn(error = '') {
  openDialog(
    dialogHtml(
      'Sign in',
      `<p class="muted">Sign in with GitHub to keep your virtual picks on every device. We only receive your name and email address. Picks saved in this browser are added to your account.</p>
      <div class="actions"><button id="github-login" class="primary github-button">${GITHUB_MARK}<span>Continue with GitHub</span></button></div>
      <div id="auth-message" role="status">${error ? problem(error) : ''}</div>`,
    ),
  );
}

function showSignedIn() {
  openDialog(
    dialogHtml(
      'You are signed in',
      `<p class="muted">Signed in as <strong>${esc(label(state.account))}</strong>${state.account.email && state.account.name ? ` (${esc(state.account.email)})` : ''}. Your virtual picks follow you across devices.</p>
      <div class="actions"><button id="sign-out" class="secondary">Sign out</button></div>
      <div id="auth-message" role="status"></div>`,
    ),
  );
}

/** Sends the browser to GitHub (through Supabase). The server keeps the PKCE verifier. */
async function startLogin() {
  const button = $('#github-login');
  button.disabled = true;
  $('#auth-message').innerHTML = '';
  try {
    const {url} = await api('login-start', {}, {action: 'login-start'});
    location.assign(url);
  } catch (e) {
    button.disabled = false;
    $('#auth-message').innerHTML = problem(e.message);
  }
}

async function signOut() {
  try {
    await api('logout', {}, {action: 'logout'});
  } catch (e) {
    $('#auth-message').innerHTML = problem(e.message);
    return;
  }
  state.account = null;
  renderAccount();
  closeDialog();
  await loadPicks().catch(() => {});
}

/**
 * Reads what the sign-in redirect left in the address (`?code=` on success, `?error=` or a
 * `#error=` fragment on failure) and removes it from the URL straight away.
 */
export function takeLoginReturn() {
  const query = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const code = query.get('code');
  const error = query.get('error_description') || fragment.get('error_description');
  const failed = query.get('error') || fragment.get('error');
  if (code === null && !failed) return null;
  history.replaceState(null, '', location.pathname);
  if (failed) return {error: error || 'Sign-in was cancelled or refused.'};
  return {code};
}

/** Completes sign-in with the code from the redirect and reports the outcome in the dialog. */
export async function finishLogin(returned) {
  if (returned.error) {
    showSignIn(returned.error);
    return;
  }
  openDialog(dialogHtml('Signing you in…', '<p class="muted">One moment.</p>'));
  try {
    const result = await api('login-complete', {}, {action: 'login-complete', code: returned.code});
    state.account = result.account;
    renderAccount();
    const added = result.merged
      ? ` ${result.merged} pick${result.merged === 1 ? '' : 's'} from this browser ${result.merged === 1 ? 'was' : 'were'} added to your account.`
      : '';
    openDialog(
      dialogHtml(
        'You are signed in',
        `<p class="muted">Welcome, <strong>${esc(label(result.account))}</strong>.${added}</p><div class="actions"><button id="close-auth-done" class="primary">Continue</button></div>`,
      ),
    );
    await loadPicks().catch(() => {});
  } catch (e) {
    showSignIn(e.message);
  }
}

/** Wires the header button and the dialog buttons (event delegation inside the dialog). */
export function initAccountUi() {
  $('#account-button').onclick = () => (state.account ? showSignedIn() : showSignIn());
  $('#close-auth').onclick = closeDialog;
  $('#auth-dialog').addEventListener('click', (e) => {
    const id = e.target.closest('button')?.id;
    if (id === 'github-login') startLogin();
    if (id === 'sign-out') signOut();
    if (id === 'close-auth-done') closeDialog();
  });
}
