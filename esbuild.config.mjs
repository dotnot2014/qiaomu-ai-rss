import { build, context } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const projectLicense = readFileSync(new URL('./LICENSE', import.meta.url), 'utf8');
const catalogLicense = readFileSync(new URL('./vendor/chinese-independent-blogs/LICENSE', import.meta.url), 'utf8');
const fontLicense = readFileSync(new URL('./fonts/OFL.txt', import.meta.url), 'utf8');
const turndownLicense = readFileSync(new URL('./node_modules/turndown/LICENSE', import.meta.url), 'utf8');
const turndownGfmLicense = readFileSync(new URL('./node_modules/turndown-plugin-gfm/LICENSE', import.meta.url), 'utf8');
// A browser bundle would resolve `ws` to its stub that throws; the Edge voice socket needs the Node client.
const wsNodeEntry = fileURLToPath(new URL('./node_modules/ws/index.js', import.meta.url));
const options = { entryPoints: ['src/main.ts'], bundle: true, loader: { '.woff2': 'dataurl' }, alias: { ws: wsNodeEntry }, external: ['obsidian', '@codemirror/view', '@codemirror/state', 'electron', 'node:fs', 'node:path', 'node:crypto', 'node:events', 'node:stream', 'node:buffer', 'node:util', 'node:url', 'events', 'https', 'http', 'net', 'tls', 'crypto', 'stream', 'url', 'zlib', 'buffer', 'util', 'os', 'assert', 'bufferutil', 'utf-8-validate'], format: 'cjs', target: 'es2022', outfile: 'main.js', logLevel: 'info', sourcemap: false, minify: true, keepNames: true, banner: { js: `/*! Qiaomu RSS — Copyright (c) 2026 向阳乔木; GPL-3.0-only.\nSource: https://github.com/joeseesun/qiaomu-ai-rss\n${projectLicense}\nBlog catalog: https://github.com/timqian/chinese-independent-blogs\n${catalogLicense}\nBundled fonts: SIL OFL 1.1\n${fontLicense}\nTurndown: MIT\n${turndownLicense}\nTurndown GFM: MIT\n${turndownGfmLicense}*/` } };
if (process.argv.includes('--watch')) await (await context(options)).watch();
else {
  await build(options);
  for (const asset of ['main.js', 'styles.css']) {
    if (readFileSync(asset).byteLength > 5_000_000) throw new Error(`${asset} exceeds the 5 MB release budget`);
  }
}
