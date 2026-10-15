import {AppError} from '../errors.mjs';
import {hash} from '../util.mjs';

const LEAD_MS = 45 * 60_000; // remind when a picked match starts within this long
const MAX_SUBSCRIPTIONS = 2000;
const MAX_PER_PROFILE = 5;
const MAX_SENDS_PER_RUN = 200;
const NOTIFIED_KEPT = 100;
const SETTLE_AFTER_MS = 105 * 60_000; // matches are rarely over sooner than this
const SETTLE_WINDOW_MS = 8 * 3_600_000; // after that, people can use "Check results"
const RECHECK_MS = 30 * 60_000;
const MAX_SETTLE_LOOKUPS_PER_RUN = 6; // protects the football data quotas
const CHECKED_KEPT = 50;
const OUTCOMES = ['home win', 'draw', 'away win'];

// The browser vendors' push services. The server posts to whatever address a subscription
// names, so only these hosts are accepted: nobody can point it at an internal address.
const PUSH_HOSTS = [
  'fcm.googleapis.com',
  '.push.services.mozilla.com',
  '.push.apple.com',
  '.notify.windows.com',
];

const subKey = (endpoint) => 'push/sub/' + hash(endpoint);

function allowedEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  return PUSH_HOSTS.some((h) =>
    h.startsWith('.') ? url.hostname.endsWith(h) : url.hostname === h,
  );
}

const isKey = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(value);

/** Default sender: the `web-push` library, loaded only when reminders are configured. */
function defaultSender(env) {
  let ready;
  return async (subscription, payload) => {
    ready ??= import('web-push').then((mod) => {
      const webpush = mod.default ?? mod;
      webpush.setVapidDetails(
        env.VAPID_SUBJECT || 'mailto:admin@example.com',
        env.VAPID_PUBLIC_KEY,
        env.VAPID_PRIVATE_KEY,
      );
      return webpush;
    });
    const webpush = await ready;
    await webpush.sendNotification(subscription, JSON.stringify(payload), {TTL: 3600});
  };
}

const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));

/** What to tell someone whose picked matches start soon. */
export function buildPayload(due, now) {
  if (due.length === 1) {
    const {pick, kickoff} = due[0];
    const f = pick.forecast;
    return {
      title: 'Kickoff soon',
      body: `${f.home} vs ${f.away} starts in about ${minutes(kickoff - now)} minutes. Your pick: ${OUTCOMES[pick.outcome] ?? 'saved'}.`,
      tag: 'kickoff-' + pick.id,
      url: '/',
    };
  }
  const latest = Math.max(...due.map((d) => d.kickoff));
  return {
    title: 'Kickoff soon',
    body: `${due.length} of your picked matches start within about ${minutes(latest - now)} minutes.`,
    tag: 'kickoff-group',
    url: '/',
  };
}

/** What to tell someone whose picks were just settled. */
export function buildResultPayload(settled) {
  const words = {correct: 'was correct', incorrect: 'was not correct', void: 'is void'};
  if (settled.length === 1) {
    const {pick, result, score} = settled[0];
    const f = pick.forecast;
    const match = score ? `${f.home} ${score} ${f.away}` : `${f.home} vs ${f.away}`;
    return {
      title: 'Match result',
      body: `${match}. Your pick ${words[result] ?? 'was settled'}.`,
      tag: 'result-' + pick.id,
      url: '/',
    };
  }
  const count = (r) => settled.filter((s) => s.result === r).length;
  const parts = [
    [count('correct'), 'correct'],
    [count('incorrect'), 'not correct'],
    [count('void'), 'void'],
  ]
    .filter(([n]) => n)
    .map(([n, label]) => `${n} ${label}`);
  return {
    title: 'Match results',
    body: `${settled.length} of your picks were settled: ${parts.join(', ')}.`,
    tag: 'result-group',
    url: '/',
  };
}

/**
 * Kickoff reminders through browser push notifications. A browser subscribes (with its
 * permission); the scheduled job then tells each subscriber about picks that are about to start.
 * Only virtual picks the person already made are mentioned.
 */
