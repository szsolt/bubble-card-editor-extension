import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));

const opts = {
  define: { __BCE_VERSION__: JSON.stringify(version) },
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'esm',
  target: 'es2021',
  outfile: 'dist/bubble-card-editor.js',
  minify: true,
  sourcemap: true,
  // lit is bundled in on purpose — HA does not expose its lit to resources,
  // and every comparable card (button-card, mushroom, card-mod) bundles too.
  // Our selector elements render entirely with this bundled lit; no lit value
  // ever crosses into HA's lit, so the two-copies footgun does not apply.
  legalComments: 'none',
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log('watching…');
} else {
  await esbuild.build(opts);
}
