import {HOUR} from '../util.mjs';

const MEMO_MS = 2 * 60_000; // the checks touch Supabase, so repeat visits reuse a recent answer
const RUN_KEY = 'ops/last-run';
const TABLES = ['profiles', 'sessions', 'picks', 'shares'];
const STALE_RUN_MS = 36 * HOUR; // the scheduled job should run at least daily

const ago = (ms) => {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} hours ago` : `${Math.round(hours / 24)} days ago`;
};

/**
 * A setup check for the site owner: what is configured, what works, and how to fix what does
 * not. It reports only whether things are set and whether they are accepted, never a key or a
 * value, so it is safe to show without signing in. Checks that call Supabase are reused for
 * two minutes.
 */
export function createDiagnostics({env, now, storage, store, supabase, accountProviders}) {
  const {read, atomic} = storage;
  let memo = null;

  const item = (id, label, state, detail, fix) => ({
    id,
    label,
    state,
    detail,
    ...(fix ? {fix} : {}),
  });

  /** The scheduled job calls this after each run, so the check can say when it last ran. */
  async function recordRun(summary = {}) {
    try {
      await atomic(RUN_KEY, () => ({
        at: now(),
        errors: Array.isArray(summary.errors) ? summary.errors.length : 0,
      }));
    } catch {
      // bookkeeping only
    }
  }

  function footballItems() {
    const set = [
      env.API_FOOTBALL_KEY && 'API-Football',
      env.FOOTBALL_DATA_ORG_KEY && 'football-data.org',
    ].filter(Boolean);
    const out = [
      set.length
        ? item('football', 'Football data', 'ok', `Connected: ${set.join(' and ')}.`)
        : item(
            'football',
            'Football data',
            'missing',
            'No football data key is set, so no matches can be listed.',
            'Set API_FOOTBALL_KEY or FOOTBALL_DATA_ORG_KEY in Vercel and redeploy.',
          ),
    ];
    out.push(
      env.STRIKERAPI_API_KEY
        ? item('striker', 'StrikerAPI (market odds, Elo)', 'ok', 'Connected.')
        : item(
            'striker',
            'StrikerAPI (market odds, Elo)',
            'info',
            'Not set. Optional: adds bookmaker-based forecasts, Elo and head-to-head.',
          ),
    );
    return out;
  }

  function storageItem() {
    return store.kind === 'redis'
      ? item('storage', 'Storage', 'ok', 'Durable (Upstash Redis).')
      : item(
          'storage',
          'Storage',
          'warn',
          'Temporary memory: browser-profile picks, reminders and caches are lost whenever the server restarts.',
          'Connect Upstash Redis in Vercel (KV_REST_API_URL and KV_REST_API_TOKEN) and redeploy.',
        );
  }

  async function accountItems() {
    if (!supabase)
      return [
        item(
          'accounts',
          'Accounts',
          'info',
          'Not set up. Optional: sign-in and picks that follow you across devices.',
          'Set SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY (see the README).',
        ),
      ];
    const out = [];

    // The publishable key, and the sign-in providers it can see, in one live request.
    const hasPublishable = !!(
      env.SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    );
    let settings = null;
    try {
      settings = await supabase.settings();
      out.push(
        item(
          'supabase-key',
          'Supabase sign-in key',
          hasPublishable ? 'ok' : 'warn',
          hasPublishable
            ? 'The publishable key is accepted by Supabase.'
            : 'SUPABASE_PUBLISHABLE_KEY is not set; the secret key is being used for sign-in instead.',
          hasPublishable
            ? undefined
            : 'Set SUPABASE_PUBLISHABLE_KEY (sb_publishable_…) from Supabase → Project Settings → API Keys.',
        ),
      );
    } catch (e) {
      // Supabase itself not answering is a different problem from a refused key.
      if (e?.code === 'database')
        return [
          item(
            'supabase-key',
            'Supabase',
            'warn',
            'Supabase did not answer just now (it may be paused or briefly down).',
            'Open the Supabase dashboard: free projects pause after about a week of inactivity and show a “Restore project” button.',
          ),
        ];
      out.push(
        item(
          'supabase-key',
          'Supabase sign-in key',
          'error',
          hasPublishable
            ? 'Supabase refused the publishable key set in SUPABASE_PUBLISHABLE_KEY.'
            : 'SUPABASE_PUBLISHABLE_KEY is not set, and Supabase refused the secret key for sign-in.',
          'Copy the publishable key (sb_publishable_…) from Supabase → Project Settings → API Keys into SUPABASE_PUBLISHABLE_KEY in Vercel (no quotes or spaces) and redeploy.',
        ),
      );
    }

    if (settings) {
      for (const name of accountProviders()) {
        const on = !!settings.external?.[name];
        const label = name === 'github' ? 'GitHub' : name === 'google' ? 'Google' : name;
        out.push(
          on
            ? item(`provider-${name}`, `${label} sign-in`, 'ok', `${label} is enabled in Supabase.`)
            : item(
                `provider-${name}`,
                `${label} sign-in`,
                'error',
                `${label} is not enabled in Supabase, so its button cannot work.`,
                `Supabase → Authentication → Sign In / Providers → ${label}: enable it and paste its client ID and secret.`,
              ),
        );
      }
    }

    // The tables the app needs (supabase/schema.sql). The secret key can read each one.
    const missing = [];
    for (const table of TABLES) {
      try {
        await supabase.select(table, {select: '*', limit: '1'});
      } catch {
        missing.push(table);
      }
    }
    out.push(
      missing.length
        ? item(
            'supabase-tables',
            'Supabase tables',
            'error',
            `Could not read: ${missing.join(', ')}. Either the tables are missing or the secret key is wrong.`,
            'Run supabase/schema.sql in Supabase → SQL Editor (it is safe to run again), and check SUPABASE_SECRET_KEY.',
          )
        : item(
            'supabase-tables',
            'Supabase tables',
            'ok',
            'profiles, sessions, picks and shares are all readable.',
          ),
    );
    return out;
  }

  async function jobItems() {
    const out = [];
    const last = await read(RUN_KEY);
    const secret = !!env.CRON_SECRET;
    if (!secret)
      out.push(
        item(
          'cron',
          'Scheduled job',
          'warn',
          'CRON_SECRET is not set, so the scheduled job (cache warm-up, reminders, pick results, picks of the day) is refused.',
          'Set CRON_SECRET in Vercel (a long random string) and redeploy.',
        ),
      );
    else if (!last)
      out.push(
        item(
          'cron',
          'Scheduled job',
          'warn',
          'It has not run yet. Vercel runs it once a day at 05:00 UTC.',
          'Run it once now: open /api/prefetch with the header “Authorization: Bearer <CRON_SECRET>”, or add the GitHub secrets SITE_URL and CRON_SECRET to run it every 15 minutes.',
        ),
      );
    else if (now() - last.at > STALE_RUN_MS)
      out.push(
        item(
          'cron',
          'Scheduled job',
          'warn',
          `It last ran ${ago(now() - last.at)}; it should run at least daily.`,
          'Check the cron in the Vercel dashboard and the CRON_SECRET value.',
        ),
      );
    else
      out.push(
        item(
          'cron',
          'Scheduled job',
          'ok',
          `Last ran ${ago(now() - last.at)}${last.errors ? ` (${last.errors} step${last.errors === 1 ? '' : 's'} reported a problem)` : ''}.`,
        ),
      );

    const vapid = [!!env.VAPID_PUBLIC_KEY, !!env.VAPID_PRIVATE_KEY];
    out.push(
      vapid[0] && vapid[1]
        ? item('reminders', 'Reminders', 'ok', 'Push notification keys are set.')
        : vapid[0] || vapid[1]
          ? item(
              'reminders',
              'Reminders',
              'error',
              'Only one of VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY is set, so reminders are off.',
              'Set both (npx web-push generate-vapid-keys) and redeploy.',
            )
          : item(
              'reminders',
              'Reminders',
              'info',
              'Not set. Optional: kickoff and result notifications.',
            ),
    );

    const potd = await read('potd/current');
    out.push(
      potd
        ? item(
            'potd',
            'Picks of the day',
            'ok',
            `Worked out ${ago(now() - potd.computedAt)} (${potd.picks?.length ?? 0} pick${potd.picks?.length === 1 ? '' : 's'} from ${potd.checked ?? 0} forecasts).`,
          )
        : item(
            'potd',
            'Picks of the day',
            'info',
            'Not worked out yet. It is computed by the scheduled job, or by the first visitor.',
          ),
    );
    return out;
  }

  /** Runs every check. Never throws: a check that fails is reported as such. */
  async function run() {
    if (memo && now() - memo.at < MEMO_MS) return memo.result;
    const items = [
      ...footballItems(),
      storageItem(),
      ...(await accountItems()),
      ...(await jobItems()),
      env.SITE_URL
        ? item('site', 'Site address', 'ok', 'SITE_URL is set.')
        : item(
            'site',
            'Site address',
            'info',
            'SITE_URL is not set; the address of each request is used.',
          ),
    ];
    const result = {
      checkedAt: now(),
      summary: {
        problems: items.filter((i) => i.state === 'error' || i.state === 'missing').length,
        warnings: items.filter((i) => i.state === 'warn').length,
      },
      items,
    };
    memo = {at: now(), result};
    return result;
  }

  return {run, recordRun};
}