export function createReminders({env, now, storage, pickStore, settleDue, send}) {
  const {read, atomic} = storage;
  const sendPush = send ?? defaultSender(env);
  const enabled = () => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

  const info = () =>
    enabled() ? {enabled: true, publicKey: env.VAPID_PUBLIC_KEY} : {enabled: false};

  function assertEnabled() {
    if (!enabled())
      throw new AppError(503, 'push_disabled', 'Reminders are not configured on this site.');
  }

  /** Saves (or re-links) a browser's push subscription for a profile. */
  async function subscribe(sid, subscription) {
    assertEnabled();
    const endpoint = subscription?.endpoint;
    const keys = subscription?.keys;
    if (
      typeof endpoint !== 'string' ||
      endpoint.length > 600 ||
      !allowedEndpoint(endpoint) ||
      !isKey(keys?.p256dh) ||
      !isKey(keys?.auth)
    )
      throw new AppError(400, 'push_invalid', 'That subscription is not valid.');

    const h = hash(endpoint);
    let refused = null;
    await atomic('push/index', (old) => {
      const subs = old?.subs ?? [];
      const known = subs.find((s) => s.h === h);
      if (known) {
        if (known.sid === sid) return undefined;
        return {subs: subs.map((s) => (s.h === h ? {h, sid} : s))};
      }
      if (subs.length >= MAX_SUBSCRIPTIONS) {
        refused = new AppError(503, 'push_full', 'Reminders are full right now. Try again later.');
        return undefined;
      }
      if (subs.filter((s) => s.sid === sid).length >= MAX_PER_PROFILE) {
        refused = new AppError(409, 'push_limit', 'Too many devices are subscribed already.');
        return undefined;
      }
      return {subs: [...subs, {h, sid}]};
    });
    if (refused) throw refused;

    await atomic(subKey(endpoint), (old) => ({
      endpoint,
      keys: {p256dh: keys.p256dh, auth: keys.auth},
      sid,
      createdAt: old?.createdAt ?? now(),
      notified: old?.notified ?? [],
    }));
    return {subscribed: true};
  }

  async function forget(endpoint) {
    const h = hash(endpoint);
    await atomic('push/index', (old) => {
      const subs = old?.subs ?? [];
      return subs.some((s) => s.h === h) ? {subs: subs.filter((s) => s.h !== h)} : undefined;
    });
    await atomic(subKey(endpoint), () => ({deleted: true})); // tombstone; the index no longer lists it
  }

  async function unsubscribe(endpoint) {
    if (typeof endpoint !== 'string' || !allowedEndpoint(endpoint))
      throw new AppError(400, 'push_invalid', 'That subscription is not valid.');
    await forget(endpoint);
    return {subscribed: false};
  }

  /** One pass of the scheduled job: sends a reminder to every subscriber with a match starting soon. */
  async function run() {
    const summary = {
      enabled: enabled(),
      subscribers: 0,
      sent: 0,
      settled: 0,
      removed: 0,
      errors: 0,
    };
    let lookups = 0;
    if (!enabled()) return summary;
    const index = (await read('push/index'))?.subs ?? [];
    summary.subscribers = index.length;
    const t = now();

    /** Sends one notification. Returns false when the browser has gone away (it is forgotten). */
    async function deliver(subscription, payload) {
      try {
        await sendPush({endpoint: subscription.endpoint, keys: subscription.keys}, payload);
        summary.sent++;
        return true;
      } catch (e) {
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await forget(subscription.endpoint); // the browser unsubscribed or expired
          summary.removed++;
        } else {
          summary.errors++;
          console.error('reminder send failed', e?.statusCode ?? '', e?.message ?? e);
        }
        return false;
      }
    }

    for (const {h, sid} of index) {
      if (summary.sent >= MAX_SENDS_PER_RUN) break;
      try {
        let subscription = await findSubscription(h, sid);
        if (!subscription) continue;

        // 1. Kickoff reminders.
        const picks = await pickStore.list(subscription.sid);
        const done = new Set(subscription.notified);
        const due = picks
          .map((pick) => ({pick, kickoff: Date.parse(pick.forecast?.kickoff)}))
          .filter(
            (d) =>
              !d.pick.result &&
              Number.isFinite(d.kickoff) &&
              d.kickoff > t &&
              d.kickoff - t <= LEAD_MS &&
              !done.has(d.pick.id),
          )
          .sort((a, b) => a.kickoff - b.kickoff);
        if (due.length) {
          if (!(await deliver(subscription, buildPayload(due, t)))) continue;
          const ids = due.map((d) => d.pick.id);
          await atomic(subKey(subscription.endpoint), (old) =>
            old?.endpoint
              ? {...old, notified: [...old.notified, ...ids].slice(-NOTIFIED_KEPT)}
              : undefined,
          );
        }

        // 2. Results: settle finished matches and tell the person.
        if (!settleDue || lookups >= MAX_SETTLE_LOOKUPS_PER_RUN) continue;
        const recent = (p) => {
          const kickoff = Date.parse(p.forecast?.kickoff);
          return Number.isFinite(kickoff) && kickoff > t - SETTLE_WINDOW_MS;
        };
        const checked = subscription.checked ?? {};
        const outcome = await settleDue(subscription.sid, {
          limit: MAX_SETTLE_LOOKUPS_PER_RUN - lookups,
          skip: (p) => !recent(p) || (checked[p.id] ?? 0) > t - RECHECK_MS,
        });
        lookups += outcome.attempted.length;
        if (outcome.attempted.length) {
          const stamps = Object.fromEntries(outcome.attempted.map((p) => [p.id, t]));
          subscription =
            (await atomic(subKey(subscription.endpoint), (old) =>
              old?.endpoint
                ? {
                    ...old,
                    checked: Object.fromEntries(
                      Object.entries({...(old.checked ?? {}), ...stamps})
                        .sort((a, b) => a[1] - b[1])
                        .slice(-CHECKED_KEPT),
                    ),
                  }
                : undefined,
            )) ?? subscription;
        }
        if (outcome.settledPicks.length) {
          summary.settled += outcome.settledPicks.length;
          await deliver(subscription, buildResultPayload(outcome.settledPicks));
        }
      } catch (e) {
        summary.errors++;
        console.error('reminder run failed for one subscriber', e?.message ?? e);
      }
    }
    return summary;
  }

  /** The stored subscription for an index entry, or null if it is gone. */
  async function findSubscription(h, sid) {
    const record = await read('push/sub/' + h);
    return record?.endpoint ? {...record, sid: record.sid ?? sid} : null;
  }

  return {info, enabled, subscribe, unsubscribe, run};
}
