import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url));
const ORIGIN = 'https://app.example';

// ---------- manifest and icons ----------

/** Width and height from a PNG header. */
const pngSize = (bytes) => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];

test('the web app manifest is complete and its icons exist at the declared sizes', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest').toString('utf8'));
  for (const field of [
    'name',
    'short_name',
    'start_url',
    'display',
    'background_color',
    'theme_color',
  ])
    assert.ok(manifest[field], `${field} is required`);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');

  for (const icon of manifest.icons) {
    const [w, h] = pngSize(read('public' + icon.src));
    assert.equal(`${w}x${h}`, icon.sizes, icon.src);
    assert.equal(icon.type, 'image/png');
  }
  const purposes = manifest.icons.map((i) => i.purpose);
  assert.ok(purposes.includes('any') && purposes.includes('maskable'));
  assert.ok(manifest.icons.some((i) => i.sizes === '192x192'));
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512'));
  assert.deepEqual(pngSize(read('public/icons/apple-touch-icon.png')), [180, 180]);
  assert.deepEqual(pngSize(read('public/icons/favicon-32.png')), [32, 32]);
});

test('the link-preview image exists, is a JPEG and is small enough for chat apps', () => {
  const image = read('public/icons/og-image.jpg');
  assert.deepEqual([...image.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.ok(image.length < 300 * 1024, 'previews over about 300 KB are skipped by some apps');
});

test('the page links the manifest and icons', () => {
  const html = read('public/index.html').toString('utf8');
  for (const needle of [
    'rel="manifest"',
    'manifest.webmanifest',
    'rel="apple-touch-icon"',
    'rel="icon"',
    'name="theme-color"',
  ])
    assert.ok(html.includes(needle), needle);
});

// ---------- the service worker, run in a simulated worker scope ----------

function createWorker({online = true} = {}) {
  const handlers = {};
  const stores = new Map(); // cache name -> Map(key -> Response)
  const state = {online, requests: []};

  const pathOf = (value) => {
    const url = new URL(typeof value === 'string' ? value : value.url, ORIGIN);
    return url.pathname + url.search;
  };
  const keyOf = pathOf;
  const makeCache = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const map = stores.get(name);
    return {
      addAll: async (urls) => {
        for (const u of urls) map.set(u, await context.fetch(ORIGIN + u));
      },
      put: async (key, response) => map.set(keyOf(key), response),
      match: async (key) => map.get(keyOf(key))?.clone(),
    };
  };

  const context = {
    URL,
    Response,
    Promise,
    caches: {
      open: async (name) => makeCache(name),
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
    },
    fetch: async (input) => {
      state.requests.push(typeof input === 'string' ? input : input.url);
      if (!state.online) throw new TypeError('network down');
      const response = new Response('network:' + pathOf(input), {status: 200});
      Object.defineProperty(response, 'type', {value: 'basic'}); // same-origin, like a browser
      return response;
    },
    self: {
      location: {origin: ORIGIN},
      addEventListener: (type, fn) => (handlers[type] = fn),
      skipWaiting: () => (state.skipped = true),
      clients: {
        claim: async () => (state.claimed = true),
        matchAll: async () => state.windows ?? [],
        openWindow: async (url) => (state.opened = url),
      },
      registration: {
        showNotification: async (title, options) => (state.shown = {title, options}),
      },
    },
  };
  context.self.fetch = context.fetch;
  const source = read('scripts/sw.template.js')
    .toString('utf8')
    .replace('__VERSION__', 'test')
    .replace('__ASSETS__', JSON.stringify(['/', '/style.css', '/js/main.js']));
  vm.runInNewContext(source, context);

  /** Dispatches a fetch event; returns the response body, or null if the worker did not respond. */
  async function request(url, {method = 'GET', mode = 'cors'} = {}) {
    let responded = null;
    const req = {url: url.startsWith('http') ? url : ORIGIN + url, method, mode};
    handlers.fetch({request: req, respondWith: (p) => (responded = Promise.resolve(p))});
    if (!responded) return null;
    const r = await responded.then(
      (x) => x,
      (e) => ({error: e.message}),
    );
    return r.error ? {error: r.error} : r.text();
  }
  return {handlers, stores, state, request, context};
}

async function install(worker) {
  let done;
  worker.handlers.install({waitUntil: (p) => (done = p)});
  await done;
}

test('worker: install keeps the shell for offline use', async () => {
  const w = createWorker();
  await install(w);
  assert.deepEqual([...w.stores.get('jk-shell-test').keys()].sort(), [
    '/',
    '/js/main.js',
    '/style.css',
  ]);
  assert.equal(w.state.skipped, true);
});

test('worker: old caches are removed on activation, other caches are left alone', async () => {
  const w = createWorker();
  w.stores.set('jk-shell-old', new Map());
  w.stores.set('someone-elses-cache', new Map());
  let done;
  w.handlers.activate({waitUntil: (p) => (done = p)});
  await done;
  assert.ok(!w.stores.has('jk-shell-old'));
  assert.ok(w.stores.has('someone-elses-cache'));
  assert.equal(w.state.claimed, true);
});

test('worker: private and non-shell traffic is never intercepted or cached', async () => {
  const w = createWorker();
  await install(w);
  assert.equal(await w.request('/api/football?action=picks'), null);
  assert.equal(await w.request('/api/football', {method: 'POST'}), null);
  assert.equal(await w.request('/s/abcdefABCDEF'), null, 'public share pages stay live');
  assert.equal(await w.request('https://other.example/x.js'), null);
  assert.equal(await w.request('/style.css', {method: 'POST'}), null);
  const keys = [...w.stores.get('jk-shell-test').keys()].join(' ');
  assert.ok(!keys.includes('api') && !keys.includes('/s/'));
});

test('worker: online requests use the network and refresh the cache', async () => {
  const w = createWorker();
  await install(w);
  assert.equal(await w.request('/js/main.js'), 'network:/js/main.js');
  assert.equal(
    await w.stores.get('jk-shell-test').get('/js/main.js').text(),
    'network:/js/main.js',
  );
});

test('worker: offline, the cached shell and files are served', async () => {
  const w = createWorker();
  await install(w);
  await w.request('/js/main.js'); // cached while online
  w.state.online = false;
  assert.equal(await w.request('/js/main.js'), 'network:/js/main.js');
  assert.equal(await w.request('/', {mode: 'navigate'}), 'network:/');
  assert.equal(
    await w.request('/some/deep/link', {mode: 'navigate'}),
    'network:/',
    'unknown pages fall back to the shell',
  );
  assert.ok(
    (await w.request('/never-cached.js'))?.error,
    'an uncached file fails normally offline',
  );
});

test('worker: one-time sign-in codes in the address are never written to the cache', async () => {
  const w = createWorker();
  await install(w);
  await w.request('/?code=secret-one-time-code&x=1', {mode: 'navigate'});
  await w.request('/?login=anothersecret', {mode: 'navigate'});
  const keys = [...w.stores.get('jk-shell-test').keys()].join(' ');
  assert.ok(!keys.includes('secret') && !keys.includes('code=') && !keys.includes('login='));
  assert.ok(w.stores.get('jk-shell-test').has('/'), 'the shell itself is refreshed under "/"');
  // Offline, the same address still opens the app.
  w.state.online = false;
  const offline = await w.request('/?code=secret-one-time-code', {mode: 'navigate'});
  assert.ok(offline.startsWith('network:/'), 'the cached shell opens the app');
});

test('worker: failed responses are not cached', async () => {
  const w = createWorker();
  await install(w);
  w.context.fetch = async () => new Response('nope', {status: 500});
  w.context.self.fetch = w.context.fetch;
  await w.request('/js/broken.js');
  assert.ok(!w.stores.get('jk-shell-test').has('/js/broken.js'));
});

// ---------- kickoff reminders ----------

async function pushed(w, data, {raw} = {}) {
  let done;
  w.handlers.push({
    data: {json: () => (raw ? JSON.parse(raw) : data)},
    waitUntil: (p) => (done = p),
  });
  await done;
  return w.state.shown;
}

test('worker: a push message becomes a notification with only safe fields', async () => {
  const w = createWorker();
  const shown = await pushed(w, {
    title: 'Kickoff soon',
    body: 'Arsenal vs Chelsea starts in about 30 minutes.',
    tag: 'kickoff-1',
    url: 'https://evil.example/',
  });
  assert.equal(shown.title, 'Kickoff soon');
  assert.equal(shown.options.body, 'Arsenal vs Chelsea starts in about 30 minutes.');
  assert.equal(shown.options.tag, 'kickoff-1');
  assert.ok(!JSON.stringify(shown).includes('evil.example'), 'addresses in messages are ignored');
});

test('worker: oversized or malformed push data is trimmed or replaced', async () => {
  const w = createWorker();
  const shown = await pushed(w, {title: 'x'.repeat(500), body: 'y'.repeat(900), tag: 42});
  assert.equal(shown.title.length, 80);
  assert.equal(shown.options.body.length, 200);
  assert.equal(shown.options.tag, undefined);

  const bad = createWorker();
  const fallback = await pushed(bad, null, {raw: '{not json'});
  assert.equal(fallback.title, 'JK MatchPredict');
});

test('worker: tapping a notification focuses the open app, or opens it at the home page', async () => {
  const focused = createWorker();
  focused.state.windows = [{focus: async () => (focused.state.focused = true)}];
  let closed = false;
  let done;
  focused.handlers.notificationclick({
    notification: {close: () => (closed = true)},
    waitUntil: (p) => (done = p),
  });
  await done;
  assert.ok(closed && focused.state.focused);
  assert.equal(focused.state.opened, undefined);

  const none = createWorker();
  none.handlers.notificationclick({notification: {close() {}}, waitUntil: (p) => (done = p)});
  await done;
  assert.equal(none.state.opened, '/');
});
