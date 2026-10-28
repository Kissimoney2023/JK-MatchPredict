# JK MatchPredict — Vercel edition

A deployable football match explorer, probability dashboard, prediction/tips view and virtual-pick journal. This edition is independent of the earlier ChatGPT Sites deployment.

## Included features

- Searchable competition catalog from configured APIs, including their countries.
- All-league fixtures for a selected UTC day, or a selected league over up to 31 days.
- Every match returned in that range, with team search, match-status filters and 20-card client-side pagination. There is no fixed 12-match cap.
- Pre-match home/draw/away probabilities, favored outcome (including draws), and a clear recommendation to skip closely matched games.
- Double-chance tips derived from outcome probabilities.
- **Most likely in this match**: every selection the forecast prices (results, double chance, draw no bet, Over/Under, both teams to score) ranked by chance with fair odds and plain tiers (very likely, likely, lean, toss-up).
- **Betting view**: every probability also shown as fair decimal odds (1 ÷ chance, no margin), and an Over/Under ladder (0.5 to 3.5 goals, both teams to score) with fair odds for each side; see Over/Under.
- **Over/Under 2.5 virtual picks** next to the home/draw/away ones, settled from the regulation-time total; see Over/Under.
- **Correct score and Asian handicap**: a scoreline heatmap, the most likely scores with fair odds, and handicap lines (−2.5 to +2.5) with push chances, all consistent with the forecast shown; see Correct score and handicap.
- **Slips**: any betting-slip selection (first-half markets and halftime/fulltime included) can be saved as a virtual pick with the price the slip offers and a slip label; picks placed together are tracked as one slip, settled from the final and half-time scores, with the combined price, the chance at placement and which leg lost; see Betting slip view and Kombiwette.
- **Betting slip view**: every market a Swiss betting slip lists (final result, double chance, BTTS, over/under 0.5–5.5, three-way handicap, halftime/fulltime, first-half result/totals/BTTS, first goal, correct score) with the forecast's chance and the price to insist on, plus a same-match combination (BetBuilder) priced from the scorelines; see Betting slip view and Kombiwette.
- **Value check**: type a bookmaker’s price next to any selection to see its implied chance, the expected value against the forecast and a quarter-Kelly stake; see Value check and slip calculator.
- **Europa League and Conference League** from StrikerAPI alone (neither free football API lists them): fixtures, results, standings, market-led forecasts, picks and settlement; see StrikerAPI.
- **Expected goals and confirmed line-ups** on the analysis (StrikerAPI): xG for and against per match for both clubs with the gap to real goals, and the starting elevens once named for matches people picked; see StrikerAPI.
- **Live forecast record**: every forecast shown is logged and settled; "How it works" shows per source (bookmakers’ consensus, API-Football, the two models) how often what it said happened: reliability chart, accuracy, log loss, Brier, said-versus-happened for home/draw/away and Over 2.5, and a per-competition table; see Live forecast record.
- **Closing line value** on every pick made while StrikerAPI has a line: the bookmakers’ consensus when you picked against their consensus just before kickoff, with "beat the close" and the average movement on My picks; see Closing line value.
- **Slip calculator**: tick pending picks to see the chance the whole accumulator wins, its fair combined odds and the expected value of a bookmaker’s combined price.
- API-Football primary; football-data.org fallback where the competition and match can be verified.
- Forecast source, timestamps, model limitations and missing-data states.
- Accuracy over time: a chart on My picks of your running accuracy after each settled pick (by match date) against what the forecasts expected for the same picks, starting at the third settled pick and shown from five. Void and pending picks are left out. On My picks it is computed in the browser from your picks; the public share page shows the same chart from the stored snapshot.
- Other matches that day: the analysis dialog lists up to six more matches from the same (local) day that still accept picks, same competition first, each with an Analyse button that opens its forecast in place. It reads the match list you are already browsing, so it needs no extra requests, and it shows only what is in that list (filter to one competition and only that competition's matches appear).
- League position: each team's place in the competition table ("2nd of 20", points, record, goal difference) at the top of the match insights, read from the standings the app already caches for 12 hours (football-data.org, StrikerAPI as the fallback). A club is matched by name and is left out, never guessed, if it is missing from the table or two table rows could match it.
- Match analysis extras: a goals ladder (Over/Under 0.5 to 3.5 and both teams to score) estimated from the goal model's expected goals, a side-by-side team comparison (points, win rate, goals scored and conceded, clean sheets, both-teams-scored and over-2.5 rates; overall or home/away) and observed goal trends from the two teams' recent matches. The comparison and trends use completed regulation-time matches from the football-data.org histories the app already caches (up to ten per team), so they cost no extra requests; they need `FOOTBALL_DATA_ORG_KEY`. The ladder appears only when the goal model produced expected goals, not for bookmaker-based or API-Football forecasts, which carry no goal estimate.
- Private server-stored virtual picks, frozen at save, accessible through a browser-profile cookie.
- Installable web app (PWA) with an offline-capable shell; see Install and offline use.
- Picks of the day on the dashboard: the three strongest winner forecasts among the main competitions' next matches; see Picks of the day.
- Optional kickoff reminders and result alerts as browser notifications; see Kickoff reminders.
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
- `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`, optional `SITE_URL`: accounts (see Accounts).
- `POTD_COMPETITIONS`: competitions considered for the pick of the day (see Picks of the day).
- `FORECAST_PRIMARY`: `market` (default) or `api-football`, which source leads when both are available (see Predictions and tips).
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, optional `VAPID_SUBJECT`: kickoff reminders (see Kickoff reminders).
- `STRIKERAPI_API_KEY`: optional StrikerAPI key (see StrikerAPI above). `STRIKERAPI_MONTHLY_CREDITS`: credit cap, default 450. `STRIKERAPI_MARKET_FORECASTS`: `off` disables market-based forecasts. `STRIKERAPI_FRESH_LINES`: `off` stops the near-kickoff line refresh.
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

## Accounts (optional GitHub and Google sign-in with Supabase)

Without an account, picks live in a private server-side profile tied to the browser's cookie. With accounts, a person signs in with GitHub or Google (through Supabase Auth) and their picks follow them to every device. Signing in is optional; picks saved in the browser are merged into the account on first sign-in (duplicates are skipped). GitHub needs no domain and no email sender. The button is hidden until Supabase is configured.

### One-time setup

1. **Supabase project.** Create one at https://supabase.com. In **SQL Editor**, paste and run [`supabase/schema.sql`](supabase/schema.sql). It creates `profiles`, `sessions` and `picks` with Row Level Security on and no policies, so only the app server (service-role key) can read or write them.
2. **GitHub OAuth app.** GitHub → Settings → Developer settings → OAuth Apps → New. Homepage URL: your app URL. Authorization callback URL: `https://<your-project-ref>.supabase.co/auth/v1/callback` (shown on Supabase's GitHub provider page). Copy the Client ID and generate a Client Secret.
3. **Enable the provider.** Supabase → Authentication → Providers → GitHub: enable, paste the Client ID and Secret.
4. **Allow your site.** Supabase → Authentication → URL Configuration: set **Site URL** to your app URL (for example `https://jk-matchpredict.vercel.app`) and add it, with `/**` at the end, to **Redirect URLs**. Add `http://localhost:3000/**` too if you test locally. Without this, sign-in returns to the wrong place.
5. **Vercel environment variables** (Settings → Environment Variables), then redeploy. Supabase calls them API keys (Project Settings → API Keys):
   - `SUPABASE_URL`: the Project URL.
   - `SUPABASE_SECRET_KEY`: the **secret** key (`sb_secret_...`). The legacy name `SUPABASE_SERVICE_ROLE_KEY` (the old `service_role` key) also works. This key bypasses all security rules: keep it server-side only, never prefix it with `NEXT_PUBLIC_`, never commit it, never paste it in a chat.
   - `SUPABASE_PUBLISHABLE_KEY`: the **publishable** key (`sb_publishable_...`), which is safe to expose. It is used only for the sign-in code exchange, so the app needs no elevated rights there. If omitted, the secret key is used for that step too.
   - `SITE_URL` (optional): fixes the address people return to after signing in; defaults to the address of the request.
   - `AUTH_PROVIDERS` (optional): comma-separated sign-in buttons to show, `github`, `google` or `github,google`. Default `github`.

   The names `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from Supabase's Next.js quickstart are also accepted. This app is **not** a Next.js app and uses no Supabase SDK or `@supabase/ssr`: the server talks to Supabase's REST and Auth APIs directly, and the browser never receives a Supabase key. Supabase's new keys are not JWTs, so the client sends them on the `apikey` header only.

### Adding Google sign-in

1. Google Cloud Console → APIs & Services → **OAuth consent screen**: configure it (External is fine), then **Credentials → Create credentials → OAuth client ID → Web application**. Under **Authorized redirect URIs** add `https://<your-project-ref>.supabase.co/auth/v1/callback` (shown on Supabase's Google provider page).
2. Supabase → Authentication → Providers → **Google**: enable it and paste the Client ID and Client Secret there (they are never needed in Vercel or in this repository).
3. In Vercel set `AUTH_PROVIDERS=github,google` and redeploy. The sign-in dialog then offers both buttons. The server refuses any provider that is not listed.

Signing in with GitHub and with Google using the same email can create two separate accounts unless Supabase links identities (Authentication → Sign In / Providers → "Allow manual linking" / automatic linking settings); picks are per account.

### If sign-in fails

The dialog says why. "Supabase refused the publishable key" (or "SUPABASE_PUBLISHABLE_KEY is not set, so the secret key was tried") means the key Vercel sends for the sign-in step is missing or wrong: set `SUPABASE_PUBLISHABLE_KEY` to the publishable key (`sb_publishable_…`) from Supabase → Project Settings → API Keys, apply it to the environment you are using (Production and Preview), and redeploy, because environment changes only take effect on a new deployment. Quotes, spaces and trailing newlines around pasted keys and the URL are removed automatically. "That attempt expired or was already used" means the one-time code was stale: press the sign-in button again without leaving the page. A key check you can run yourself: `curl -H "apikey: <publishable key>" https://<project>.supabase.co/auth/v1/settings` answers 200 with a valid key and 401 otherwise.

### How it works

OAuth with PKCE, done on the server so no Supabase key ever reaches the browser. "Continue with GitHub" asks the server for a sign-in URL; the server keeps a one-time PKCE verifier in a short-lived `HttpOnly` cookie and returns the URL. After GitHub, Supabase redirects back with `?code=`; the page strips it from the address bar and posts it to the server, which exchanges it (code and verifier together; a stolen code alone is useless), saves the profile, opens a 90-day server-side session and merges the browser's picks. The session cookie (`jk_auth`) is `HttpOnly`, `SameSite=Lax` and `Secure`, separate from the anonymous profile cookie, and only a hash of its token is stored. Sign-out revokes the session. Session lookups are cached for a minute per server instance. Picks of signed-in people are rows in `public.picks` (one per match, original forecast kept), which also makes accuracy statistics a simple query.

Stored per person: GitHub user id, email, display name, avatar URL, last sign-in and their picks. No passwords. Limits: 30 sign-in starts per client address per hour. Providers are chosen with `AUTH_PROVIDERS`.

## Install and offline use

The site is an installable progressive web app: browsers offer "Install" (Chrome, Edge, Android) or "Add to Home Screen" (iOS Safari), and it then opens in its own window with the app icon. `public/manifest.webmanifest` and the icons in `public/icons/` describe it; `scripts/sw.template.js` becomes `dist/sw.js` at build time.

- The app shell (HTML, scripts, styles, fonts) is network-first: a new deploy reaches people the next time they are online, and the cached copy is only used when the network fails, so an installed app can still open offline. Matches, forecasts and picks need the network and show a clear "You appear to be offline" message instead of stale data.
- Never cached: `/api/*`, public share pages (`/s/*`), non-GET requests and other origins, so private data is not stored by the worker, and sign-in codes in the address are never written to the cache.
- The cache name includes a hash of every published file; old caches are deleted when a new worker takes over.

## Kickoff reminders and result alerts (optional browser notifications)

On the My picks page, "Remind me before kickoff" asks the browser for permission and then sends one notification about 45 minutes before a match you picked (several matches are combined into one message). Only your own pending virtual picks are mentioned; removing a pick, settling it or kickoff passing cancels the reminder. It works in Chrome, Edge, Firefox and Android; on iPhone the site must first be added to the Home Screen.

After a match, the same scheduled job looks up the result for subscribers' picks (at least 105 minutes after kickoff, for matches that started within the last 8 hours, each pick checked at most every 30 minutes, and at most 6 provider lookups per run to protect the data quotas), records it, and sends "Match result" ("Arsenal 2–1 Chelsea. Your pick was correct."; several results become one message). People who are not subscribed, and older picks, are settled with the Check results button as before.

Setup (the button stays hidden until both keys exist):

1. Generate a key pair once on your computer: `npx web-push generate-vapid-keys`.
2. In Vercel add `VAPID_PUBLIC_KEY` (the public key), `VAPID_PRIVATE_KEY` (the private key, a secret: server-side only, never committed or pasted in a chat) and optionally `VAPID_SUBJECT` (`mailto:you@example.com`, how push services can reach you). Redeploy.
3. Reminders are sent by the scheduled job (`/api/prefetch`), which must run often. Vercel's Hobby cron runs once a day, so also set the GitHub repository secrets `SITE_URL` and `CRON_SECRET` described under Scheduled prefetch: the workflow then runs every 15 minutes.

Notes: a subscription is stored in the key-value store (Redis in production; the in-memory fallback forgets it on restart) as the browser's push address and keys, tied to the profile it was made with, and re-linked to your account when you sign in. At most 2000 subscriptions and 5 devices per profile. For safety the server only sends to the browser vendors' push services (Google, Mozilla, Apple, Microsoft); anything else is rejected. A browser that unsubscribes is removed automatically.

## Picks of the day

A card at the top of the dashboard shows the three strongest winner picks of the day: the upcoming matches (starting within 36 hours, in the main competitions) whose forecast has the clearest home or away winner, ranked by probability. Draws are not winners, and a forecast must clear the app's own "enough separation" bar to qualify, so fewer than three (or none, in which case the card is hidden) can appear. Each pick shows the match, the forecast winner, its probability and a button that opens the full analysis with the pick buttons. The card says plainly that these are probabilities, not certainties, and not betting advice.

How it works: forecasts cost provider requests, so they are computed rarely and read by everyone else. The scheduled job (`/api/prefetch`, after the cache warm-up) lists today's and tomorrow's fixtures (two cached requests), forecasts at most eight candidates (competition order first, then kickoff), stores the best three, and recomputes at most every six hours. If nothing is stored when someone opens the page (the job has not run yet), one visitor per 20 minutes, site-wide, triggers a smaller run (at most five forecasts, about eight seconds) so the card is not empty; other visitors see "Working out today's strongest forecasts…" and the page looks again a few times. If nothing qualified recently, visitors do not trigger more lookups. Picks that have kicked off drop out, and a stored result older than 30 hours is not shown. `vercel.json` gives `api/football.mjs` a 30-second limit for that first run.

Track record: every pick that was shown is remembered once (at most 300 are kept) and its result is looked up by the scheduled job once the match should be over (at least 105 minutes after kickoff, within five days, at most five lookups per run, so it costs little). The card then says how the picks shown there have done, as correct of finished (cancelled matches and unfinished ones are not counted): with fewer than five finished it says "Too few finished matches to judge yet", otherwise it shows the rate with a 95% range, the same honest interval used for your own picks. It records what was actually shown, good or bad; it does not choose which picks to count.

Settings: `POTD_COMPETITIONS` (football-data.org codes, comma separated, in order of importance; default `CL,PL,PD,BL1,SA,FL1`). Competitions need a fixtures source (API-Football or football-data.org) and a forecast source (the models, or StrikerAPI market lines).

## Site setup check

The "How it works" page ends with a setup check for whoever runs the site. Enter your `CRON_SECRET` (the same value you set in Vercel, used here as the key; it is sent only to your own site and is not stored) and press Run checks. Each line says what is configured, how it stands (OK, Info, Check, Fix) and what to do about it:

- football data keys and the optional StrikerAPI key; whether storage is durable (Redis) or temporary memory;
- Supabase: the publishable key checked live against your project, whether GitHub (and Google, when listed in `AUTH_PROVIDERS`) is enabled there, whether the four tables from `supabase/schema.sql` are readable, and whether Supabase is reachable at all (free projects pause after inactivity);
- the scheduled job: whether `CRON_SECRET` is set and when it last ran;
- reminder keys, the picks of the day, and `SITE_URL`.

It reports only whether things are set and accepted, never a key or any value, and nothing about the setup is shown without the key. If `CRON_SECRET` is not set yet the page says to set it first (the scheduled job needs it too). Results that involve Supabase are reused for two minutes. The report is also available to scripts: `GET /api/football?action=diagnostics` with `Authorization: Bearer <CRON_SECRET>`.

## Value check and slip calculator

Both are arithmetic on the forecast, computed in the browser by `server/value.mjs` (published as `/value.js`, unit-tested in Node like the other shared modules). Nothing is sent anywhere.

**Value check** (in the match analysis, under the pick buttons). Choose a selection (home, draw, away, over or under 2.5), type the price a bookmaker offers (decimal `2.25`, fractional `5/4` or American `+125`) and see: the chance the price implies (1 ÷ price), the forecast's chance and fair odds, the edge in percentage points, the expected return per unit staked (chance × price − 1) and a suggested stake. The stake is quarter Kelly (a quarter of the Kelly optimum `(p·b − q)/b`), capped at 2% of a virtual bankroll you set once (kept in your browser's storage only; default 100), and zero when there is no edge. The verdict also says how much to trust it: when the forecast is the bookmakers' consensus, a price above its fair odds is a genuine difference between bookmakers, which is the one edge available to a retail bettor; when the forecast is the app's model, which tested a little worse than the bookmakers, small edges are noise.

**Slip calculator** (on My picks). Pending picks carry an "Add to slip" box. The slip shows the chance that every leg wins (the product of the legs' chances, which treats them as independent and therefore flatters related legs), the fair combined odds (1 ÷ that chance) and "about 1 in N"; enter the bookmaker's combined price (the product of the leg prices) to see the slip's expected return and the chance that price implies. Nine favourites at typical prices come out near 1%, which is what an 80× accumulator is worth before the margin. The selection lives in the page only.

## Betting slip view and Kombiwette

The match analysis has a **Betting slip view**: the markets a Swiss betting slip (Sporttip) offers, in its order and wording, each cell with the forecast's chance and **the price to insist on** (its fair odds). Hold the slip next to it: a printed price at least that high is worth more than it costs by this forecast, a lower one is not. Groups: Final Result, Double Chance, Both Teams to score, Over/Under (0.5–5.5), Handicap (the three-way "0:1" form, where the away side starts a goal up and a one-goal home win is X), Halftime / Fulltime, Who wins the 1st Half, 1st half Over/Under, 1st Half Both Teams to Score, Which Team will score the 1st Goal, Correct Score (the twelve likeliest). Everything comes from the forecast's scoreline matrix (`server/scores.mjs`, published as `/scores.js`; the record carries the fitted goal rates and low-score correction as `scores.rates` and `scores.rho`), so the cells agree with the chances above them. First-half markets assume 45% of the goals come before the break (`FIRST_HALF_SHARE`); halftime/fulltime treats the halves as independent periods and then scales each full-time column to the forecast's result chances. A row with a cell under 0.1% is left out, as a slip locks it. Records made before this change have no rates and show no block until they are refreshed (hourly).

**Same-match combination (BetBuilder).** Tap up to four selections from the full-time markets to see the chance that all of them hold, counted over the scorelines where they do (`comboProbability`), the fair price, and what multiplying the legs would wrongly give; type the slip's BetBuilder price to see the expected return. A draw and both teams scoring go together more often than multiplying says; a home win and over 3.5 less often.

**Saving selections as picks.** Under the markets, tapping selections opens a panel that prices them (one selection on its own, or up to four full-time selections as a same-match combination) with a price box per leg and a slip label; "Save N picks" stores each selection as its own virtual pick (market `selection`, the cell id such as `fh:total:over:0.5`, with the forecast's chance at that moment, the price and the slip label). Signed-in accounts need the four columns added at the end of the `picks` table in `supabase/schema.sql` (re-run the file; it only adds what is missing). Selection picks settle like the others: full-time selections from the regulation-time score, first-half and halftime/fulltime selections from the half-time score the provider returns (API-Football `score.halftime`, football-data.org `halfTime`); a finished match without a half-time score voids such a pick rather than leaving it pending. The first goal cannot be settled from scores and is not pickable. On My picks, **Slips** groups the picks sharing a label: legs with their chance, price and result, the slip's combined price (the product of the leg prices), its chance at placement with the fair price, and its status (lost as soon as one leg loses, won when every live leg has won, void legs dropping out), plus the running count of slips and legs won.

**Kombiwette.** On the slip calculator each leg has a price box: type the printed leg prices and the combination's price is their product, with an optional boost in percent applied to the winnings (a CombiBoost). Each leg shows its tier (very likely, likely, lean, toss-up), and a slip whose chance is under 10% is called a long shot. Across three real nine-, eight- and nine-leg slips the legs hit 65% and the slips 0 of 3, which is exactly what the arithmetic predicts.

## Live forecast record

The backtest measures the model on past league seasons; this measures what the site actually shows, as it is shown, including the Champions League and the bookmaker-led forecasts that the free CSV backtest cannot cover.

- **Logging.** Each new forecast record (`forecast()`, when it is first created) is noted with its three-way chances, its Over 2.5 chance and its source: `market` (StrikerAPI consensus), `api-football`, `ratings` (`jk-ratings-v2`) or `legacy` (`jk-poisson-v1`). One entry per match and source; a later forecast of the same match replaces the earlier one, so a match counts once however often it is opened. At most 800 entries await results.
- **Settling.** The scheduled job looks up finished matches (105 minutes after kickoff, within five days, one lookup per match shared by every source that forecast it, at most six per run) and folds them into aggregates in `server/calibration.mjs`: per source and per source-and-competition, the count, log loss, Brier score, accuracy, ten reliability bands (said versus happened), home/draw/away said versus happened, and the same for Over 2.5. Cancelled matches are dropped. Nothing per match is kept after settling.
- **Reading.** `GET /api/football?action=calibration` (cached five minutes) feeds the "Live forecast record" section of How it works: a reliability chart per source once a few bands hold five or more forecasts (on the diagonal is calibrated; above it too cautious; below it too confident), the said-versus-happened table, and competitions with at least ten settled matches. Sources with fewer than 50 settled matches are flagged as too few to judge.

Bookmaker-led forecasts are expected to sit on the diagonal; the models are read against them. This is also the first honest measure of the app's Champions League forecasts.

## Closing line value

The most honest measure of picking skill does not wait for results: did the bookmakers move toward your pick between the moment you made it and kickoff? Over many picks, a positive average means your picks carried information the market later priced in; results alone can be luck for a long time.

- **Opening.** Every forecast keeps a snapshot of the StrikerAPI consensus as it stood (`marketSnapshot`: margin-free home/draw/away chances and the total line), whatever source led the forecast. A pick freezes the forecast, so its opening chance is the snapshot's chance for that selection (Over/Under picks read theirs from the total line).
- **Closing.** When a pick is saved, its match is noted (one note per match, not per pick; at most 500). In the last 75 minutes before kickoff, the scheduled job refreshes each league's schedule once (2 credits per league per matchday, at most 5 leagues per run; a schedule fetched within 90 minutes counts) and stores the consensus per match. The close is shared by everyone who picked that match, so no per-person data changes and accounts need no schema update. Missed runs are retried for two hours after kickoff.
- **Reading.** `clv.value` is close ÷ open − 1 (+0.05 = the market moved 5% toward the pick); `beatClose` is whether it moved toward the pick at all. My picks shows the average and the beat-the-close rate over picks that have both numbers, and each pick's card shows "48% when picked → 51% at close (+6.3%)". Picks made without a StrikerAPI line, or before this feature, simply carry no value.

The scheduled job must run often for this to work (the GitHub workflow every 15 minutes; see Scheduled prefetch). The per-bookmaker version (best price taken versus each book's close) would cost 5 credits per match and is not built.

## Pick statistics

**My picks** opens with a results dashboard (computed in the browser from the person's picks, anonymous or signed in; `server/pickstats.mjs` is published as `/pickstats.js` and unit-tested):

- **Accuracy** with a 95% Wilson interval, so small samples are not over-read (fewer than 20 settled picks shows a warning). Void (cancelled) and pending picks never count.
- **Record, current run and best run**, ordered by match date, plus the last ten results.
- **Versus forecasts:** correct picks against the number expected from the forecasts' own probabilities (a simple luck-versus-skill check).
- **Breakdowns** by forecast confidence (what the forecast said against what you got), by competition and by kind of pick, and how backing the forecast's favourite compares with going against it.

These describe a person's picks only; they are not a measure of the forecasts' accuracy (use `scripts/backtest.mjs` for that).

## Sharing results

The public page also shows the "Accuracy over time" chart. The snapshot stores a thinned series (at most 60 rounded points: pick number, running accuracy, expected accuracy) and nothing else about individual picks beyond what the page already lists. Links created before this feature have no chart until their owner presses Share results again to refresh the snapshot (the address does not change).

Shared links show a large link preview (title, summary and a branded 1200×630 image, `public/icons/og-image.jpg`) when pasted into chat apps or social networks. The image is the same for everyone; it is not generated per person, so it never carries a name or results.

**My picks → Share results** opens a dialog with two independent options:

- **Result card (image).** A 1200x630 PNG drawn in the browser from the person's own statistics: accuracy with its 95% range, record, current run, correct-versus-expected and the last ten results, plus an optional name. Download it, send it with the phone's share sheet, or copy a text summary. Nothing is uploaded and no account is needed.
- **Public link** (`/s/<random id>`, signed-in people only). A page anyone with the link can open. It is **off until created** and can be **switched off at any time** (the link then returns 404 at once). It shows a snapshot: accuracy and range, record, streaks and the last 10 _settled_ picks. It never shows the email, pending/upcoming picks or anything else about the person. The GitHub name appears **only if the person ticks the box**; otherwise the page says "A MatchPredict player". "Update with my latest results" refreshes the snapshot and keeps the same address. Pages are `noindex`, escaped server-side, script-free (they fit the strict CSP) and cached for about a minute.

Needs the `shares` table: re-run [`supabase/schema.sql`](supabase/schema.sql) once (it is safe to repeat). `vercel.json` rewrites `/s/:id` to the `api/share.mjs` function. Limits: 10 link updates per person per hour.

## StrikerAPI (optional enrichment)

Set `STRIKERAPI_API_KEY` (free key: 500 credits a month at https://strikerapi.com/signup) to add:

- **Fresh lines near kickoff.** The schedule is cached for 12 hours, but lines move with team news and the closing line is the most accurate number available, so a forecast opened within three hours of kickoff uses a schedule copy at most two hours old (one extra 2-credit call per league per two hours on a matchday). `STRIKERAPI_FRESH_LINES=off` keeps the 12-hour cache. Forecast records are still frozen per hour, so a pick keeps the line it was made on.
- **Market consensus forecasts.** The Champions League (and other covered leagues) schedule carries the median three-way line across sportsbooks. The app removes the bookmaker margin (Shin's method) and uses the result as the forecast ahead of API-Football's prediction (it beat the app's model in the backtest). It needs no team histories, so it also avoids football-data.org rate limits. These are bookmaker prices, not an independent model, and the app labels them that way (source "StrikerAPI · market consensus"); they carry no edge. Set `STRIKERAPI_MARKET_FORECASTS=off` to disable this and keep the history-based models.
- **All-time head-to-head** in the competition, **competition Elo ratings** and a **market view** for comparison in the forecast dialog. Elo ratings only move on that competition's matches, so Champions League ratings are thin and not comparable across leagues; the dialog says so.
- **Standings fallback** when football-data.org cannot provide them.

**Matching fixtures to StrikerAPI games.** The two providers spell clubs differently ("SK Slavia Praha" / "Slavia Prague", "FC København" / "Copenhagen"). Names are compared word by word after removing accents and generic club words (SK, FK, SL, Club...), with a table of local-to-English spellings (`server/strikerapi.mjs`). If both clubs match and the kickoff is within three hours, that is the game. If only one side matches (home with home, away with away) at the same kickoff (within 30 minutes) and exactly one such game exists, it is accepted too, since a club cannot play two matches at once; with two candidates the app refuses rather than guess. When nothing matches, the function log gets a line "[strikerapi] no schedule game matched ..." listing what the schedule offered near that kickoff: use it to add a missing spelling. A fixture with no bookmaker line and too little history (football-data.org's free plan lacks many domestic leagues, so clubs from Turkey, Czechia and similar may have only a couple of results) gets a plain "no forecast available" message.

- **Expected goals.** `get_team_stats` without a team returns every club's per-match averages for a competition in one call (5 credits), cached for seven days, so each competition people open costs about 20 credits a month. The analysis shows xG for and against per match for both clubs next to real goals, and names the gap: a side scoring far above its chances for long is usually due a correction, but under about ten matches the gap is called noise. The response's field names are read defensively (`xg_for`/`xg_against` and a few variants); if a competition's rows cannot be matched to the clubs, the block is simply absent.
- **Confirmed line-ups.** For matches people picked (the same per-match note the closing-line service keeps), the scheduled job asks `get_lineups` (5 credits) from 75 minutes before kickoff until 15 minutes after, at most four matches per run and three attempts per match (an answer before the teams are named is cached for only ten minutes, so the next run tries again). Once both elevens are named they are stored per match and shown on the analysis with formations. Roughly 10 to 15 credits per picked match; only matches with picks are ever asked for.

- **Competitions StrikerAPI alone covers.** The UEFA Europa League (`uel`) and Conference League (`uecl`) are not in API-Football's free seasons or football-data.org's free tier, so when StrikerAPI is configured they are listed as featured competitions served by it: upcoming fixtures with their lines from `get_schedule` (2 credits, cached 12 hours), results from `list_games` over the chosen dates (2 credits, cached 2 hours), standings from `get_standings`. Their forecasts use the bookmakers' consensus only (no histories exist for the models), so a match without a line yet shows a clear "no line yet" message instead of a forecast; picks are settled from the games list. They do not appear in the "All leagues" day view, which lists what the football APIs return. If a football API ever lists the same code, that listing wins. The app's codes `UEL` and `UECL` look like football-data.org codes so that every code-keyed feature (standings, Elo, head-to-head, xG, line-ups, closing lines, the live record) works unchanged.

Fixtures still come from API-Football and football-data.org for everything else; StrikerAPI is used as an enrichment layer there. Forecast order: StrikerAPI market consensus (when it has a line) → API-Football prediction → `jk-ratings-v2` → `jk-poisson-v1` (see Predictions and tips; `FORECAST_PRIMARY=api-football` swaps the first two). The schedule's total line also drives the Over/Under estimates. Every StrikerAPI feature is optional and failures fall back silently.

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
- `vercel.json` schedules one run per day (the Hobby plan limit). For more frequent warm-ups, add the repository secrets `SITE_URL` (for example `https://your-app.vercel.app`) and `CRON_SECRET` in GitHub; `.github/workflows/prefetch.yml` then calls the endpoint every 15 minutes. They must be **Repository secrets** (Settings → Secrets and variables → Actions → Secrets), not Variables and not Environment secrets. Each run says what happened: a yellow warning "Prefetch skipped" when the secrets are not visible to the workflow, a red failure when the site refuses the secret (401: it differs from Vercel's `CRON_SECRET`) or has none (503), and otherwise the HTTP status, timing and the job's JSON in the run summary. Spaces, newlines and a trailing slash pasted into the secrets are ignored.
- `PREFETCH_COMPETITIONS` (optional, default `CL`) lists football-data.org competition codes, for example `CL,PL,PD`. Each added competition needs more provider requests per cycle.
- Manual run: `curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/prefetch` returns a summary of what was warmed.

## Predictions and tips

**What "accurate" can mean here.** No forecast makes football results predictable: the bookmakers' consensus, the best public predictor, sees its favourite lose about 45% of the time. The app therefore works on two things it can control: showing a probability as close as possible to the best available number (the consensus, refreshed near kickoff; the models only where there is no line), and making the probabilities easy to use well (fair odds, the "most likely" ladder with double chance and draw no bet, the value check, the slip calculator). The live forecast record measures how the shown probabilities actually perform.

**Order of sources.** When StrikerAPI is configured and has a line for the match, the bookmakers' consensus (median three-way line across sportsbooks, margin removed with Shin's method) is the forecast: in the backtest below it beat the app's own model on 1,835 holdout matches and no blend of the two beat it. Otherwise API-Football's prediction is used, then the `jk-ratings-v2` model, then `jk-poisson-v1`. `FORECAST_PRIMARY=api-football` puts API-Football's prediction ahead of the market again. The source is always credited on the forecast.

API-Football provides three-way probabilities. It is credited as the forecast source. The highest probability is labeled the predicted outcome, not a guaranteed result; a draw can be the favorite.

The experimental `jk-ratings-v2` fallback (used when API-Football has no forecast) fits a regularised Poisson attack/defence model with home advantage to completed regulation-time results from football-data.org: the two teams' histories plus every other team history already cached for the same fixture list (cache reads only, so no extra provider requests). Matches are weighted by recency (half-life 180 days) and ratings are shrunk toward the average team (ridge 4). Each team needs at least 8 results; otherwise the simpler `jk-poisson-v1` goal-average model is used (five home/away matches per side), and if that also lacks data no forecast is shown. Double chance follows from summed match probabilities; total goals and both-teams-to-score follow from the expected goals.

### Over/Under (totals)

The analysis shows an Over/Under ladder (0.5, 1.5, 2.5, 3.5 goals) and both teams to score, each side with its chance and fair decimal odds, plus Over/Under 2.5 pick buttons. Where the estimate comes from, in order:

1. **The bookmakers' total line** (StrikerAPI schedule, the goal total priced at even money): the app solves for the Poisson goal rate at which over and under are equally likely at that line (quarter lines such as 2.75 are treated as half a bet on each neighbour) and reads the other lines off that distribution. Labelled "market-total"; no both-teams-to-score, because a total says nothing about how goals split.
2. **The ratings model's scoreline matrix**, when the model produced the forecast or the two teams' histories are already cached (no extra requests).
3. The older goal-average model's expected goals.

Otherwise the ladder says no estimate is available and Over/Under picks are refused for that match. Fair odds are 1 ÷ probability with no margin: a bookmaker price below them offers no value by that forecast; they are not a recommendation to bet.

**Over/Under picks** live beside home/draw/away picks: one pick per match per market (the canonical key carries the market), removable until kickoff, settled from the regulation-time total (over wins when goals exceed the line; cancelled matches are void), and counted in the statistics on their own rows ("Over 2.5", "Under 2.5"). Signed-in accounts need the two columns added at the end of the `picks` table in `supabase/schema.sql`; re-run the file (it only adds what is missing). The site setup check reports a database that predates them, and the save itself says what to run.

### Correct score and handicap

The analysis shows a 7×7 scoreline grid (home goals down, away goals across), the six most likely scores with fair odds, and Asian handicap lines from the home side's view (−3 to +3 in halves; the page shows −2.5 to +2.5 and highlights the line closest to even money). Whole lines can push; their fair odds leave the push out ((1 − push) ÷ chance). All of it comes from one scoreline matrix (`server/scores.mjs`):

- **Market-led forecasts** get a matrix fitted to the bookmakers' own numbers: the two goal rates share the expected total implied by the bookmakers' total line, their split is solved for the consensus home-win chance, and a Dixon-Coles low-score correction is solved for the draw chance. So the scores and handicaps reproduce the three-way line shown above them instead of contradicting it. Labelled "market".
- **Model-led forecasts** use the ratings model's own matrix (also used when the two teams' histories are cached and the forecast came from elsewhere without a total line). Labelled "model".
- Otherwise the section is absent.

These are fair prices with no margin, not a recommendation to bet; they are not yet pickable markets.

### Backtesting

`server/evaluation.mjs` replays the model chronologically (each match is predicted only from results before its refit window, using about the last year of results, as in production) and reports accuracy, log loss, Brier score and calibration against a frequency prior, the legacy model and, when available, the bookmakers' closing line.

**Free, no key:** `node scripts/backtest-csv.mjs --league E0,SP1,D1,I1,F1` downloads historical results and Pinnacle closing odds from football-data.co.uk (Premier League, La Liga, Bundesliga, Serie A, Ligue 1; seasons 2021/22 to now) and runs the full test in about a minute. Settings are tuned on 2024/25 and judged on 2025/26 onwards, which the tuning never saw.

**With a football-data.org key:** `node scripts/backtest.mjs --competition CL` runs the same machinery on any competition that API covers, including the Champions League (not available from the free CSV source).

**Result (holdout 2025/26 onwards, 1,835 matches in five leagues; lower log loss is better):**

| Model                                             |  Log loss | Accuracy (home/draw/away) |
| ------------------------------------------------- | --------: | ------------------------: |
| Frequency prior                                   |     1.074 |                       n/a |
| Legacy goal model (`jk-poisson-v1`)               |     1.027 |                       n/a |
| **Ratings model (`jk-ratings-v2`)**               | **1.003** |                     51.5% |
| Bookmaker closing line (Pinnacle, margin removed) |     0.974 |                     53.9% |

- The ratings model clearly beats the naive baseline in every league and the legacy model in the Premier League, Bundesliga and Serie A (the other two point the same way but are not statistically clear).
- It is about 0.03 log loss per match **worse than the closing line** (clearly worse in four of five leagues, not clearly different in the Premier League). That is the normal state of affairs: bookmaker prices also reflect injuries, line-ups and money flow, which this model ignores. This is why the StrikerAPI market consensus, when configured, is ranked above the ratings model.
- No consistent draw or home/away bias was found, and re-tuning half-life and shrinkage on 2024/25 did not improve the holdout (settings differ by league but the holdout scores are equal), so the defaults stay.
- **Experiment, no gain: shots as an extra input.** The ratings can optionally be fitted to a blend of real goals and a shots-based expected-goals estimate (`xgWeight` in `server/ratings.mjs`, off by default; `node scripts/backtest-csv.mjs --league E0,SP1,D1,I1,F1 --experiment shots`, or `shots-sot` for shots on target only). Conversion rates were estimated before 2024/25, the blend weight chosen on 2024/25 and judged on the 2025/26 holdout (1,835 matches). Result: log loss 0.999 against 1.003 for goals only, a difference of -0.003 per match (±0.005), i.e. **no clear improvement**; the gap to the bookmaker line stays about 0.026. So production is unchanged (and the football-data.org histories used in production carry no shot data anyway).
- **Measured, October 2026 (`--experiment improve`, same holdout of 1,835 matches):**
  - _Dixon-Coles low-score correction_ (`rho` in `server/ratings.mjs`, tuned per league on 2024/25): -0.000 log loss per match (±0.003), **no gain**; it stays off.
  - _Blending the model with the bookmakers' line_ (weight tuned on 2024/25, 0.75 to 0.9): clearly better than the model alone (-0.027 ±0.008) but still worse than the line alone (+0.002 ±0.002). So the line is used on its own whenever it exists, and no blend is shipped.
  - _Over 2.5 goals from the model's scoreline matrix_: log loss 0.692 against 0.673 for the bookmakers' Over/Under prices (+0.019 ±0.007, clearly worse). The model said "over" 51.3% of the time; it happened 54.3% (bookmakers said 53.0%). A goal-rate correction (`goalScale`) tuned on 2024/25 came out at 1.0, so none is applied; the bookmakers' total line is preferred for totals when available and the model's figures are labelled as the model's.
- **Not measured:** Champions League and other cross-league fixtures (the ratings there rest on weaker cross-league links), and the API-Football forecast (not available on the free plan). Treat percentages as estimates, never as certainties.

## Provider fallback

Known competition mappings cover Champions League, Premier League, Championship, Bundesliga, La Liga, Serie A, Ligue 1, Primeira Liga, Eredivisie, Brazil Serie A, World Cup and European Championship. The dynamic primary catalog can expose other leagues; those have no fallback unless a verified mapping is added.

Match IDs are explicitly namespaced (`ap:123`, `fd:456`). Cross-provider match substitutions require matching competition, normalized team names (with limited explicit aliases), and kickoff within one minute, with exactly one candidate. Unknown/ambiguous matches stay unavailable rather than silently selecting a different game.

All-league browsing uses one UTC day. Single-league queries support up to 31 days; providers may impose further coverage/range limits. Fallback date ranges fetch a one-day boundary extension and locally filter to the requested inclusive UTC dates.

## Pick storage and privacy

- Upstash Redis (via Vercel Storage) stores cache, forecast and pick records server-side.
- A 256-bit random HttpOnly, SameSite=Lax, Secure-on-HTTPS cookie identifies a private browser profile. No extra auth API key is needed.
- This is not an account/login system: picks do not follow you across devices. Clearing cookies or switching domains loses access to the old profile. Export your picks before doing so. JSON export is for your records; it is not an import or authentication token.
- Picks are limited to 500 per profile. A pick can be removed only before kickoff and only while it has no result (the server enforces both, and the database delete itself only matches unsettled rows); after kickoff or once settled it is immutable, so results cannot be erased from statistics or share links. Removing a pick frees the match for a new pick. Atomic conditional writes prevent concurrent updates from overwriting each other. Duplicate canonical match picks are blocked (one home/draw/away pick and one Over/Under pick per match).
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
- `server/service/accounts.mjs` (Supabase Auth GitHub sign-in with PKCE and sessions), `server/supabase.mjs` (REST client), `server/service/pickstore.mjs` (picks in the key-value store for browsers, in Supabase for accounts); `server/handler.mjs` adds the login routes and cookies; `supabase/schema.sql` creates the tables.
- `server/strikerapi.mjs` (odds conversion, Shin devig, name matching, Elo maths) and `server/service/strikerapi.mjs` (cached StrikerAPI lookups).
- `server/pickstats.mjs`: pick accuracy statistics (also published to the browser). `server/service/shares.mjs` (public share snapshots) and `server/sharepage.mjs` (the public page); `public/js/views/share.js` and `sharecard.js` (dialog and image card).
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
