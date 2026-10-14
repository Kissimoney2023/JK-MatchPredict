import test from 'node:test';
import assert from 'node:assert/strict';
import {createService, hash} from '../server/service.mjs';
import {makeHandler} from '../server/handler.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';
import {normalizeEmail} from '../server/service/accounts.mjs';

const base = Date.parse('2026-10-14T10:00:00Z');
const ORIGIN = 'https://app.example';

/** A durable-looking store (accounts refuse the temporary in-memory store). */
const durableStore = () => ({...createMemoryStore(), kind: 'redis'});

function setup({env = {}, store = durableStore(), emailStatus = 200} = {}) {
  let clock = base;
  const emails = [];
  const fetcher = async (url, opts = {}) => {
    if (String(url).startsWith('https://api.resend.com/')) {
      emails.push({url, opts, body: JSON.parse(opts.body)});
      return emailStatus === 200
        ? Response.json({id: 'email_1'})
        : Response.json({message: 'nope'}, {status: emailStatus});
    }
    return Response.json({}, {status: 404});
  };
  const service = createService({
    env: {RESEND_API_KEY: 'resend-secret', AUTH_FROM_EMAIL: 'JK <login@jk.example>', ...env},
    store,
    fetcher,
    now: () => clock,
  });
  const lastToken = () => {
    const text = emails.at(-1).body.text;
    return text.split('/?login=')[1].split(' ')[0].split(String.fromCharCode(10))[0];
  };
  return {service, store, emails, lastToken, advance: (ms) => (clock += ms)};
}

const pick = (canonical, createdAt) => ({
  id: hash(canonical),
  canonical,
  outcome: 0,
  createdAt,
  forecast: {
    home: 'A',
    away: 'B',
    competition: 'CL',
    kickoff: '2026-12-01T20:00:00Z',
    p: [50, 25, 25],
  },
  result: null,
  score: null,
});

test('email normalisation accepts plausible addresses only', () => {
  assert.equal(normalizeEmail('  Person@Example.COM '), 'person@example.com');
  for (const bad of [
    '',
    'no-at',
    'a@b',
    '@x.com',
    'a@@x.com',
    'a b@x.com',
    'a@x.',
    null,
    'a@x.com\nbcc:evil@x.com',
  ])
    assert.equal(normalizeEmail(bad), null, String(bad));
});

test('accounts switch themselves off without durable storage or an email sender', async () => {
  const memory = setup({store: createMemoryStore()});
  assert.equal(memory.service.accounts.info().enabled, false);
  await assert.rejects(
    () => memory.service.accounts.requestLogin({email: 'a@b.co', ip: '1.1.1.1', origin: ORIGIN}),
    /persistent storage/,
  );
  const noEmail = setup({env: {RESEND_API_KEY: ''}});
  assert.equal(noEmail.service.accounts.info().enabled, false);
  assert.equal(setup().service.accounts.info().enabled, true);
});

test('login request sends one email through Resend with a one-time link', async () => {
  const x = setup();
  const reply = await x.service.accounts.requestLogin({
    email: 'Fan@Example.com',
    ip: '1.1.1.1',
    origin: ORIGIN,
  });
  assert.deepEqual(reply, {ok: true});
  assert.equal(x.emails.length, 1);
  const mail = x.emails[0];
  assert.equal(mail.opts.headers.Authorization, 'Bearer resend-secret');
  assert.deepEqual(mail.body.to, ['fan@example.com']);
  assert.equal(mail.body.from, 'JK <login@jk.example>');
  assert.ok(mail.body.text.includes(ORIGIN + '/?login='));
  assert.equal(x.lastToken().length, 64);

  await assert.rejects(
    () => x.service.accounts.requestLogin({email: 'not-an-email', ip: '1.1.1.1', origin: ORIGIN}),
    /valid email/,
  );
});

test('email sending is rate limited per address and per client', async () => {
  const x = setup();
  for (let i = 0; i < 3; i++)
    await x.service.accounts.requestLogin({email: 'a@b.co', ip: '2.2.2.2', origin: ORIGIN});
  await assert.rejects(
    () => x.service.accounts.requestLogin({email: 'a@b.co', ip: '2.2.2.2', origin: ORIGIN}),
    /budget/,
  );
  assert.equal(x.emails.length, 3);

  const y = setup();
  for (let i = 0; i < 10; i++)
    await y.service.accounts.requestLogin({email: `p${i}@b.co`, ip: '3.3.3.3', origin: ORIGIN});
  await assert.rejects(
    () => y.service.accounts.requestLogin({email: 'p99@b.co', ip: '3.3.3.3', origin: ORIGIN}),
    /budget/,
  );
});

