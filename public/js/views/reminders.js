import {api} from '../api.js';
import {$, esc} from '../dom.js';
import {state} from '../state.js';

const READY_TIMEOUT_MS = 4000;

/** Push needs a service worker, the Push API and notification permission. */
const supported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** The Web Push public key arrives URL-safe base64; the browser wants raw bytes. */
function keyBytes(base64Url) {
  const padded = base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob(padded.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** The service worker registration, or null when it is not available soon (never hangs). */
async function registration() {
  const wait = new Promise((resolve) => setTimeout(() => resolve(null), READY_TIMEOUT_MS));
  return Promise.race([navigator.serviceWorker.ready, wait]);
}

let linkedTo = null; // which profile the server last linked this browser to

function show(html) {
  const box = $('#reminders');
  box.classList.toggle('hidden', !html);
  box.innerHTML = html;
}

const panel = (text, button = '') =>
  `<p class="muted">${esc(text)}</p>${button ? `<div class="actions">${button}</div>` : ''}`;

const ON_BUTTON = '<button id="reminders-on" class="secondary">Remind me before kickoff</button>';
const OFF_BUTTON = '<button id="reminders-off" class="secondary">Turn off reminders</button>';

/**
 * Shows the reminder switch on the picks page: off, on, blocked, or hidden when the browser or
 * the site cannot do push. When already on, it quietly re-links this browser to the current
 * profile (anonymous or account), so reminders follow the person after signing in or out.
 */
export async function renderReminders() {
  if (!state.push?.enabled || !supported()) return show('');
  const reg = await registration();
  if (!reg) return show('');
  const subscription = await reg.pushManager.getSubscription().catch(() => null);

  if (subscription && Notification.permission === 'granted') {
    const profile = state.account?.email ?? 'anonymous';
    if (linkedTo !== profile) {
      linkedTo = profile;
      api(
        'push-subscribe',
        {},
        {action: 'push-subscribe', subscription: subscription.toJSON()},
      ).catch(() => {
        linkedTo = null;
      });
    }
    return show(
      panel(
        'Kickoff reminders are on for this device: you will get a notification about 45 minutes before a match you picked.',
        OFF_BUTTON,
      ),
    );
  }
  if (Notification.permission === 'denied')
    return show(panel('Notifications are blocked for this site in your browser settings.'));
  show(
    panel(
      'Get a notification before a match you picked kicks off. Only your own virtual picks are mentioned.',
      ON_BUTTON,
    ),
  );
}

async function turnOn(button) {
  button.disabled = true;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return renderReminders();
    const reg = await registration();
    if (!reg) throw Error('The app is not ready yet. Reload the page and try again.');
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(state.push.publicKey),
    });
    try {
      await api(
        'push-subscribe',
        {},
        {action: 'push-subscribe', subscription: subscription.toJSON()},
      );
    } catch (e) {
      await subscription.unsubscribe().catch(() => {}); // do not keep a half-set-up subscription
      throw e;
    }
    linkedTo = state.account?.email ?? 'anonymous';
    await renderReminders();
  } catch (e) {
    show(panel(e.message || 'Could not turn on reminders.', ON_BUTTON));
  }
}

async function turnOff(button) {
  button.disabled = true;
  try {
    const reg = await registration();
    const subscription = await reg?.pushManager.getSubscription();
    if (subscription) {
      await api(
        'push-unsubscribe',
        {},
        {action: 'push-unsubscribe', endpoint: subscription.endpoint},
      );
      await subscription.unsubscribe();
    }
    linkedTo = null;
    await renderReminders();
  } catch (e) {
    show(panel(e.message || 'Could not turn off reminders.', OFF_BUTTON));
  }
}

export function initReminders() {
  $('#reminders').addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (button?.id === 'reminders-on') turnOn(button);
    if (button?.id === 'reminders-off') turnOff(button);
  });
}
