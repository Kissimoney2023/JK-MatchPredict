import {access, cp, mkdir, readFile, rm} from 'node:fs/promises';
import {build} from 'esbuild';

// 1. Static site: copy public/ to dist/. The analysis module is shared with the server,
//    so it is published from its single source of truth.
await rm('dist', {recursive: true, force: true});
await mkdir('dist', {recursive: true});
await cp('public', 'dist', {recursive: true});
await cp('server/analysis.mjs', 'dist/analysis.js');

// Self-hosted fonts keep the CSP strict (no third-party font hosts).
const FONTS = [
  ...[400, 500, 600, 700].map((w) => ['fira-sans', `fira-sans-latin-${w}-normal.woff2`]),
  ...[500, 600].map((w) => ['fira-code', `fira-code-latin-${w}-normal.woff2`]),
];
await mkdir('dist/fonts', {recursive: true});
for (const [pkg, file] of FONTS)
  await cp(`node_modules/@fontsource/${pkg}/files/${file}`, `dist/fonts/${file}`);

// 2. Verify the Vercel function bundles (Vercel bundles it again at deploy time).
await build({
  entryPoints: ['api/football.mjs', 'api/prefetch.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outdir: '.vercel-verification',
  packages: 'external',
});

// 3. Sanity-check the published files.
const html = await readFile('dist/index.html', 'utf8');
for (const file of ['style.css', 'analysis.js', 'js/main.js']) await access('dist/' + file);
if (!html.includes('id="analysis"')) throw Error('Analysis view missing');
if (!html.includes('/js/main.js')) throw Error('Frontend entry point missing from index.html');

console.log('Static application and Vercel function bundle verified.');
