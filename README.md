# JK MatchPredict — Netlify edition

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

## Deploy to Netlify

1. Unzip this source bundle and put its contents at the root of a Git repository. Do not upload `node_modules`, `.netlify`, or a filled `.env` file.
2. In Netlify, import that Git repository as a new project. The included `netlify.toml` sets:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
   - Node version: `22`
3. Add the environment variables below in the Netlify project's environment settings. They must be available to Functions at runtime. Do not prefix them with `VITE_`, `NEXT_PUBLIC_` or expose them to browser code.
4. Deploy or redeploy after saving the variables. Netlify Blobs provides the cache, quota counters, forecast snapshots and browser-profile picks; no separate database password is required.
5. Open the deployed URL, confirm the key-configured statuses, select a league/date and request one forecast. Then save a virtual pick and verify it appears in My picks.

Do not deploy only the `dist` directory using static drag-and-drop: that would omit the server functions and live data service. Use a Git-connected Netlify build or the Netlify CLI with the full project.

This bundle has not been deployed to a Netlify account by the assistant. Real API credentials were not supplied, so real-provider and production Netlify verification are still required. The existing ChatGPT Sites URL continues to host its earlier edition.

## Environment variables

Use `.env.example` as the template:

```dotenv
API_FOOTBALL_KEY=your_direct_api_sports_key
FOOTBALL_DATA_ORG_KEY=your_football_data_org_token
API_FOOTBALL_DAILY_LIMIT=100
```

- `API_FOOTBALL_KEY`: direct API-Football/API-Sports key. A RapidAPI credential is not interchangeable.
- `FOOTBALL_DATA_ORG_KEY`: football-data.org API token.
- `API_FOOTBALL_DAILY_LIMIT`: optional daily application budget; default 100. Change it only to match your allowance. Other apps using the same key can consume the provider's quota independently.

Either key can run the app alone. Both are needed for primary-to-fallback failover. API-Football free season access is limited; football-data.org covers a smaller set of leagues and its free scores/schedules may be delayed. League presence in a catalog does not guarantee access to every season, forecast, team history or match.

Provider signup:

- https://dashboard.api-football.com/
- https://www.football-data.org/client/register

A local `.env` is not automatically a production Netlify secret. Add/import the values through Netlify's environment settings and redeploy. Do not commit keys or put them in `netlify.toml`.

## Local development

```sh
npm ci
cp .env.example .env
# Fill in the local .env values without committing the file.
npx netlify-cli dev
```

The Netlify CLI supplies the Functions and Blobs development environment. A plain static server can preview the UI/demo, but cannot supply live APIs or saved picks.

Checks:

```sh
npm test
npm run build
```

The build copies public assets into `dist` and verifies the Node function bundle with esbuild. Netlify subsequently packages/deploys the configured function directory. Automated tests use mocked football responses and a conditional-write storage adapter; they do not prove paid/free plan coverage or real API accuracy. Visual browser QA was not available in the authoring environment.

## Predictions and tips

API-Football provides primary three-way probabilities. It is credited as the forecast source. The highest probability is labeled the predicted outcome, not a guaranteed result; a draw can be the favorite.

The experimental `jk-poisson-v1` fallback uses up to ten recent home matches for the home team and ten away matches for the away team, with at least five per side. It takes completed regulation-time results before the forecast cutoff, averages offense and opposing defense with two 1.3-goal pseudo-observations, caps goal means to 0.15–5 and sums independent Poisson goal probabilities. Double chance follows from summed match probabilities; total goals and both-teams-to-score follow from the goal means.

This model is uncalibrated and unbacktested. It ignores injuries, lineups, opponent and league strength. Do not advertise its probabilities as demonstrated accuracy. If history is insufficient, the app reports that no forecast is available.

No bookmaker prices are connected. Tips therefore do not establish positive expected value, profit or guaranteed winnings. Result and tip markets refer to 90 minutes plus stoppage time.

## Provider fallback

Known competition mappings cover Champions League, Premier League, Championship, Bundesliga, La Liga, Serie A, Ligue 1, Primeira Liga, Eredivisie, Brazil Serie A, World Cup and European Championship. The dynamic primary catalog can expose other leagues; those have no fallback unless a verified mapping is added.

Match IDs are explicitly namespaced (`ap:123`, `fd:456`). Cross-provider match substitutions require matching competition, normalized team names (with limited explicit aliases), and kickoff within one minute, with exactly one candidate. Unknown/ambiguous matches stay unavailable rather than silently selecting a different game.

All-league browsing uses one UTC day. Single-league queries support up to 31 days; providers may impose further coverage/range limits. Fallback date ranges fetch a one-day boundary extension and locally filter to the requested inclusive UTC dates.

## Pick storage and privacy

- Netlify Blobs stores cache, forecast and pick records server-side.
- A 256-bit random HttpOnly, SameSite=Lax, Secure-on-HTTPS cookie identifies a private browser profile. No extra auth API key is needed.
- This is not an account/login system: picks do not follow you across devices. Clearing cookies or switching domains loses access to the old profile. Export your picks before doing so. JSON export is for your records; it is not an import or authentication token.
- Picks are immutable and limited to 500 per profile. Atomic conditional writes prevent concurrent updates from overwriting each other. Duplicate canonical match picks are blocked.
- Profiles/data from the earlier ChatGPT Sites deployment are not migrated.
- Results are checked on demand, three eligible pending matches per click. Cancelled/abandoned/awarded games are void; postponed and incomplete games remain pending. Fallback extra-time/penalty games remain pending when verified 90-minute scores are unavailable.

## Operations and quotas

Server-side keys never enter the frontend. The function enforces same-origin POST requests, input validation, per-IP request budgeting, provider caching, per-minute provider budgets (9 calls/minute each), a configurable primary daily budget and a one-minute provider-error cooldown. These measures reduce usage; they do not make hosting or API usage unlimited/free. Check Netlify and provider billing/usage limits before sharing publicly.

Cache and quota updates use strongly consistent Netlify Blobs and conditional writes. Forecast snapshots are immutable. Cache objects are reused but historic snapshot data is retained; plan a retention policy if operating at scale.

## Architecture

- `public/`: static UI (no API keys). `js/main.js` wires events and data loading; `js/views/` render matches, leagues, analysis, picks and connection status; `js/api.js`, `js/state.js`, `js/dom.js`, `js/busy.js` and `js/demo.js` hold shared helpers.
- `server/service.mjs`: composes the football service from `server/service/`:
  - `storage.mjs` (Blobs reads, atomic updates, budgets), `provider.mjs` (cached, rate-limited provider client), `normalize.mjs` (fixture shapes and league mapping),
  - `catalog.mjs`, `fixtures.mjs`, `lookup.mjs` (single-match and cross-provider verification), `forecast.mjs` and `picks.mjs`.
- `server/model.mjs`: normalization and experimental goal model.
- `server/analysis.mjs`: outcome summaries and probability-based tips. Shared with the browser; `npm run build` publishes it as `/analysis.js`.
- `server/errors.mjs`, `server/util.mjs`: `AppError`, hashing, date and time helpers.
- `netlify/functions/football.mjs`: Netlify HTTP entry point and browser-profile session handling.
- `netlify.toml`: deployment and security headers.
- `tests/`: mocked provider, domain, storage and HTTP checks.

Netlify documentation:

- https://docs.netlify.com/build/functions/environment-variables/
- https://docs.netlify.com/build/data-and-storage/netlify-blobs/
- https://docs.netlify.com/build/functions/configuration/
