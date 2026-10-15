import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createService, hash} from '../server/service.mjs';
import {makeHandler} from '../server/handler.mjs';
import {createMemoryStore} from '../server/store/memory.mjs';
import {createStorage} from '../server/service/storage.mjs';
import {createPickStore, MAX_PICKS} from '../server/service/pickstore.mjs';
import {createSupabase} from '../server/supabase.mjs';
import {
  createFakeSupabase,
  PUBLISHABLE_KEY,
  SERVICE_KEY,
  SUPABASE_URL,
} from './helpers/fake-supabase.mjs';

const base = Date.parse('2026-10-14T10:00:00Z');
const ORIGIN = 'https://app.example';
const DAY = 86_400_000;

const GITHUB_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'fan@example.com',
  user_metadata: {user_name: 'octofan', avatar_url: 'https://avatars.example/a.png'},
};

function setup({configured = true, env = {}} = {}) {
  let clock = base;
  const db = createFakeSupabase();
  const store = createMemoryStore();
  const service = createService({
    env: configured
      ? {
          SUPABASE_URL,
          SUPABASE_SECRET_KEY: SERVICE_KEY,
          SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
          ...env,
        }
      : env,
    store,
    fetcher: db.fetcher,
    now: () => clock,
  });
  return {service, store, db, advance: (ms) => (clock += ms)};
}

/** Runs the whole sign-in: start, "GitHub", complete. */
async function signIn(x, {user = GITHUB_USER, anonymousSid = null, ip = '1.1.1.1'} = {}) {
  const {url, verifier} = await x.service.accounts.startLogin({origin: ORIGIN, ip});
  const code = x.db.issueCode(user, url);
  return x.service.accounts.completeLogin({code, verifier, anonymousSid});
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

test('accounts switch themselves off until Supabase is configured', async () => {
  const off = setup({configured: false});
  assert.equal(off.service.accounts.info().enabled, false);
  await assert.rejects(
    () => off.service.accounts.startLogin({origin: ORIGIN, ip: '1.1.1.1'}),
    /not configured/,
  );
  assert.equal(await off.service.accounts.resolve('a'.repeat(64)), null);
  assert.deepEqual(setup().service.accounts.info(), {enabled: true, providers: ['github']});
  assert.equal(off.service.status().accounts.enabled, false);
});

test('startLogin builds a GitHub PKCE URL whose challenge matches the verifier', async () => {
  const x = setup({env: {SITE_URL: 'https://prod.example/'}});
  const {url, verifier} = await x.service.accounts.startLogin({origin: ORIGIN, ip: '1.1.1.1'});
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, SUPABASE_URL + '/auth/v1/authorize');
  assert.equal(u.searchParams.get('provider'), 'github');
  assert.equal(u.searchParams.get('redirect_to'), 'https://prod.example/', 'SITE_URL wins');
  assert.equal(u.searchParams.get('code_challenge_method'), 's256');
  assert.equal(
    u.searchParams.get('code_challenge'),
    createHash('sha256').update(verifier).digest('base64url'),
  );
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.ok(!url.includes(SERVICE_KEY), 'the service key must never appear in a browser URL');

  const second = await x.service.accounts.startLogin({origin: ORIGIN, ip: '1.1.1.1'});
  assert.notEqual(second.verifier, verifier);
});

test('sign-in start is rate limited per client address', async () => {
  const x = setup();
  for (let i = 0; i < 30; i++) await x.service.accounts.startLogin({origin: ORIGIN, ip: '5.5.5.5'});
  await assert.rejects(
    () => x.service.accounts.startLogin({origin: ORIGIN, ip: '5.5.5.5'}),
    /budget/,
  );
  await x.service.accounts.startLogin({origin: ORIGIN, ip: '6.6.6.6'}); // someone else is fine
});

test('completeLogin stores the profile and a hashed server-side session', async () => {
  const x = setup();
  const result = await signIn(x);
  assert.equal(result.account.email, 'fan@example.com');
  assert.equal(result.account.name, 'octofan');
  assert.equal(result.account.id, GITHUB_USER.id);
  assert.equal(result.authToken.length, 64);

  assert.equal(x.db.tables.profiles.length, 1);
  assert.equal(x.db.tables.profiles[0].display_name, 'octofan');
  assert.equal(x.db.tables.profiles[0].provider, 'github');
  const session = x.db.tables.sessions[0];
  assert.equal(session.token_hash, hash(result.authToken));
  assert.ok(!JSON.stringify(x.db.tables).includes(result.authToken), 'raw token is never stored');

  await signIn(x, {ip: '2.2.2.2'}); // signing in again updates, not duplicates, the profile
  assert.equal(x.db.tables.profiles.length, 1);
  assert.equal(x.db.tables.sessions.length, 2);
});

