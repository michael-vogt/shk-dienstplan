// tools/bundle-offline.mjs
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist/shk-dienstplan/browser';   // ggf. anpassen
const tmp = 'tools/.entry.tmp.mjs';

const imports = ['polyfills.js', 'main.js']
  .filter((f) => existsSync(join(dir, f)))
  .map((f) => `import '../${dir}/${f}';`)
  .join('\n');
writeFileSync(tmp, imports);

await build({
  entryPoints: [tmp],
  bundle: true,
  format: 'iife',        // <- entscheidend: kein type="module" mehr
  minify: true,
  outfile: join(dir, 'app.bundle.js'),
});

let html = readFileSync(join(dir, 'index.html'), 'utf8');
const css = (html.match(/href="(styles[^"]*\.css)"/) ?? [])[1];

html = html
  .replace(/<script[^>]*src="(polyfills|main)[^"]*"[^>]*><\/script>/g, '')
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/g,
    css ? `<style>${readFileSync(join(dir, css), 'utf8')}</style>` : '')
  .replace('</body>',
    `<script>${readFileSync(join(dir, 'app.bundle.js'), 'utf8')}</script></body>`);

writeFileSync(join(dir, 'index.html'), html);
