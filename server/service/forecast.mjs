import {AppError} from '../errors.mjs';
import {hash, HOUR} from '../util.mjs';
import {probabilities, isOpen, sameMatch, goalModel} from '../model.mjs';
import {ratingsForecast} from '../ratings.mjs';
import {analyze} from '../analysis.mjs';

export function createForecast({env, store, now, storage, provider, lookup, history}) {
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
        'Not enough regulation-time history: at least five home and five away matches are required.',
      );
    return {
      ...f,
      ...m,
      source: 'JK goal model · football-data.org',
      fallback: true,
      historyFetchedAt: Math.min(h.at, a.at),
    };
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

    let record;
    if (f.provider === 'ap') {
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
        if (!env.FOOTBALL_DATA_ORG_KEY) throw e;
        record = await model(f, teamIds);
      }
    } else record = await model(f, teamIds);

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
