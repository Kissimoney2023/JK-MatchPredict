import {access, cp, mkdir, readFile, rm} from 'node:fs/promises';
import {build} from 'esbuild';

// 1. Static site: copy public/ to dist/. The analysis module is shared with the server,
//    so it is published from its single source of truth.
await rm('dist', {recursive: true, force: true});
await mkdir('dist', {recursive: true});
await cp('public', 'dist', {recursive: true});
await cp('server/analysis.mjs', 'dist/analysis.js');

// 2. Verify the Netlify function bundles (Netlify bundles it again at deploy time).
await build({
  entryPoints: ['netlify/functions/football.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: '.netlify/verification/football.mjs',
  packages: 'external',
});

// 3. Sanity-check the published files.
const html = await readFile('dist/index.html', 'utf8');
for (const file of ['style.css', 'analysis.js', 'js/main.js']) await access('dist/' + file);
if (!html.includes('id="analysis"')) throw Error('Analysis view missing');
if (!html.includes('/js/main.js')) throw Error('Frontend entry point missing from index.html');

console.log('Static application and Netlify function bundle verified.');
