import {createHash, randomBytes} from 'node:crypto';

export const SUPABASE_URL = 'https://proj.supabase.co';
export const SERVICE_KEY = 'sb_secret_testsecret';
export const PUBLISHABLE_KEY = 'sb_publishable_testpublic';

const PRIMARY_KEYS = {
  profiles: ['id'],
  sessions: ['token_hash'],
  picks: ['user_id', 'canonical'],
};
const RESERVED = new Set(['select', 'order', 'limit', 'on_conflict']);

const challengeOf = (verifier) => createHash('sha256').update(verifier).digest('base64url');

/** Applies PostgREST-style filters (`col=eq.value`, `col=is.null`) to rows. */
function filtered(rows, params) {
  return rows.filter((row) => {
    for (const [col, expr] of params.entries()) {
      if (RESERVED.has(col)) continue;
      if (expr === 'is.null') {
        if (row[col] !== null && row[col] !== undefined) return false;
      } else if (expr.startsWith('eq.')) {
        if (String(row[col]) !== expr.slice(3)) return false;
      } else throw new Error('fake supabase: unsupported filter ' + col + '=' + expr);
    }
    return true;
  });
}

/**
 * A small in-memory stand-in for the Supabase REST (PostgREST) and Auth APIs: just enough
 * of their behaviour for the app's calls, including real PKCE verification.
 */
export function createFakeSupabase() {
  const tables = {profiles: [], sessions: [], picks: []};
  const codes = new Map(); // auth code -> {user, challenge}
  const requests = [];
  let failing = false;

  /** Simulates the redirect back from GitHub: returns the `code` the browser would receive. */
  function issueCode(user, authorizeUrl) {
    const challenge = new URL(authorizeUrl).searchParams.get('code_challenge');
    const code = randomBytes(12).toString('hex');
    codes.set(code, {user, challenge});
    return code;
  }

  const fetcher = async (input, opts = {}) => {
    const url = new URL(input);
    const method = opts.method ?? 'GET';
    requests.push({method, path: url.pathname, query: url.search, headers: opts.headers});
    if (failing) return Response.json({message: 'down'}, {status: 503});
    const apikey = opts.headers?.apikey;
    // Like the real gateway: the new keys are not JWTs, so they must not be sent as Bearer tokens.
    if (apikey?.startsWith('sb_') && opts.headers?.Authorization)
      return Response.json({message: 'Expected 3 parts in JWT; got 1'}, {status: 401});
    const isAuth = url.pathname.startsWith('/auth/v1/');
    if (isAuth ? ![SERVICE_KEY, PUBLISHABLE_KEY].includes(apikey) : apikey !== SERVICE_KEY)
      return Response.json({message: 'bad key'}, {status: 401});

    if (url.pathname === '/auth/v1/token') {
      const {auth_code: code, code_verifier: verifier} = JSON.parse(opts.body);
      const entry = codes.get(code);
      codes.delete(code); // one time only
      if (!entry || !verifier || challengeOf(verifier) !== entry.challenge)
        return Response.json({error: 'invalid_grant'}, {status: 400});
      return Response.json({access_token: 'jwt', token_type: 'bearer', user: entry.user});
    }

    const match = url.pathname.match(/^[/]rest[/]v1[/](profiles|sessions|picks)$/);
    if (!match) return Response.json({message: 'not found'}, {status: 404});
    const table = tables[match[1]];
    const keys = PRIMARY_KEYS[match[1]];
    const prefer = opts.headers?.Prefer ?? '';
    const body = opts.body ? JSON.parse(opts.body) : null;
    const params = url.searchParams;

    if (method === 'GET') {
      let rows = filtered(table, params);
      const order = params.get('order');
      if (order) {
        const [col, dir] = order.split('.');
        rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0));
        if (dir === 'desc') rows.reverse();
      }
      if (params.get('limit')) rows = rows.slice(0, Number(params.get('limit')));
      const select = params.get('select');
      if (select && select !== '*')
        rows = rows.map((r) => Object.fromEntries(select.split(',').map((c) => [c, r[c]])));
      return Response.json(rows);
    }

    if (method === 'POST') {
      const conflictKeys = params.get('on_conflict')?.split(',') ?? keys;
      const written = [];
      for (const row of body) {
        const existing = table.find((r) => conflictKeys.every((k) => r[k] === row[k]));
        if (existing) {
          if (prefer.includes('ignore-duplicates')) continue;
          if (prefer.includes('merge-duplicates')) {
            Object.assign(existing, row);
            written.push(existing);
            continue;
          }
          return Response.json({code: '23505'}, {status: 409});
        }
        const stored = {...row};
        table.push(stored);
        written.push(stored);
      }
      return Response.json(prefer.includes('return=representation') ? written : null, {
        status: 201,
      });
    }

    if (method === 'PATCH') {
      const rows = filtered(table, params);
      for (const row of rows) Object.assign(row, body);
      return Response.json(rows);
    }
    return Response.json({message: 'unsupported'}, {status: 405});
  };

  return {
    fetcher,
    tables,
    requests,
    issueCode,
    setFailing: (value) => (failing = value),
  };
}
