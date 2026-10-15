import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {access, cp, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {build} from 'esbuild';

// 1. Static site: copy public/ to dist/. The analysis module is shared with the server,
//    so it is published from its single source of truth.
await rm('dist', {recursive: true, force: true});
await mkdir('dist', {recursive: true});
await cp('public', 'dist', {recursive: true});
await cp('server/analysis.mjs', 'dist/analysis.js');
await cp('server/pickstats.mjs', 'dist/pickstats.js');

// Self-hosted fonts keep the CSP strict (no third-party font hosts).
const FONTS = [
  ...[400, 500, 600, 700].map((w) => ['fira-sans', `fira-sans-latin-${w}-normal.woff2`]),
  ...[500, 600].map((w) => ['fira-code', `fira-code-latin-${w}-normal.woff2`]),
];
await mkdir('dist/fonts', {recursive: true});
for (const [pkg, file] of FONTS)
  await cp(`node_modules/@fontsource/${pkg}/files/${file}`, `dist/fonts/${file}`);

// 1b. Service worker: the template plus a version (hash of every published file) and the list
//     of files to keep for offline use. A new deploy therefore always gets a new cache name.
async function listFiles(dir, prefix = '') {
  const found = [];
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const relative = prefix + entry.name;
    if (entry.isDirectory())
      found.push(...(await listFiles(dir + '/' + entry.name, relative + '/')));
    else found.push(relative);
  }
  return found;
}
// Install icons are only needed by the operating system, not for offline use: skip them.
const shellFiles = (await listFiles('dist'))
  .filter((f) => f !== 'sw.js' && !(f.startsWith('icons/') && !f.startsWith('icons/favicon')))
  .sort();
const digest = createHash('sha256');
for (const f of shellFiles) digest.update(f).update(await readFile('dist/' + f));
const assets = shellFiles.map((f) => (f === 'index.html' ? '/' : '/' + f));
const template = await readFile('scripts/sw.template.js', 'utf8');
await writeFile(
  'dist/sw.js',
  template
    .replace('__VERSION__', () => digest.digest('hex').slice(0, 12))
    .replace('__ASSETS__', () => JSON.stringify(assets)),
);

// 2. Verify the Vercel function bundles (Vercel bundles it again at deploy time).
await build({
  entryPoints: ['api/football.mjs', 'api/prefetch.mjs', 'api/share.mjs'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outdir: '.vercel-verification',
  packages: 'external',
});

// 3. Syntax-check every published script: a typo in one module would otherwise ship and
//    leave the page silently dead (browsers show no error for a module that fails to parse).
async function scripts(dir) {
  const found = [];
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const path = dir + '/' + entry.name;
    if (entry.isDirectory()) found.push(...(await scripts(path)));
    else if (entry.name.endsWith('.js')) found.push(path);
  }
  return found;
}
for (const file of await scripts('dist'))
  execFileSync(process.execPath, ['--check', file], {stdio: 'pipe'});

// 4. Sanity-check the published files.
const html = await readFile('dist/index.html', 'utf8');
for (const file of [
  'style.css',
  'analysis.js',
  'pickstats.js',
  'js/main.js',
  'sw.js',
  'manifest.webmanifest',
])
  await access('dist/' + file);
if (!html.includes('id="analysis"')) throw Error('Analysis view missing');
if (!html.includes('/js/main.js')) throw Error('Frontend entry point missing from index.html');

console.log('Static application and Vercel function bundle verified.');