test('sign-in codes are single use and bound to the PKCE verifier', async () => {
  const x = setup();
  const {url, verifier} = await x.service.accounts.startLogin({origin: ORIGIN, ip: '1.1.1.1'});
  const code = x.db.issueCode(GITHUB_USER, url);

  await assert.rejects(
    () => x.service.accounts.completeLogin({code, verifier: 'a'.repeat(64), anonymousSid: null}),
    /could not be completed/,
  );
  // The failed attempt burned the code: even the right verifier cannot reuse it.
  await assert.rejects(
    () => x.service.accounts.completeLogin({code, verifier, anonymousSid: null}),
    /could not be completed/,
  );

  const fresh = x.db.issueCode(GITHUB_USER, url);
  assert.ok(await x.service.accounts.completeLogin({code: fresh, verifier, anonymousSid: null}));
  await assert.rejects(
    () => x.service.accounts.completeLogin({code: fresh, verifier, anonymousSid: null}),
    /could not be completed/,
  );
  await assert.rejects(
    () => x.service.accounts.completeLogin({code: '', verifier, anonymousSid: null}),
    /could not be completed/,
  );
  await assert.rejects(
    () => x.service.accounts.completeLogin({code: 'x', verifier: null, anonymousSid: null}),
    /expired/,
  );
});

test('sessions resolve, are cached briefly, and end on logout or expiry', async () => {
  const x = setup();
  const {authToken, account} = await signIn(x);
  const selects = () =>
    x.db.requests.filter((r) => r.path.endsWith('/sessions') && r.method === 'GET').length;

  assert.deepEqual(await x.service.accounts.resolve(authToken), account);
  await x.service.accounts.resolve(authToken);
  assert.equal(selects(), 1, 'the second lookup comes from the short cache');
  assert.equal(await x.service.accounts.resolve('0'.repeat(64)), null);
  assert.equal(await x.service.accounts.resolve('not-a-token'), null);
  assert.equal(await x.service.accounts.resolve(undefined), null);

  await x.service.accounts.logout(authToken);
  assert.equal(await x.service.accounts.resolve(authToken), null, 'logout takes effect at once');
  assert.equal(x.db.tables.sessions[0].revoked, true);

  const other = (await signIn(x, {ip: '3.3.3.3'})).authToken;
  assert.ok(await x.service.accounts.resolve(other), 'other sessions are unaffected');
  x.advance(91 * DAY);
  assert.equal(await x.service.accounts.resolve(other), null, 'sessions expire after 90 days');
});

test('signing in merges anonymous picks into the account, once, without duplicates', async () => {
  const x = setup();
  const phone = hash('browser-1');
  const laptop = hash('browser-2');
  await x.store.setJSON('picks/' + phone, {items: [pick('m1', 300), pick('m2', 200)]});
  await x.store.setJSON('picks/' + laptop, {items: [pick('m2', 250), pick('m3', 400)]});

  const first = await signIn(x, {anonymousSid: phone});
  assert.equal(first.merged, 2);
  const second = await signIn(x, {anonymousSid: laptop, ip: '2.2.2.2'});
  assert.equal(second.merged, 1, 'only the new match is added');
  const again = await signIn(x, {anonymousSid: laptop, ip: '3.3.3.3'});
  assert.equal(again.merged, 0, 'repeating the merge adds nothing');

  const mine = await x.service.picks('acct:' + GITHUB_USER.id);
  assert.deepEqual(
    mine.map((p) => p.canonical),
    ['m3', 'm1', 'm2'],
    'newest first',
  );
  assert.equal(mine[0].forecast.home, 'A', 'the original forecast is kept');
  assert.equal((await x.service.picks(phone)).length, 2, 'the browser profile is left intact');
});

// ---------- pick store ----------