test('a provider failure is reported without pretending the email was sent', async () => {
  const x = setup({emailStatus: 500});
  await assert.rejects(
    () => x.service.accounts.requestLogin({email: 'a@b.co', ip: '1.1.1.1', origin: ORIGIN}),
    /Could not send/,
  );
});

test('a sign-in token works once, expires after 15 minutes and rejects junk', async () => {
  const x = setup();
  await x.service.accounts.requestLogin({email: 'a@b.co', ip: '1.1.1.1', origin: ORIGIN});
  const token = x.lastToken();

  const session = await x.service.accounts.verifyLogin({token, anonymousSid: null});
  assert.equal(session.email, 'a@b.co');
  assert.equal(session.authToken.length, 64);
  await assert.rejects(
    () => x.service.accounts.verifyLogin({token, anonymousSid: null}),
    /invalid or has expired/,
  );
  await assert.rejects(
    () => x.service.accounts.verifyLogin({token: 'zzz', anonymousSid: null}),
    /invalid/,
  );

  await x.service.accounts.requestLogin({email: 'late@b.co', ip: '1.1.1.1', origin: ORIGIN});
  const late = x.lastToken();
  x.advance(16 * 60_000);
  await assert.rejects(
    () => x.service.accounts.verifyLogin({token: late, anonymousSid: null}),
    /expired/,
  );
});

