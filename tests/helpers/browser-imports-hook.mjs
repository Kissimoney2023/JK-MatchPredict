// Resolve hook: published root paths -> the shared modules' sources (see scripts/build.mjs).
const SHARED = {
  '/analysis.js': 'server/analysis.mjs',
  '/pickstats.js': 'server/pickstats.mjs',
  '/trend.js': 'server/trend.mjs',
  '/value.js': 'server/value.mjs',
};

export async function resolve(specifier, context, next) {
  const source = SHARED[specifier];
  if (source) return next(new URL('../../' + source, import.meta.url).href, context);
  return next(specifier, context);
}