test('account picks: one per match, capped, and results only fill pending picks', async () => {
  const db = createFakeSupabase();
  const supabase = createSupabase({url: SUPABASE_URL, key: SERVICE_KEY, fetcher: db.fetcher});
  const storage = createStorage({store: createMemoryStore(), now: () => base});
  const store = createPickStore({storage, supabase});
  const sid = 'acct:' + GITHUB_USER.id;
  db.tables.profiles.push({id: GITHUB_USER.id});

  assert.equal(await store.add(sid, pick('m1', 100)), true);
  assert.equal(
    await store.add(sid, pick('m1', 200)),
    false,
    'the same match cannot be picked twice',
  );

  await store.applyResults(
    sid,
    new Map([[hash('m1'), {result: 'correct', score: '2–1', settledAt: 500}]]),
  );
  let [stored] = await store.list(sid);
  assert.equal(stored.result, 'correct');
  assert.equal(stored.score, '2–1');
  assert.equal(stored.settledAt, 500);
  await store.applyResults(
    sid,
    new Map([[hash('m1'), {result: 'incorrect', score: '0–0', settledAt: 900}]]),
  );
  [stored] = await store.list(sid);
  assert.equal(stored.result, 'correct', 'a settled pick is never rewritten');

  for (let i = 0; i < MAX_PICKS - 1; i++)
    db.tables.picks.push({
      user_id: GITHUB_USER.id,
      pick_id: 'x' + i,
      canonical: 'x' + i,
      outcome: 0,
      created_at: new Date(i).toISOString(),
      forecast: {},
    });
  await assert.rejects(() => store.add(sid, pick('overflow', 1)), /500-pick limit/);
});

test('a database outage is reported without leaking details', async () => {
  const x = setup();
  const {authToken} = await signIn(x);
  x.db.setFailing(true);
  await assert.rejects(() => x.service.picks('acct:' + GITHUB_USER.id), /temporarily unavailable/);
  assert.ok(authToken);
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

test('HTTP: GitHub sign-in on one device shows the same picks on another, then sign out', async () => {
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

  // Laptop: anonymous, with one saved pick.
  const first = await get('status');
  const laptop = {jk_session: cookiesFrom(first).jk_session};
  const statusBody = await first.json();
  assert.equal(statusBody.account, null);
  assert.equal(statusBody.accounts.enabled, true);
  await x.store.setJSON('picks/' + hash(laptop.jk_session), {items: [pick('m1', 100)]});

  assert.equal((await post({action: 'login-start'}, laptop, 'https://evil.test')).status, 403);

  const started = await post({action: 'login-start'}, laptop);
  assert.equal(started.status, 200);
  const {url: authorizeUrl} = await started.json();
  const startCookies = started.headers.getSetCookie().find((c) => c.startsWith('jk_pkce='));
  assert.ok(startCookies.includes('HttpOnly') && startCookies.includes('Max-Age=600'));
  laptop.jk_pkce = cookiesFrom(started).jk_pkce;

  // "GitHub" redirects back with a code; the page posts it.
  const code = x.db.issueCode(GITHUB_USER, authorizeUrl);
  const done = await post({action: 'login-complete', code}, laptop);
  assert.equal(done.status, 200);
  assert.deepEqual(await done.clone().json(), {
    account: {email: 'fan@example.com', name: 'octofan'},
    avatarUrl: 'https://avatars.example/a.png',
    merged: 1,
  });
  const setCookies = done.headers.getSetCookie();
  assert.ok(
    setCookies.some(
      (c) => c.startsWith('jk_auth=') && c.includes('HttpOnly') && c.includes('Secure'),
    ),
  );
  assert.ok(
    setCookies.some((c) => c.startsWith('jk_pkce=;') && c.includes('Max-Age=0')),
    'verifier cookie cleared',
  );
  laptop.jk_auth = cookiesFrom(done).jk_auth;
  delete laptop.jk_pkce;

  assert.equal((await (await get('status', laptop)).json()).account.name, 'octofan');
  assert.equal((await (await get('picks', laptop)).json()).picks.length, 1);

  // Phone: another browser, signs in as the same person.
  const phoneStart = await get('picks');
  const phone = {jk_session: cookiesFrom(phoneStart).jk_session};
  assert.equal((await phoneStart.json()).picks.length, 0, 'an anonymous phone sees nothing');
  const phoneStarted = await post({action: 'login-start'}, phone);
  phone.jk_pkce = cookiesFrom(phoneStarted).jk_pkce;
  const phoneCode = x.db.issueCode(GITHUB_USER, (await phoneStarted.json()).url);
  const phoneDone = await post({action: 'login-complete', code: phoneCode}, phone);
  phone.jk_auth = cookiesFrom(phoneDone).jk_auth;
  delete phone.jk_pkce;
  assert.equal(
    (await (await get('picks', phone)).json()).picks.length,
    1,
    'same picks on the phone',
  );

  // A code without the matching verifier cookie is refused.
  const stray = x.db.issueCode(GITHUB_USER, authorizeUrl);
  assert.equal((await post({action: 'login-complete', code: stray}, {})).status, 400);

  const out = await post({action: 'logout'}, phone);
  assert.ok(
    out.headers.getSetCookie().some((c) => c.startsWith('jk_auth=;') && c.includes('Max-Age=0')),
  );
  assert.equal(
    (await (await get('picks', phone)).json()).picks.length,
    0,
    'signed out: anonymous again',
  );
  assert.equal(
    (await (await get('picks', laptop)).json()).picks.length,
    1,
    'the laptop stays signed in',
  );
});

test('HTTP: sign-in routes refuse politely when Supabase is not configured', async () => {
  const x = setup({configured: false});
  const handler = makeHandler(() => x.service);
  const r = await handler(
    new Request(`${ORIGIN}/api/football`, {
      method: 'POST',
      headers: {origin: ORIGIN, 'content-type': 'application/json'},
      body: JSON.stringify({action: 'login-start'}),
    }),
  );
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, 'accounts_disabled');
});

test('keys are sent the way Supabase requires: apikey only, publishable key for the sign-in exchange', async () => {
  const x = setup();
  await signIn(x);
  const rest = x.db.requests.filter((r) => r.path.startsWith('/rest/v1/'));
  const auth = x.db.requests.filter((r) => r.path === '/auth/v1/token');
  assert.ok(rest.length > 0 && auth.length === 1);
  for (const r of x.db.requests)
    assert.equal(r.headers.Authorization, undefined, 'no Bearer for sb_ keys');
  assert.ok(rest.every((r) => r.headers.apikey === SERVICE_KEY));
  assert.equal(auth[0].headers.apikey, PUBLISHABLE_KEY, 'the exchange needs no elevated key');
});

test('environment variable names from the Supabase quickstart and legacy names both work', async () => {
  const quickstart = setup({
    configured: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
      SUPABASE_SECRET_KEY: SERVICE_KEY,
    },
  });
  assert.equal(quickstart.service.accounts.info().enabled, true);
  assert.ok(await signIn(quickstart));

  const legacy = setup({
    configured: false,
    env: {SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY},
  });
  assert.ok(
    await signIn(legacy),
    'without a publishable key the secret key is used for the exchange',
  );

  // A publishable key alone must never enable accounts (it cannot reach the tables).
  const publicOnly = setup({
    configured: false,
    env: {SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY},
  });
  assert.equal(publicOnly.service.accounts.info().enabled, false);
});

