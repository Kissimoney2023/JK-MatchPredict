# JK MatchPredict — Vercel edition

A deployable football match explorer, probability dashboard, prediction/tips view and virtual-pick journal. This edition is independent of the earlier ChatGPT Sites deployment.

## Included features

- Searchable competition catalog from configured APIs, including their countries.
- All-league fixtures for a selected UTC day, or a selected league over up to 31 days.
- Every match returned in that range, with team search, match-status filters and 20-card client-side pagination. There is no fixed 12-match cap.
- Pre-match home/draw/away probabilities, favored outcome (including draws), and a clear recommendation to skip closely matched games.
- Double-chance tips derived from outcome probabilities. Goals and both-teams-to-score estimates appear only with the fallback goal model.
- API-Football primary; football-data.org fallback where the competition and match can be verified.
- Forecast source, timestamps, model limitations and missing-data states.
- Private server-stored virtual picks, frozen at save, accessible through a browser-profile cookie.
- Result checking and JSON export. No deposits, wagers, wallets or payments.
- Explicit demo mode with invented examples, available even before keys are configured.

## Deploy to Vercel

1. Push this repository to GitHub and import it in Vercel (Add New → Project). `vercel.json` sets the build command (`npm run build`) and output directory (`dist`); the `api/` folder is deployed automatically as a Vercel Function at `/api/football`. Use Node 22 (Project Settings → General → Node.js Version).
2. In Vercel → Storage, add **Upstash Redis** (Marketplace) and connect it to the project. It injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`, which the app uses for the cache, quota counters, forecast snapshots and picks. Without it the app falls back to temporary in-memory storage (picks and quotas can reset between requests) and the page says so.
3. Add the environment variables below under Settings → Environment Variables (Production, and Preview if wanted). Do not prefix them with `NEXT_PUBLIC_` or expose them to browser code.
4. Redeploy after saving the variables.
5. Open the deployed URL. The page opens on the Champions League with upcoming matches for the next 30 days (when a connected provider covers it). Request one forecast, save a pick and verify it appears in My picks.

The static site is built into `dist` (`npm run build`). Deploy the whole Git project, not just `dist`, otherwise the API function is omitted.

## Environment variables

Use `.env.example` as the template:

```dotenv
API_FOOTBALL_KEY=your_direct_api_sports_key
FOOTBALL_DATA_ORG_KEY=your_football_data_org_token
API_FOOTBALL_DAILY_LIMIT=100
```

- `API_FOOTBALL_KEY`: direct API-Football/API-Sports key. A RapidAPI credential is not interchangeable.
- `FOOTBALL_DATA_ORG_KEY`: football-data.org API token.
- `RESEND_API_KEY`, `AUTH_FROM_EMAIL`, optional `SITE_URL`: email sign-in (see Accounts).
- `STRIKERAPI_API_KEY`: optional StrikerAPI key (see StrikerAPI above). `STRIKERAPI_MONTHLY_CREDITS`: credit cap, default 450. `STRIKERAPI_MARKET_FORECASTS`: `off` disables market-based forecasts.
- `CRON_SECRET`: secret for `/api/prefetch` (see Scheduled prefetch). `PREFETCH_COMPETITIONS`: optional competition codes to warm, default `CL`.
- `API_FOOTBALL_DAILY_LIMIT`: optional daily application budget; default 100. Change it only to match your allowance. Other apps using the same key can consume the provider's quota independently.

Either key can run the app alone. Both are needed for primary-to-fallback failover. API-Football free season access is limited; football-data.org covers a smaller set of leagues and its free scores/schedules may be delayed. League presence in a catalog does not guarantee access to every season, forecast, team history or match.

Provider signup:

- https://dashboard.api-football.com/
- https://www.football-data.org/client/register

Local `.env` files are not production secrets. Add the values in Vercel project settings and redeploy. Do not commit keys.

## Local development

```sh
npm ci
npx vercel dev   # serves dist/ and the /api function; needs the Vercel CLI and a linked project
```

`vercel dev` pulls environment variables from the linked project. A plain static server can preview the UI/demo, but cannot supply live APIs or saved picks.

Checks:

```sh
npm test
npm run build
```

The build copies public assets and fonts into `dist` and verifies that the function bundles with esbuild. Automated tests use mocked football responses and a conditional-write storage adapter; they do not prove paid/free plan coverage or real API accuracy.

## Accounts (optional email sign-in)

Without an account, picks live in a private server-side profile tied to the browser's cookie. With accounts, a person signs in with an email magic link and their picks follow them to every device. Signing in is optional; picks saved in the browser are merged into the account on first sign-in (duplicates are skipped).

**Requirements.** Accounts switch themselves off (the Sign in button is hidden) unless both are in place:

1. **Durable storage**: connect Upstash Redis in Vercel Storage. The temporary in-memory store is refused, because accounts and sessions would vanish between requests.
2. **An email sender**: `RESEND_API_KEY` and `AUTH_FROM_EMAIL` (for example `JK MatchPredict <login@yourdomain.com>`). The sending domain must be verified in Resend, otherwise Resend only delivers to your own address. Optional `SITE_URL` (for example `https://your-app.vercel.app`) fixes the origin used in email links; without it the request's own origin is used.

