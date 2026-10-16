import {AppError} from './errors.mjs';

const TIMEOUT_MS = 10_000;

function withoutTrailingSlashes(url) {
  let out = String(url);
  while (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

/**
 * Plain-language reason a sign-in (Auth) call was refused, from Supabase's own error code.
 * Only short, safe codes are echoed back; secrets and long messages never are.
 */
export function authFailure(status, bodyText) {
  let body = null;
  try {
    body = JSON.parse(bodyText);
  } catch {
    // not JSON: classify by status alone
  }
  const code = String(body?.error_code || body?.code || body?.error || '')
    .toLowerCase()
    .slice(0, 60);
  const words =
    `${code} ${body?.msg ?? ''} ${body?.message ?? ''} ${body?.error_description ?? ''} ${bodyText}`.toLowerCase();
  const start = 'Sign-in could not be completed';

  if (status === 401 || status === 403 || /api key|apikey|invalid jwt|jwt/.test(words))
    return `${start}: Supabase rejected this site's API key. If you run this site, check the Supabase keys in Vercel (SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY).`;
  if (status === 429 || /rate_limit|too many/.test(words))
    return `${start}: too many attempts. Wait a minute and try again.`;
  if (/flow_state|code_verifier|invalid_grant|auth.?code|expired|not.?found/.test(words))
    return `${start}: that attempt expired or was already used. Please press the sign-in button again.`;
  const safe = /^[a-z0-9_-]{1,40}$/.test(code) ? ` (Supabase says: ${code})` : '';
  return `${start}${safe}. Please try again.`;
}

/**
 * Minimal Supabase client over fetch (no SDK): PostgREST tables and the Auth PKCE endpoints.
 * `key` is the server-only secret key (sb_secret_..., or the legacy service_role JWT): it
 * bypasses Row Level Security and must never reach a browser. `authKey` (the publishable key)
 * is used for the Auth code exchange, which needs no elevated rights; it defaults to `key`.
 *
 * Supabase's new keys are not JWTs: they go on the `apikey` header only. Only a legacy JWT
 * key is also sent as a Bearer token.
 */
export function createSupabase({url, key, authKey, fetcher}) {
  const base = withoutTrailingSlashes(url);

  /** `authCall` marks Auth requests, where a 4xx means "this sign-in cannot be completed". */
  async function call(path, {method = 'GET', query, body, prefer, authCall = false} = {}) {
    const target = base + path + (query ? '?' + new URLSearchParams(query) : '');
    const apiKey = authCall ? (authKey ?? key) : key;
    const headers = {apikey: apiKey, 'Content-Type': 'application/json'};
    if (apiKey.startsWith('eyJ')) headers.Authorization = 'Bearer ' + apiKey; // legacy JWT keys
    if (prefer) headers.Prefer = prefer;
    let response;
    try {
      response = await fetcher(target, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      console.error('[supabase] request failed', method, path, e?.name);
      throw new AppError(502, 'database', 'The database is temporarily unavailable.');
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      console.warn(`[supabase] HTTP ${response.status} ${method} ${path}: ${detail}`);
      if (authCall && response.status < 500)
        throw new AppError(400, 'auth', authFailure(response.status, detail));
      throw new AppError(502, 'database', 'The database is temporarily unavailable.');
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    select: (table, query) => call('/rest/v1/' + table, {query}),

    /** Inserts rows and returns the rows actually written (duplicates are skipped or merged). */
    insert(table, rows, {onConflict, ignoreDuplicates = false, merge = false} = {}) {
      const prefer = ['return=representation'];
      if (ignoreDuplicates) prefer.push('resolution=ignore-duplicates');
      if (merge) prefer.push('resolution=merge-duplicates');
      return call('/rest/v1/' + table, {
        method: 'POST',
        query: onConflict ? {on_conflict: onConflict} : undefined,
        body: rows,
        prefer: prefer.join(','),
      });
    },

    update: (table, query, patch) =>
      call('/rest/v1/' + table, {
        method: 'PATCH',
        query,
        body: patch,
        prefer: 'return=representation',
      }),

    /** Deletes the rows matching `query` and returns them. */
    delete: (table, query) =>
      call('/rest/v1/' + table, {method: 'DELETE', query, prefer: 'return=representation'}),

    /** The GitHub (or other provider) sign-in URL for the PKCE flow. */
    authorizeUrl: ({provider, redirectTo, challenge}) =>
      base +
      '/auth/v1/authorize?' +
      new URLSearchParams({
        provider,
        redirect_to: redirectTo,
        code_challenge: challenge,
        code_challenge_method: 's256',
      }),

    /** Exchanges the one-time `code` from the redirect for the signed-in user. */
    exchangeCode: (code, verifier) =>
      call('/auth/v1/token', {
        method: 'POST',
        query: {grant_type: 'pkce'},
        body: {auth_code: code, code_verifier: verifier},
        authCall: true,
      }),
  };
}
