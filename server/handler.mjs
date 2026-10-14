import {randomBytes, timingSafeEqual} from 'node:crypto';
import {createService, AppError, hash} from './service.mjs';
import {createStore} from './store/index.mjs';

const TOKEN_FORMAT = /^[a-f0-9]{64}$/;
const CLIENT_LIMIT = 45;
const CLIENT_WINDOW_MS = 60_000;
const MAX_BODY = 4096;
const ANONYMOUS_COOKIE_SECONDS = 31_536_000;

/** Best-effort client address from the platform's proxy headers. */
const clientIp = (request) =>
  request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
  request.headers.get('x-real-ip') ||
  'local';

/** Value of one cookie from a Cookie header, or null. */
function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * Builds a Web-standard `(Request) => Response` handler around a lazily created service.
 *
 * Identity: every browser gets an anonymous profile cookie (`jk_session`). A signed-in person
 * also carries `jk_auth`; their picks then live under their account instead of the browser.
 */
export function makeHandler(deps) {
  return async (request) => {
    const url = new URL(request.url);
    const cookies = request.headers.get('cookie');
    const existing = cookieValue(cookies, 'jk_session');
    const token = TOKEN_FORMAT.test(existing || '') ? existing : randomBytes(32).toString('hex');
    const authToken = cookieValue(cookies, 'jk_auth');
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    const cookieAttributes = `HttpOnly; SameSite=Lax; Path=/${secure}`;

    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
    });
    headers.append(
      'Set-Cookie',
      `jk_session=${token}; ${cookieAttributes}; Max-Age=${ANONYMOUS_COOKIE_SECONDS}`,
    );
    const json = (d, status = 200) => new Response(JSON.stringify(d), {status, headers});

    try {
      const service = deps();
      await service.budget('client-' + hash(clientIp(request)), CLIENT_LIMIT, CLIENT_WINDOW_MS);
      const action = url.searchParams.get('action') || 'status';
      const anonymousSid = hash(token);
      const account = await service.accounts.resolve(authToken);
      const sid = account ? 'acct:' + account.id : anonymousSid;

      if (request.method === 'GET') {
        if (action === 'status')
          return json({
            ...service.status(),
            account: account ? {email: account.email, name: account.name} : null,
          });
        if (action === 'leagues') return json(await service.catalog());
        if (action === 'fixtures') return json(await service.fixtures(url.searchParams));
        if (action === 'insights')
          return json(
            await service.insights(
              url.searchParams.get('key') || '',
              url.searchParams.get('listing') || '',
            ),
          );
        if (action === 'standings')
          return json(await service.standings(url.searchParams.get('league') || ''));
        if (action === 'forecast')
          return json(
            await service.forecast(
              url.searchParams.get('key') || '',
              url.searchParams.get('listing') || '',
            ),
          );
        if (action === 'picks') return json({picks: await service.picks(sid)});
        throw new AppError(404, 'route', 'Unknown request.');
      }

      if (request.method !== 'POST') throw new AppError(405, 'method', 'Method not allowed.');
      if (request.headers.get('origin') !== url.origin)
        throw new AppError(403, 'origin', 'Use this action from the app.');
      if (!request.headers.get('content-type')?.includes('application/json'))
        throw new AppError(415, 'content', 'JSON is required.');
      const text = await request.text();
      if (text.length > MAX_BODY) throw new AppError(413, 'size', 'Request too large.');
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new AppError(400, 'json', 'Invalid JSON.');
      }

      if (body.action === 'save')
        return json(await service.save(sid, body.forecastId, body.outcome));
      if (body.action === 'settle') return json(await service.settlePicks(sid));

      if (body.action === 'login-start') {
        const {url: authorizeUrl, verifier} = await service.accounts.startLogin({
          origin: url.origin,
          ip: clientIp(request),
        });
        // The PKCE verifier stays in a short-lived HttpOnly cookie until the sign-in returns.
        headers.append('Set-Cookie', `jk_pkce=${verifier}; ${cookieAttributes}; Max-Age=600`);
        return json({url: authorizeUrl});
      }
      if (body.action === 'login-complete') {
        const result = await service.accounts.completeLogin({
          code: body.code,
          verifier: cookieValue(cookies, 'jk_pkce'),
          anonymousSid,
        });
        headers.append(
          'Set-Cookie',
          `jk_auth=${result.authToken}; ${cookieAttributes}; Max-Age=${result.maxAgeSeconds}`,
        );
        headers.append('Set-Cookie', `jk_pkce=; ${cookieAttributes}; Max-Age=0`);
        return json({
          account: {email: result.account.email, name: result.account.name},
          avatarUrl: result.avatarUrl,
          merged: result.merged,
        });
      }
      if (body.action === 'logout') {
        await service.accounts.logout(authToken);
        headers.append('Set-Cookie', `jk_auth=; ${cookieAttributes}; Max-Age=0`);
        return json({ok: true});
      }
      throw new AppError(404, 'route', 'Unknown action.');
    } catch (e) {
      if (!(e instanceof AppError)) console.error('football handler error', e);
      return json(
        {
          error:
            e instanceof AppError
              ? e.message
              : 'Service unavailable. Check the Vercel function logs and storage configuration.',
          code: e.code || 'internal',
        },
        e.status || 500,
      );
    }
  };
}

/** Constant-time string comparison for secrets. */
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Handler for the scheduled cache warm-up. Requires `Authorization: Bearer <CRON_SECRET>`
 * (Vercel Cron sends this automatically when the CRON_SECRET env var is set).
 */
export function makePrefetchHandler(deps, env) {
  const respond = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'},
    });
  return async (request) => {
    if (!env.CRON_SECRET) return respond({error: 'CRON_SECRET is not configured.'}, 503);
    const auth = request.headers.get('authorization') || '';
    if (!safeEqual(auth, 'Bearer ' + env.CRON_SECRET))
      return respond({error: 'Unauthorized.'}, 401);
    try {
      return respond(await deps().prefetch());
    } catch (e) {
      console.error('prefetch failed', e);
      return respond({error: 'Prefetch failed.'}, 500);
    }
  };
}

let service;
const getService = () =>
  (service ??= createService({env: process.env, store: createStore(process.env)}));

/** Production handlers: environment-driven providers and storage, created once per instance. */
export const handler = makeHandler(getService);
export const prefetchHandler = makePrefetchHandler(getService, process.env);
