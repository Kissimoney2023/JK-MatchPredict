import {api} from '../api.js';
import {$, esc} from '../dom.js';
import {state} from '../state.js';
import {loadPicks} from './picks.js';

const TOKEN_FORMAT = /^[a-f0-9]{64}$/;
const shortEmail = (email) => (email.length > 22 ? email.slice(0, 21) + '…' : email);

function dialogHtml(title, body) {
  return `<div class="eyebrow">ACCOUNT</div><h2>${esc(title)}</h2>${body}`;
}
function openDialog(html) {
  $('#auth-body').innerHTML = html;
  if (!$('#auth-dialog').open) $('#auth-dialog').showModal();
}
const closeDialog = () => $('#auth-dialog').open && $('#auth-dialog').close();

/** Updates the header button and the picks-page note to match the sign-in state. */
export function renderAccount() {
  const button = $('#account-button');
  const enabled = !!state.accounts?.enabled;
  button.classList.toggle('hidden', !enabled);
  button.textContent = state.account ? shortEmail(state.account.email) : 'Sign in';
  button.setAttribute(
    'aria-label',
    state.account ? `Account: ${state.account.email}` : 'Sign in with email',
  );
  $('#picks-note').textContent = !enabled
    ? 'Picks lock when saved and live in a private server-side browser profile. Keep this browser’s cookies to retain access. This is not a cross-device account.'
    : state.account
      ? `Signed in as ${state.account.email}. Picks lock when saved and follow you to every device where you sign in.`
      : 'Picks lock when saved. Without signing in they live in this browser’s profile; sign in with your email to keep them on every device.';
}

function showSignInForm(error = '') {
  openDialog(
    dialogHtml(
      'Sign in with email',
      `<p class="muted">We email you a one-time link. No password needed. Picks you saved in this browser are added to your account.</p>
      <form id="auth-form" class="auth-form">
        <label>Email address<input id="auth-email" type="email" autocomplete="email" required placeholder="you@example.com" /></label>
        <button class="primary" type="submit">Email me a sign-in link</button>
      </form>
      <div id="auth-message" role="status">${error ? `<div class="message">${esc(error)}</div>` : ''}</div>`,
    ),
  );
  $('#auth-email').focus();
}

function showSignedIn() {
  openDialog(
    dialogHtml(
      'You are signed in',
      `<p class="muted">Signed in as <strong>${esc(state.account.email)}</strong>. Your virtual picks follow you across devices.</p>
      <div class="actions"><button id="sign-out" class="secondary">Sign out</button></div>
      <div id="auth-message" role="status"></div>`,
    ),
  );
}

/** Sends the request and reports problems inside the dialog. */
async function submitEmail(email) {
  const messageBox = $('#auth-message');
  const submit = $('#auth-form button');
  submit.disabled = true;
  messageBox.innerHTML = '';
  try {
    await api('login-request', {}, {action: 'login-request', email});
    openDialog(
      dialogHtml(
        'Check your email',
        `<p class="muted">If <strong>${esc(email)}</strong> is a valid address, a sign-in link is on its way. It works once and expires in 15 minutes. Open it on the device where you want to sign in.</p>
        <div class="actions"><button id="close-auth-sent" class="secondary">Close</button></div>`,
      ),
    );
  } catch (e) {
    messageBox.innerHTML = `<div class="message">${esc(e.message)}</div>`;
    submit.disabled = false;
  }
}

async function signOut() {
  try {
    await api('logout', {}, {action: 'logout'});
  } catch (e) {
    $('#auth-message').innerHTML = `<div class="message">${esc(e.message)}</div>`;
    return;
  }
  state.account = null;
  renderAccount();
  closeDialog();
  await loadPicks().catch(() => {});
}

/** Reads and removes ?login=<token> so the one-time token does not linger in history. */
export function takeLoginToken() {
  const token = new URLSearchParams(location.search).get('login');
  if (token === null) return null;
  history.replaceState(null, '', location.pathname + location.hash);
  return TOKEN_FORMAT.test(token) ? token : 'invalid';
}

/**
 * The emailed link only opens the app; the person confirms here. (A mail scanner that merely
 * fetches the link cannot press the button, so it cannot use up the one-time token.)
 */
export function showLoginConfirmation(token) {
  if (token === 'invalid') {
    openDialog(
      dialogHtml(
        'Sign-in link not valid',
        '<p class="muted">This link is incomplete. Request a new sign-in link.</p><div class="actions"><button id="request-new" class="primary">Request a new link</button></div>',
      ),
    );
    return;
  }
  openDialog(
    dialogHtml(
      'Finish signing in',
      `<p class="muted">Confirm to sign in on this device. Picks saved in this browser will be added to your account.</p>
      <div class="actions"><button id="confirm-login" class="primary">Sign in</button></div>
      <div id="auth-message" role="status"></div>`,
    ),
  );
  $('#confirm-login').onclick = async () => {
    const button = $('#confirm-login');
    button.disabled = true;
    try {
      const result = await api('login-verify', {}, {action: 'login-verify', token});
      state.account = {email: result.email};
      renderAccount();
      const added = result.merged
        ? ` ${result.merged} pick${result.merged === 1 ? '' : 's'} from this browser ${result.merged === 1 ? 'was' : 'were'} added to your account.`
        : '';
      openDialog(
        dialogHtml(
          'You are signed in',
          `<p class="muted">Signed in as <strong>${esc(result.email)}</strong>.${added}</p><div class="actions"><button id="close-auth-sent" class="primary">Continue</button></div>`,
        ),
      );
      await loadPicks().catch(() => {});
    } catch (e) {
      button.disabled = false;
      $('#auth-message').innerHTML =
        `<div class="message">${esc(e.message)}</div><div class="actions"><button id="request-new" class="secondary">Request a new link</button></div>`;
    }
  };
}

/** Wires the button, the form and the dialog buttons (event delegation inside the dialog). */
export function initAccountUi() {
  $('#account-button').onclick = () => (state.account ? showSignedIn() : showSignInForm());
  $('#close-auth').onclick = closeDialog;
  $('#auth-dialog').addEventListener('submit', (e) => {
    if (e.target.id !== 'auth-form') return;
    e.preventDefault();
    submitEmail($('#auth-email').value.trim());
  });
  $('#auth-dialog').addEventListener('click', (e) => {
    const id = e.target.closest('button')?.id;
    if (id === 'sign-out') signOut();
    if (id === 'close-auth-sent') closeDialog();
    if (id === 'request-new') showSignInForm();
  });
}
