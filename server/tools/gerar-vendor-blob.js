/**
 * Gera `public/js/vendor/blob-client.js` — o SDK de upload do Vercel Blob
 * empacotado para rodar direto no navegador (sem bundler no front-end).
 *
 * O pacote original importa `crypto`, `undici` e `stream` (builtins do Node);
 * o próprio @vercel/blob publica substitutos para navegador — os `alias`
 * abaixo trocam os módulos nas versões certas. `buffer` é injetado porque o
 * SDK usa `Buffer.from(...)` em alguns caminhos.
 *
 *   node server/tools/gerar-vendor-blob.js
 */
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dist = path.join(raiz, 'node_modules', '@vercel', 'blob', 'dist');

await build({
  entryPoints: [path.join(dist, 'client.js')],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  platform: 'browser',
  minify: true,
  outfile: path.join(raiz, 'public', 'js', 'vendor', 'blob-client.js'),
  alias: {
    crypto: path.join(dist, 'crypto-browser.js'),
    undici: path.join(dist, 'undici-browser.js'),
    stream: path.join(dist, 'stream-browser.js'),
  },
  inject: [path.join(raiz, 'server', 'tools', 'shim-buffer.js')],
  banner: {
    js: '/* Gerado por server/tools/gerar-vendor-blob.js (@vercel/blob). Não editar à mão. */',
  },
  logLevel: 'info',
});

console.log('vendor/blob-client.js gerado.');
