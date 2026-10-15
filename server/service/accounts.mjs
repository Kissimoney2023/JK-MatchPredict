import {createHash, randomBytes} from 'node:crypto';
import {AppError} from '../errors.mjs';
import {hash, HOUR, DAY} from '../util.mjs';

const SESSION_DAYS = 90;
const SESSION_CACHE_MS = 60_000;
const SESSION_CACHE_MAX = 500;
const MAX_CODE_LENGTH = 512;
const TOKEN_FORMAT = /^[a-f0-9]{64}$/;
// Sign-in methods the app knows how to read a profile from. AUTH_PROVIDERS (comma separated,
// default "github") chooses which ones are offered; each also needs enabling in Supabase.
const SUPPORTED_PROVIDERS = ['github', 'google'];
const DEFAULT_PROVIDERS = ['github'];

const base64url = (buffer) => Buffer.from(buffer).toString('base64url');

function withoutTrailingSlashes(url) {
  let out = String(url);
  while (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

/**
 * Optional accounts through Supabase Auth with GitHub sign-in (OAuth with PKCE). An account
 * links one person's picks across devices.
 *
 * Flow: startLogin -> browser goes to GitHub via Supabase -> returns to the app with `?code=`
 * -> completeLogin exchanges the code (using the PKCE verifier kept in an HttpOnly cookie),
 * stores a server-side session and merges the browser's anonymous picks into the account.
 * The Supabase service key never leaves the server.
 */
export function createAccounts({env, supabase, storage, now, mergePicks}) {
  const {budget} = storage;
  const sessionCache = new Map(); // token hash -> {account, until}

  /** Keeps the per-instance session cache bounded on long-lived servers. */
  function pruneSessionCache() {
    if (sessionCache.size <= SESSION_CACHE_MAX) return;
    for (const [k, v] of sessionCache) if (v.until <= now()) sessionCache.delete(k);
    // Still too big (many live sessions): drop the oldest entries; they are just re-read.
    for (const k of sessionCache.keys()) {
      if (sessionCache.size <= SESSION_CACHE_MAX) break;
      sessionCache.delete(k);
    }
  }

  function enabledProviders() {
    const wanted = String(env.AUTH_PROVIDERS || '')
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter((p) => SUPPORTED_PROVIDERS.includes(p));
    return wanted.length ? [...new Set(wanted)] : DEFAULT_PROVIDERS;
  }

  function info() {
    return supabase
      ? {enabled: true, providers: enabledProviders()}
      : {enabled: false, reason: 'Sign-in is not configured.'};
  }
  function assertEnabled() {
    if (!supabase) throw new AppError(503, 'accounts_disabled', 'Sign-in is not configured.');
  }

  /** Begins sign-in with one provider. Returns the URL to visit and the PKCE verifier for a short cookie. */
  async function startLogin({origin, ip, provider}) {
    assertEnabled();
    const chosen = provider || enabledProviders()[0];
    if (!enabledProviders().includes(chosen))
      throw new AppError(400, 'auth', 'That sign-in method is not available.');
    await budget('login-ip-' + hash(ip || 'unknown'), 30, HOUR);
    const verifier = base64url(randomBytes(48));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    const redirectTo = withoutTrailingSlashes(env.SITE_URL || origin) + '/';
    return {url: supabase.authorizeUrl({provider: chosen, redirectTo, challenge}), verifier};
  }

  /** Finishes sign-in: exchanges the code, upserts the profile, opens a session, merges picks. */
  async function completeLogin({code, verifier, anonymousSid}) {
    assertEnabled();
    const text = String(code || '');
    if (!text || text.length > MAX_CODE_LENGTH)
      throw new AppError(400, 'auth', 'Sign-in could not be completed. Please try again.');
    if (!verifier)
      throw new AppError(400, 'auth', 'The sign-in attempt expired. Please start again.');

    const result = await supabase.exchangeCode(text, verifier);
    const user = result?.user;
    if (!user?.id)
      throw new AppError(400, 'auth', 'Sign-in could not be completed. Please try again.');
    const meta = user.user_metadata ?? {};
    const profile = {
      id: user.id,
      email: user.email || meta.email || null,
      display_name:
        meta.user_name || meta.preferred_username || meta.name || meta.full_name || null,
      avatar_url: meta.avatar_url || meta.picture || null,
      provider: SUPPORTED_PROVIDERS.includes(user.app_metadata?.provider)
        ? user.app_metadata.provider
        : DEFAULT_PROVIDERS[0],
      last_login_at: new Date(now()).toISOString(),
    };
    await supabase.insert('profiles', [profile], {onConflict: 'id', merge: true});

    const authToken = randomBytes(32).toString('hex');
    await supabase.insert('sessions', [
      {
        token_hash: hash(authToken),
        user_id: user.id,
        email: profile.email,
        display_name: profile.display_name,
        expires_at: new Date(now() + SESSION_DAYS * DAY).toISOString(),
        revoked: false,
      },
    ]);
    const merged = anonymousSid ? await mergePicks('acct:' + user.id, anonymousSid) : 0;
    return {
      authToken,
      account: {id: user.id, email: profile.email, name: profile.display_name},
      avatarUrl: profile.avatar_url,
      merged,
      maxAgeSeconds: (SESSION_DAYS * DAY) / 1000,
    };
  }

  /** The signed-in account for an auth cookie value, or null (cached for a minute). */
  async function resolve(authToken) {
    if (!supabase || !TOKEN_FORMAT.test(String(authToken || ''))) return null;
    const key = hash(authToken);
    const cached = sessionCache.get(key);
    if (cached && cached.until > now()) return cached.account;

    const rows = await supabase.select('sessions', {
      token_hash: 'eq.' + key,
      select: 'user_id,email,display_name,expires_at,revoked',
      limit: '1',
    });
    const s = rows?.[0];
    const valid = s && !s.revoked && Date.parse(s.expires_at) > now();
    const account = valid ? {id: s.user_id, email: s.email, name: s.display_name} : null;
    sessionCache.set(key, {account, until: now() + SESSION_CACHE_MS});
    pruneSessionCache();
    return account;
  }

  async function logout(authToken) {
    if (!supabase || !TOKEN_FORMAT.test(String(authToken || ''))) return;
    const key = hash(authToken);
    sessionCache.delete(key);
    await supabase.update('sessions', {token_hash: 'eq.' + key}, {revoked: true});
  }

  return {info, startLogin, completeLogin, resolve, logout};
}
