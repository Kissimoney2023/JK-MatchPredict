import {randomBytes, timingSafeEqual} from 'node:crypto';
import {createService, AppError, hash} from './service.mjs';
import {createStore} from './store/index.mjs';

const SESSION_COOKIE = /(?:^|;\s*)jk_session=([a-f0-9]{64})(?:;|$)/;
const CLIENT_LIMIT = 45;
const CLIENT_WINDOW_MS = 60_000;
const MAX_BODY = 4096;

/** Best-effort client address from the platform's proxy headers. */
const clientIp = (request) =>
  request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
  request.headers.get('x-real-ip') ||
  'local';

/** Builds a Web-standard `(Request) => Response` handler around a lazily created service. */
export function makeHandler(deps) {
  return async (request) => {
    const url = new URL(request.url);
    const token =
      request.headers.get('cookie')?.match(SESSION_COOKIE)?.[1] || randomBytes(32).toString('hex');
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      'Set-Cookie': `jk_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${url.protocol === 'https:' ? '; Secure' : ''}`,
    };
    const json = (d, status = 200) => new Response(JSON.stringify(d), {status, headers});

    try {
      const service = deps();
      await service.budget('client-' + hash(clientIp(request)), CLIENT_LIMIT, CLIENT_WINDOW_MS);
      const action = url.searchParams.get('action') || 'status';
      const sid = hash(token);

      if (request.method === 'GET') {
        if (action === 'status') return json(service.status());
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
