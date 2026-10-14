import {randomBytes} from 'node:crypto';
import {AppError} from '../errors.mjs';
import {hash, MINUTE, HOUR, DAY} from '../util.mjs';

const MAGIC_TTL_MS = 15 * MINUTE;
const SESSION_DAYS = 90;
const MAX_EMAIL_LENGTH = 254;
const TOKEN_FORMAT = /^[a-f0-9]{64}$/;
const INVALID_LINK = 'This sign-in link is invalid or has expired. Request a new one.';

/** Trimmed, lower-cased address if it looks like a plausible email, otherwise null. */
export function normalizeEmail(input) {
  const email = String(input ?? '')
    .trim()
    .toLowerCase();
  const at = email.indexOf('@');
  const plausible =
    email.length >= 3 &&
    email.length <= MAX_EMAIL_LENGTH &&
    at > 0 &&
    at === email.lastIndexOf('@') &&
    email.indexOf('.', at) > at + 1 &&
    !email.endsWith('.') &&
    ![...email].some((c) => c <= ' ');
  return plausible ? email : null;
}

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function withoutTrailingSlashes(url) {
  let out = String(url);
  while (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

/**
 * Optional accounts with email magic links (sent through Resend). An account only links the
 * picks of a person across devices; it needs durable storage (Redis) and an email sender.
 *
 * Flow: requestLogin -> email with `<site>/?login=<token>` -> the app asks the person to
 * confirm (so link-scanning mail filters cannot use the one-time token) -> verifyLogin sets
 * the sign-in cookie and merges the browser's anonymous picks into the account.
 */
export function createAccounts({env, store, storage, fetcher, now, mergePicks}) {
  const {read, atomic, budget} = storage;

  function info() {
    if (store.kind === 'memory')
      return {enabled: false, reason: 'Accounts need persistent storage (Upstash Redis).'};
    if (!env.RESEND_API_KEY || !env.AUTH_FROM_EMAIL)
      return {enabled: false, reason: 'Email sign-in is not configured.'};
    return {enabled: true};
  }
  function assertEnabled() {
    const state = info();
    if (!state.enabled) throw new AppError(503, 'accounts_disabled', state.reason);
  }

  async function sendEmail(to, link) {
    const text = [
      'Open this link to sign in to JK MatchPredict (valid for 15 minutes, works once):',
      '',
      link,
      '',
      'If you did not ask for it, you can ignore this email.',
    ].join(String.fromCharCode(10));
    const html = `<p>Open this link to sign in to JK MatchPredict. It is valid for 15 minutes and works once.</p><p><a href="${escapeHtml(link)}">Sign in</a></p><p style="color:#667">If you did not ask for it, you can ignore this email.</p>`;
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        from: env.AUTH_FROM_EMAIL,
        to: [to],
        subject: 'Your JK MatchPredict sign-in link',
        text,
        html,
      }),
    });
    if (!response.ok) {
      console.warn('[accounts] email provider returned HTTP ' + response.status);
      throw new AppError(502, 'email', 'Could not send the sign-in email. Please try again later.');
    }
  }

  /** Sends a sign-in link. The reply never reveals whether the address already has an account. */
  async function requestLogin({email: raw, ip, origin}) {
    assertEnabled();
    const email = normalizeEmail(raw);
    if (!email) throw new AppError(400, 'email', 'Enter a valid email address.');
    await budget('login-ip-' + hash(ip || 'unknown'), 10, HOUR);
    await budget('login-email-' + hash(email), 3, 15 * MINUTE);

    const token = randomBytes(32).toString('hex');
    await store.setJSON(
      'magic/' + hash(token),
      {email, createdAt: now(), expiresAt: now() + MAGIC_TTL_MS, used: false},
      {onlyIfNew: true},
    );
    const base = withoutTrailingSlashes(env.SITE_URL || origin);
    await sendEmail(email, base + '/?login=' + token);
    return {ok: true};
  }

  /** Consumes a one-time token, creates the sign-in session and merges anonymous picks. */
  async function verifyLogin({token, anonymousSid}) {
    assertEnabled();
    if (!TOKEN_FORMAT.test(String(token || ''))) throw new AppError(400, 'token', INVALID_LINK);

    const record = await atomic('magic/' + hash(token), (old) => {
      if (!old || old.used || old.expiresAt <= now())
        throw new AppError(400, 'token', INVALID_LINK);
      return {...old, used: true, usedAt: now()};
    });

    const accountId = hash('acct:' + record.email);
    await atomic('account/' + accountId, (old) =>
      old
        ? {...old, lastLoginAt: now()}
        : {email: record.email, createdAt: now(), lastLoginAt: now()},
    );
    const authToken = randomBytes(32).toString('hex');
    await store.setJSON('auth/' + hash(authToken), {
      accountId,
      email: record.email,
      createdAt: now(),
    });
    const merged = anonymousSid ? await mergePicks(accountId, anonymousSid) : 0;
    return {
      authToken,
      accountId,
      email: record.email,
      merged,
      maxAgeSeconds: (SESSION_DAYS * DAY) / 1000,
    };
  }

  /** The signed-in account for an auth cookie value, or null. */
  async function resolve(authToken) {
    if (!info().enabled || !TOKEN_FORMAT.test(String(authToken || ''))) return null;
    const session = await read('auth/' + hash(authToken));
    if (!session || session.revoked || now() - session.createdAt > SESSION_DAYS * DAY) return null;
    return {id: session.accountId, email: session.email};
  }

  async function logout(authToken) {
    if (!TOKEN_FORMAT.test(String(authToken || ''))) return;
    await store.setJSON('auth/' + hash(authToken), {revoked: true, createdAt: 0});
  }

  return {info, requestLogin, verifyLogin, resolve, logout};
}
