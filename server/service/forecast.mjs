import {AppError} from '../errors.mjs';
import {hash, HOUR} from '../util.mjs';
import {probabilities, isOpen, sameMatch, goalModel, goalsFromTotalLine} from '../model.mjs';
import {ratingsForecast} from '../ratings.mjs';
import {analyze, goalMarkets} from '../analysis.mjs';
import {matrixFromMarkets, scoreMarkets} from '../scores.mjs';

// Which source leads when both are available. The bookmakers' consensus beat the app's own
// model on 1,835 holdout matches and blending with it never beat it, so it leads by default;
// FORECAST_PRIMARY=api-football restores API-Football's prediction as the first choice.
const marketLeads = (env) =>
  String(env.FORECAST_PRIMARY || 'market')
    .trim()
    .toLowerCase() !== 'api-football';

export function createForecast({env, store, now, storage, provider, lookup, history, strikerApi}) {
  const {read} = storage;
  const {mappedFD, fresh} = lookup;

  /** Fallback forecast from football-data.org history via the Poisson goal model. */
  async function model(f, competitionTeamIds = []) {
    const {f: target} = await mappedFD(f);
    if (!isOpen(target, now()) || !sameMatch(target, f))
      throw new AppError(409, 'closed', 'Match is no longer open at the same kickoff time.');
    const h = await history(target.homeTeamId);
    const a = await history(target.awayTeamId);
    // Opponent-aware ratings use every cached history from the same fixture list (free reads);
    // only the two target teams' histories may cost a live request.
    const rows = [...(h.body.matches ?? []), ...(a.body.matches ?? [])];
    for (const id of competitionTeamIds) {
      if (id === target.homeTeamId || id === target.awayTeamId) continue;
      rows.push(...((await history.peek(id))?.body.matches ?? []));
    }
    const m =
      ratingsForecast({
        rows,
        homeId: target.homeTeamId,
        awayId: target.awayTeamId,
        kickoff: f.kickoff,
        now: now(),
      }) ??
      goalModel(
        h.body.matches ?? [],
        a.body.matches ?? [],
        target.homeTeamId,
        target.awayTeamId,
        f.kickoff,
        now(),
      );
    if (!m)
      throw new AppError(
        404,
        'history',
        strikerApi.marketEnabled()
          ? 'No forecast is available for this match yet: no bookmaker line was found for it, and there is too little recent match history for these teams (at least five home and five away results are needed).'
          : 'Not enough regulation-time history: at least five home and five away matches are required.',
      );
    return {
      ...f,
      ...m,
      source: 'JK goal model · football-data.org',
      fallback: true,
      historyFetchedAt: Math.min(h.at, a.at),
    };
  }

  /** Probabilities from bookmaker prices (StrikerAPI schedule), margin removed. */
  function marketRecord(f, market) {
    return {
      ...f,
      p: market.p,
      source: 'StrikerAPI · market consensus',
      fallback: true,
      modelVersion: 'market-shin-v1',
      marketBooks: market.books,
      marketOverround: market.overround,
      marketFetchedAt: market.fetchedAt,
      explanation: `Median three-way line across ${market.books ?? 'several'} sportsbooks with the bookmaker margin (${market.overround}%) removed using Shin's method. These are bookmaker prices, not an independent model, so they carry no edge and are not a recommendation to bet.`,
    };
  }

  /**
   * Goal estimates (ratings model) from histories that are already cached, for a fixture whose
   * win/draw/loss forecast came from elsewhere. Reads the cache only, so it costs nothing and
   * may simply find nothing.
   */
  async function cachedModelGoals(f, teamIds) {
    try {
      const target = f.provider === 'fd' ? f : (await mappedFD(f)).f;
      const rows = [];
      for (const id of new Set([target.homeTeamId, target.awayTeamId, ...teamIds]))
        rows.push(...((await history.peek(id))?.body.matches ?? []));
      const m = ratingsForecast({
        rows,
        homeId: target.homeTeamId,
        awayId: target.awayTeamId,
        kickoff: f.kickoff,
        now: now(),
      });
      return m?.goals ? {goals: m.goals, scores: m.scores} : null;
    } catch {
      return null;
    }
  }

  /**
   * Correct-score and handicap markets. A market-led forecast gets a matrix fitted to the
   * bookmakers' own numbers (their three-way line and total), so every market on the page
   * agrees; a model-led one uses the model's matrix; otherwise cached histories, else none.
   */
  function withScores(record, market, cached) {
    if (market?.total && String(record.modelVersion || '').startsWith('market')) {
      const fit = matrixFromMarkets(record.p, market.total);
      if (fit) return {...record, scores: scoreMarkets(fit.matrix), scoresSource: 'market'};
    }
    if (record.scores) return {...record, scoresSource: 'model'};
    if (cached?.scores) return {...record, scores: cached.scores, scoresSource: 'model'};
    return {...record, scores: null, scoresSource: null};
  }

  /**
   * Adds Over/Under estimates to a forecast. The bookmakers' total line comes first (it beat
   * the model on totals too), then the goal model's own matrix, then the older model's
   * expected goals, else none.
   */
  async function withGoals(record, f, teamIds, market) {
    // Cached-history model, only when the forecast itself did not come from the model.
    const cached = record.goals ? null : await cachedModelGoals(f, teamIds);
    const fromLine = goalsFromTotalLine(market?.total);
    let out;
    if (fromLine)
      out = {...record, goals: fromLine, goalsSource: 'market-total', marketTotal: market.total};
    else if (record.goals) out = {...record, goalsSource: 'model'};
    else if (cached) out = {...record, goals: cached.goals, goalsSource: 'model'};
    else if (record.expectedGoals)
      out = {...record, goals: goalMarkets(record.expectedGoals), goalsSource: 'model-legacy'};
    else out = {...record, goals: null, goalsSource: null};
    return withScores(out, market, cached);
  }

  async function forecast(key, listingId) {
    if (!/^[a-f0-9]{64}$/.test(listingId || ''))
      throw new AppError(400, 'listing', 'Refresh the match browser first.');
    const listing = await read('listing/' + listingId);
    const known = listing?.items?.find((f) => f.key === key);
    if (!known) throw new AppError(404, 'fixture', 'Load this match from the match browser first.');

    const teamIds = [
      ...new Set(
        (listing.items ?? [])
          .flatMap((x) => [x.homeTeamId, x.awayTeamId])
          .filter((id) => Number.isInteger(id)),
      ),
    ];
    const {f: current} = await fresh(known);
    const f = {
      ...current,
      key: known.key,
      provider: known.provider,
      externalId: known.externalId,
      fdCode: known.fdCode || current.fdCode,
      canonicalLeague: known.canonicalLeague,
    };
    if (!isOpen(f, now()))
      throw new AppError(
        409,
        'closed',
        'Pre-match predictions are closed or kickoff is unconfirmed.',
      );

    const market = await strikerApi.marketFor(f);
    let record;
    if (market && marketLeads(env)) record = marketRecord(f, market);
    else if (f.provider === 'ap') {
      try {
        const d = await provider('ap', `predictions?fixture=${f.externalId}`, HOUR);
        const p = probabilities(d.body.response?.[0]?.predictions?.percent);
        if (!p)
          throw new AppError(
            404,
            'forecast',
            'The primary API has no complete three-way forecast.',
          );
        record = {...f, p, source: 'API-Football', fallback: false, providerFetchedAt: d.at};
      } catch (e) {
        if (!env.FOOTBALL_DATA_ORG_KEY && !market) throw e;
        record = market ? marketRecord(f, market) : await model(f, teamIds);
      }
    } else record = market ? marketRecord(f, market) : await model(f, teamIds);
    record = await withGoals(record, f, teamIds, market);

    const forecastAt = now();
    const forecastId = hash(
      JSON.stringify([f.key, record.source, record.p, Math.floor(forecastAt / HOUR), f.kickoff]),
    );
    record = {...record, forecastAt, forecastId, analysis: analyze(record)};
    const saved = await store.setJSON('forecast/' + forecastId, record, {onlyIfNew: true});
    return saved.modified ? record : await read('forecast/' + forecastId);
  }

  return {forecast};
}