**How it works.** The email contains `<site>/?login=<token>`. Opening it shows a "Finish signing in" button, and only pressing it signs in; this stops mail scanners that merely fetch links from using up the one-time token. The token is 256-bit random, stored hashed, valid for 15 minutes and usable once (also under concurrent use). The browser address bar is cleaned as soon as the page loads. A successful sign-in sets an `HttpOnly`, `SameSite=Lax`, `Secure` cookie (`jk_auth`, 90 days) that is separate from the anonymous profile cookie, so signing out simply removes it. The same email always maps to the same account, and the reply to a sign-in request never reveals whether an account exists.

**Limits.** Three sign-in emails per address per 15 minutes and ten per client address per hour. Accounts store only the email address and the picks; there are no passwords and no profile data. Anyone with access to the mailbox can sign in, as with any magic-link system.

## StrikerAPI (optional enrichment)

Set `STRIKERAPI_API_KEY` (free key: 500 credits a month at https://strikerapi.com/signup) to add:

- **Market consensus forecasts.** The Champions League (and other covered leagues) schedule carries the median three-way line across sportsbooks. The app removes the bookmaker margin (Shin's method) and uses the result as the forecast when API-Football has none. It needs no team histories, so it also avoids football-data.org rate limits. These are bookmaker prices, not an independent model, and the app labels them that way (source "StrikerAPI · market consensus"); they carry no edge. Set `STRIKERAPI_MARKET_FORECASTS=off` to disable this and keep the history-based models.
- **All-time head-to-head** in the competition, **competition Elo ratings** and a **market view** for comparison in the forecast dialog. Elo ratings only move on that competition's matches, so Champions League ratings are thin and not comparable across leagues; the dialog says so.
- **Standings fallback** when football-data.org cannot provide them.

Fixtures still come from API-Football and football-data.org; StrikerAPI is used as an enrichment layer. Forecast order: API-Football prediction → StrikerAPI market consensus → `jk-ratings-v2` → `jk-poisson-v1`. Every StrikerAPI feature is optional and failures fall back silently.

**Credits.** Calls are cached (schedule 12 h, ratings 24 h, standings 12 h, head-to-head 7 days) and counted against `STRIKERAPI_MONTHLY_CREDITS` (default 450 of the 500 free credits; the window is a rolling 30 days from the first call, not your account's calendar month). A schedule or ratings call costs 2 credits, so one competition warmed once a day uses roughly 130 credits a month plus 2 per opened head-to-head. Out-of-credit or invalid-key replies pause StrikerAPI for an hour.

## Competitions, team form and head-to-head

- The competitions list shows major competitions first (Champions League, Europa and Conference League, the top domestic leagues). Round, qualifier, play-off and friendly style entries are marked `minor` and hidden behind "Show all competitions"; searching always looks at everything. The lists are in `server/service/catalog.mjs`.
- Match cards show each team's last five results as W/D/L chips (oldest to newest). Form appears only when the team's history is already cached (the scheduled prefetch fills it), so listing matches never costs extra provider requests.
- The forecast dialog loads "Form & head-to-head": the last five results per team with venue, opponent and score, plus meetings between the two teams in the last 12 months (the history window; older meetings are not shown). Results decided in extra time are skipped because only regulation-time scores are used. `GET /api/football?action=insights&key=…&listing=…` serves it and may fetch the two team histories if they are not cached yet.

## Scheduled prefetch (fewer rate-limit failures)

Free provider plans allow only a handful of requests per minute, and one forecast can need several. `/api/prefetch` warms the caches ahead of time: the upcoming fixtures of the configured competitions (next 30 days), their standings, and the recent match history of every team playing. Afterwards a forecast needs only one live request.

- It is bounded: each run makes at most 6 provider requests, leaving capacity for visitors, and the next run continues where the last stopped (cached items are free).
- If a provider is down or rate-limited, the app serves the last good copy (up to 24 hours old) with a notice instead of an error.
- Protect it with a secret: set `CRON_SECRET` in Vercel (any long random string). Without it the endpoint refuses all calls. Vercel Cron sends the secret automatically.
- `vercel.json` schedules one run per day (the Hobby plan limit). For more frequent warm-ups, add the repository secrets `SITE_URL` (for example `https://your-app.vercel.app`) and `CRON_SECRET` in GitHub; `.github/workflows/prefetch.yml` then calls the endpoint every 15 minutes.
- `PREFETCH_COMPETITIONS` (optional, default `CL`) lists football-data.org competition codes, for example `CL,PL,PD`. Each added competition needs more provider requests per cycle.
- Manual run: `curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/prefetch` returns a summary of what was warmed.

## Predictions and tips

API-Football provides primary three-way probabilities. It is credited as the forecast source. The highest probability is labeled the predicted outcome, not a guaranteed result; a draw can be the favorite.

The experimental `jk-ratings-v2` fallback (used when API-Football has no forecast) fits a regularised Poisson attack/defence model with home advantage to completed regulation-time results from football-data.org: the two teams' histories plus every other team history already cached for the same fixture list (cache reads only, so no extra provider requests). Matches are weighted by recency (half-life 180 days) and ratings are shrunk toward the average team (ridge 4). Each team needs at least 8 results; otherwise the simpler `jk-poisson-v1` goal-average model is used (five home/away matches per side), and if that also lacks data no forecast is shown. Double chance follows from summed match probabilities; total goals and both-teams-to-score follow from the expected goals.

### Backtesting

`server/evaluation.mjs` replays the model chronologically (each match is predicted only from results before its refit window) and reports accuracy, log loss, Brier score and calibration against two baselines: the home/draw/away frequency prior and the legacy model. Tests verify the maths on synthetic leagues with known team strengths, where the ratings model beats both baselines. That says the code works, **not** how accurate it is on real football. To measure that, run:

```sh
FOOTBALL_DATA_ORG_KEY=... node scripts/backtest.mjs --competition CL --days 90
node scripts/backtest.mjs --tune   # compare half-life / shrinkage settings on the cached data
```

The first run downloads each team's last-year results (about 6.5 s per team on the free tier) into `.cache/`. Do not advertise accuracy figures until you have run this on real data.

No bookmaker prices are connected. Tips therefore do not establish positive expected value, profit or guaranteed winnings. Result and tip markets refer to 90 minutes plus stoppage time.

## Provider fallback

Known competition mappings cover Champions League, Premier League, Championship, Bundesliga, La Liga, Serie A, Ligue 1, Primeira Liga, Eredivisie, Brazil Serie A, World Cup and European Championship. The dynamic primary catalog can expose other leagues; those have no fallback unless a verified mapping is added.

Match IDs are explicitly namespaced (`ap:123`, `fd:456`). Cross-provider match substitutions require matching competition, normalized team names (with limited explicit aliases), and kickoff within one minute, with exactly one candidate. Unknown/ambiguous matches stay unavailable rather than silently selecting a different game.

All-league browsing uses one UTC day. Single-league queries support up to 31 days; providers may impose further coverage/range limits. Fallback date ranges fetch a one-day boundary extension and locally filter to the requested inclusive UTC dates.

## Pick storage and privacy

- Upstash Redis (via Vercel Storage) stores cache, forecast and pick records server-side.
- A 256-bit random HttpOnly, SameSite=Lax, Secure-on-HTTPS cookie identifies a private browser profile. No extra auth API key is needed.
- This is not an account/login system: picks do not follow you across devices. Clearing cookies or switching domains loses access to the old profile. Export your picks before doing so. JSON export is for your records; it is not an import or authentication token.
- Picks are immutable and limited to 500 per profile. Atomic conditional writes prevent concurrent updates from overwriting each other. Duplicate canonical match picks are blocked.
- Profiles/data from the earlier ChatGPT Sites deployment are not migrated.
- Results are checked on demand, three eligible pending matches per click. Cancelled/abandoned/awarded games are void; postponed and incomplete games remain pending. Fallback extra-time/penalty games remain pending when verified 90-minute scores are unavailable.

## Operations and quotas

Server-side keys never enter the frontend. The function enforces same-origin POST requests, input validation, per-IP request budgeting, provider caching, per-minute provider budgets (9 calls/minute each), a configurable primary daily budget and a one-minute provider-error cooldown. These measures reduce usage; they do not make hosting or API usage unlimited/free. Check Netlify and provider billing/usage limits before sharing publicly.

Cache and quota updates use Redis with atomic compare-and-set writes. Cache, quota, listing and forecast keys expire automatically; picks are kept. Forecast snapshots are immutable. Cache objects are reused but historic snapshot data is retained; plan a retention policy if operating at scale.

## Architecture

- `public/`: static UI (no API keys). `js/main.js` wires events and data loading; `js/views/` render matches, leagues, analysis, picks and connection status; `js/api.js`, `js/state.js`, `js/dom.js`, `js/busy.js` and `js/demo.js` hold shared helpers.
- `server/service.mjs`: composes the football service from `server/service/`:
  - `storage.mjs` (store reads, atomic updates, budgets), `provider.mjs` (cached, rate-limited provider client), `normalize.mjs` (fixture shapes and league mapping),
  - `catalog.mjs`, `fixtures.mjs`, `lookup.mjs` (single-match and cross-provider verification), `forecast.mjs` and `picks.mjs`.
- `server/service/prefetch.mjs` (budgeted cache warm-up), `history.mjs` (team match history) and `standings.mjs`; `api/prefetch.mjs` is the endpoint.
- `server/service/accounts.mjs`: magic-link sign-in, sessions and pick merging; `server/handler.mjs` adds the login routes and cookies.
- `server/strikerapi.mjs` (odds conversion, Shin devig, name matching, Elo maths) and `server/service/strikerapi.mjs` (cached StrikerAPI lookups).
- `server/form.mjs` (recent form and head-to-head from raw histories) and `server/service/insights.mjs`.
- `server/model.mjs`: normalization and experimental goal model.
- `server/analysis.mjs`: outcome summaries and probability-based tips. Shared with the browser; `npm run build` publishes it as `/analysis.js`.
- `server/errors.mjs`, `server/util.mjs`: `AppError`, hashing, date and time helpers.
- `api/football.mjs`: Vercel Function entry point; `server/handler.mjs` holds the HTTP handler and browser-profile session handling; `server/store/` has the Redis and in-memory stores.
- `vercel.json`: build settings and security headers.
- `tests/`: mocked provider, domain, storage and HTTP checks.

Vercel documentation:

- https://vercel.com/docs/functions
- https://vercel.com/docs/environment-variables
- https://vercel.com/marketplace/upstash