test('HTTP: a database outage degrades the status call but never mixes up pick profiles', async () => {
  const x = setup();
  const handler = makeHandler(() => x.service);
  const get = (action, jar) =>
    handler(
      new Request(`${ORIGIN}/api/football?action=${action}`, {
        headers: {cookie: cookieHeader(jar)},
      }),
    );
  const signedIn = await signIn(x);
  const jar = {jk_session: 'a'.repeat(64), jk_auth: signedIn.authToken};

  x.advance(61_000); // the short session cache expires
  x.db.setFailing(true);

  const status = await get('status', jar);
  assert.equal(status.status, 200, 'the page still loads');
  const body = await status.json();
  assert.equal(body.account, null);
  assert.equal(body.accountError, true);

  const picks = await get('picks', jar);
  assert.equal(picks.status, 502, 'picks fail loudly instead of showing the anonymous profile');

  // Anonymous visitors are not affected at all.
  const anonymous = await get('picks', {jk_session: 'b'.repeat(64)});
  assert.equal(anonymous.status, 200);
});

test('the per-instance session cache stays bounded', async () => {
  const x = setup();
  const selects = () =>
    x.db.requests.filter((r) => r.path.endsWith('/sessions') && r.method === 'GET').length;
  const tokens = Array.from({length: 600}, (_, i) => String(i).padStart(64, '0'));
  for (const token of tokens) await x.service.accounts.resolve(token);
  assert.equal(selects(), 600);

  await x.service.accounts.resolve(tokens[599]); // recent: still cached
  assert.equal(selects(), 600);
  await x.service.accounts.resolve(tokens[0]); // oldest: evicted, read again
  assert.equal(selects(), 601);
});
