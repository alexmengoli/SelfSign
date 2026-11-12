// Copies the pdf.js runtime files into pdfjs-assets/ so Angular can bundle them; run before dev, build and test.
import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const output = path.join(webRoot, 'pdfjs-assets');

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'wasm'), { recursive: true });
// The legacy worker matches the legacy main module loaded in pdf-source.ts and polyfills Uint8Array toHex.
await cp(path.join(pdfjsRoot, 'legacy', 'build', 'pdf.worker.min.mjs'), path.join(output, 'pdf.worker.min.mjs'));
for (const folder of ['standard_fonts', 'cmaps', 'iccs']) {
  await cp(path.join(pdfjsRoot, folder), path.join(output, folder), { recursive: true });
}
for (const file of ['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js']) {
  await cp(path.join(pdfjsRoot, 'wasm', file), path.join(output, 'wasm', file));
}
