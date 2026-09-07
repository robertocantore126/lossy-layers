/**
 * Turns the single-file Vite build into an Artifact-ready page.
 *
 * The Artifact host wraps whatever it is given in its own
 * `<!doctype html><head>…</head><body>` skeleton, so handing it a complete
 * document would nest one inside the other. This lifts the interesting parts
 * of <head> and the whole of <body> out and writes them as a fragment.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'dist/index.html');
const target = resolve(root, 'dist/artifact.html');

const html = await readFile(source, 'utf8');

const headMatch = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html);
const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);

if (!headMatch || !bodyMatch) {
  throw new Error('dist/index.html did not look like a full document');
}

// The host supplies its own charset and viewport; ours would be duplicates.
const head = headMatch[1]
  .replace(/<meta\s+charset[^>]*>/gi, '')
  .replace(/<meta\s+name=["']viewport["'][^>]*>/gi, '')
  .trim();

const body = bodyMatch[1].trim();

const out = `${head}\n${body}\n`;
await writeFile(target, out, 'utf8');

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`artifact fragment -> dist/artifact.html (${kb(Buffer.byteLength(out))})`);

if (!/<title>/i.test(out)) {
  console.warn('warning: no <title> survived the extraction; the artifact will be named after the file');
}