test('concurrent use of one token signs in exactly once', async () => {
  const x = setup();
  await x.service.accounts.requestLogin({email: 'a@b.co', ip: '1.1.1.1', origin: ORIGIN});
  const token = x.lastToken();
  const results = await Promise.allSettled([
    x.service.accounts.verifyLogin({token, anonymousSid: null}),
    x.service.accounts.verifyLogin({token, anonymousSid: null}),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
});

test('sessions resolve to the account and end on logout', async () => {
  const x = setup();
  await x.service.accounts.requestLogin({email: 'a@b.co', ip: '1.1.1.1', origin: ORIGIN});
  const {authToken, accountId} = await x.service.accounts.verifyLogin({
    token: x.lastToken(),
    anonymousSid: null,
  });
  assert.deepEqual(await x.service.accounts.resolve(authToken), {id: accountId, email: 'a@b.co'});
  assert.equal(await x.service.accounts.resolve('0'.repeat(64)), null);
  assert.equal(await x.service.accounts.resolve(undefined), null);

  await x.service.accounts.logout(authToken);
  assert.equal(await x.service.accounts.resolve(authToken), null);

  const again = await (async () => {
    await x.service.accounts.requestLogin({email: 'a@b.co', ip: '9.9.9.9', origin: ORIGIN});
    return x.service.accounts.verifyLogin({token: x.lastToken(), anonymousSid: null});
  })();
  assert.equal(again.accountId, accountId, 'the same email always maps to the same account');

  x.advance(91 * 24 * 3_600_000);
  assert.equal(
    await x.service.accounts.resolve(again.authToken),
    null,
    'sessions expire after 90 days',
  );
});

test('signing in merges anonymous picks into the account without duplicates', async () => {
  const x = setup();
  const anon = hash('browser-1');
  await x.store.setJSON('picks/' + anon, {items: [pick('m1', 300), pick('m2', 200)]});

  await x.service.accounts.requestLogin({email: 'a@b.co', ip: '1.1.1.1', origin: ORIGIN});
  const first = await x.service.accounts.verifyLogin({token: x.lastToken(), anonymousSid: anon});
  assert.equal(first.merged, 2);
  assert.equal((await x.service.picks(first.accountId)).length, 2);

  // A second device with an overlapping pick and a new one.
  const phone = hash('browser-2');
  await x.store.setJSON('picks/' + phone, {items: [pick('m2', 250), pick('m3', 400)]});
  await x.service.accounts.requestLogin({email: 'a@b.co', ip: '1.1.1.2', origin: ORIGIN});
  const second = await x.service.accounts.verifyLogin({token: x.lastToken(), anonymousSid: phone});
  assert.equal(second.merged, 1, 'only the new match is added');
  const all = await x.service.picks(first.accountId);
  assert.deepEqual(
    all.map((p) => p.canonical),
    ['m3', 'm1', 'm2'],
    'newest first',
  );
  assert.equal((await x.service.picks(anon)).length, 2, 'the browser profile is left intact');
});

// ---------- through the HTTP handler ----------

const cookiesFrom = (response) =>
  Object.fromEntries(
    response.headers.getSetCookie().map((c) => {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      return [pair.slice(0, i), pair.slice(i + 1)];
    }),
  );
const cookieHeader = (jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

test('HTTP: sign in on one device, see the same picks on another, sign out', async () => {
  const x = setup();
  const handler = makeHandler(() => x.service);
  const get = (action, jar = {}) =>
    handler(
      new Request(`${ORIGIN}/api/football?action=${action}`, {
        headers: {cookie: cookieHeader(jar)},
      }),
    );
  const post = (body, jar = {}, origin = ORIGIN) =>
    handler(
      new Request(`${ORIGIN}/api/football`, {
        method: 'POST',
        headers: {origin, 'content-type': 'application/json', cookie: cookieHeader(jar)},
        body: JSON.stringify(body),
      }),
    );

  // Laptop: anonymous browser with a saved pick.
  const first = await get('status');
  const laptop = {jk_session: cookiesFrom(first).jk_session};
  assert.deepEqual((await first.clone().json()).account, null);
  assert.equal((await first.json()).accounts.enabled, true);
  await x.store.setJSON('picks/' + hash(laptop.jk_session), {items: [pick('m1', 100)]});

  // Cross-site request is rejected.
  assert.equal(
    (await post({action: 'login-request', email: 'a@b.co'}, laptop, 'https://evil.test')).status,
    403,
  );

  // Request, then confirm the link.
  const requested = await post({action: 'login-request', email: 'a@b.co'}, laptop);
  assert.equal(requested.status, 200);
  const verified = await post({action: 'login-verify', token: x.lastToken()}, laptop);
  assert.equal(verified.status, 200);
  assert.deepEqual(await verified.clone().json(), {email: 'a@b.co', merged: 1});
  const setCookies = verified.headers.getSetCookie().join(' | ');
  assert.ok(setCookies.includes('jk_auth='));
  assert.ok(setCookies.includes('HttpOnly'));
  assert.ok(setCookies.includes('Secure'));
  laptop.jk_auth = cookiesFrom(verified).jk_auth;

  assert.equal((await (await get('status', laptop)).json()).account.email, 'a@b.co');
  assert.equal((await (await get('picks', laptop)).json()).picks.length, 1);

  // Phone: a different browser profile, signed in with the same cookie value flow.
  const phoneStart = await get('picks');
  const phone = {jk_session: cookiesFrom(phoneStart).jk_session};
  assert.equal((await phoneStart.json()).picks.length, 0, 'anonymous phone sees nothing');
  await post({action: 'login-request', email: 'a@b.co'}, phone);
  const phoneVerified = await post({action: 'login-verify', token: x.lastToken()}, phone);
  phone.jk_auth = cookiesFrom(phoneVerified).jk_auth;
  assert.equal(
    (await (await get('picks', phone)).json()).picks.length,
    1,
    'same picks on the phone',
  );

  // The link cannot be reused.
  const reuse = await post({action: 'login-verify', token: x.lastToken()}, {});
  assert.equal(reuse.status, 400);

  // Sign out: the cookie is cleared and the account is no longer visible.
  const out = await post({action: 'logout'}, phone);
  assert.ok(
    out.headers.getSetCookie().some((c) => c.startsWith('jk_auth=;') && c.includes('Max-Age=0')),
  );
  assert.equal((await (await get('picks', phone)).json()).picks.length, 0);
  assert.equal(
    (await (await get('picks', laptop)).json()).picks.length,
    1,
    'other devices stay signed in',
  );
});

test('HTTP: sign-in endpoints refuse politely when accounts are disabled', async () => {
  const x = setup({store: createMemoryStore()});
  const handler = makeHandler(() => x.service);
  const r = await handler(
    new Request(`${ORIGIN}/api/football`, {
      method: 'POST',
      headers: {origin: ORIGIN, 'content-type': 'application/json'},
      body: JSON.stringify({action: 'login-request', email: 'a@b.co'}),
    }),
  );
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, 'accounts_disabled');
});
