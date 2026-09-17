/**
 * Verificação estática do front-end (sem navegador). Roda em milissegundos e
 * pega erros que só apareceriam ao abrir a tela:
 *   1. sintaxe de cada módulo ES (`node --check`);
 *   2. todo `import` relativo aponta para um arquivo existente;
 *   3. todo asset referenciado no index.html existe;
 *   4. classes usadas nos componentes existem no CSS.
 *
 *   node server/test/validar-frontend.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const publico = path.join(raiz, 'public');

let erros = 0;
let arquivos = 0;
let imports = 0;

function listarJs(diretorio) {
  const saida = [];
  for (const entrada of fs.readdirSync(diretorio, { withFileTypes: true })) {
    const completo = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) saida.push(...listarJs(completo));
    else if (entrada.name.endsWith('.js')) saida.push(completo);
  }
  return saida;
}

const arquivosJs = listarJs(path.join(publico, 'js'));

for (const arquivo of arquivosJs) {
  arquivos += 1;
  const relativo = path.relative(raiz, arquivo);

  try {
    execFileSync(process.execPath, ['--check', arquivo], { stdio: 'pipe' });
  } catch (erro) {
    erros += 1;
    console.error(`\u2717 sintaxe: ${relativo}`);
    console.error(String(erro.stderr ?? erro.message).split('\n').slice(0, 4).join('\n'));
  }

  const conteudo = fs.readFileSync(arquivo, 'utf8');
  const padroes = [
    /import\s+[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\s+['"]([^'"]+)['"]/g,
  ];

  for (const padrao of padroes) {
    for (const casamento of conteudo.matchAll(padrao)) {
      const especificador = casamento[1];
      imports += 1;
      if (!especificador.startsWith('.')) continue;
      const destino = path.resolve(path.dirname(arquivo), especificador);
      if (!fs.existsSync(destino)) {
        erros += 1;
        console.error(`\u2717 import quebrado em ${relativo}: "${especificador}"`);
      }
    }
  }
}

const html = fs.readFileSync(path.join(publico, 'index.html'), 'utf8');
for (const casamento of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
  const alvo = path.join(publico, casamento[1]);
  if (!fs.existsSync(alvo)) {
    erros += 1;
    console.error(`\u2717 asset ausente referenciado no index.html: ${casamento[1]}`);
  }
}

const css = fs.readFileSync(path.join(publico, 'css', 'app.css'), 'utf8');
const classesCss = new Set(
  [...css.matchAll(/\.([a-z][a-z0-9_-]*(?:__[a-z0-9-]+)?(?:--[a-z0-9-]+)?)/gi)].map((m) => m[1]),
);
const ignoradas = new Set(['js', 'json', 'md', 'txt', 'com', 'br', 'svg', 'css', 'html', 'png']);
const avisos = new Set();

for (const arquivo of arquivosJs) {
  const conteudo = fs.readFileSync(arquivo, 'utf8');
  for (const casamento of conteudo.matchAll(/h\(\s*[`'"]((?:[a-z]+)(?:[.#][a-zA-Z0-9_-]+)+)[`'"]/g)) {
    for (const parte of casamento[1].split(/[.#]/).slice(1)) {
      if (/[${]/.test(parte) || ignoradas.has(parte)) continue;
      if (!classesCss.has(parte) && !parte.startsWith('oculto')) {
        avisos.add(`${parte} (usada em ${path.relative(raiz, arquivo)})`);
      }
    }
  }
}

console.log(`\n  Módulos verificados: ${arquivos}`);
console.log(`  Imports analisados:  ${imports}`);
if (avisos.size) {
  console.log(`\n  Classes sem estilo correspondente (${avisos.size}):`);
  for (const aviso of [...avisos].sort()) console.log(`   · ${aviso}`);
}
console.log(`\n  ${erros === 0 ? 'OK — nenhum erro estrutural encontrado.' : `${erros} erro(s) encontrado(s).`}\n`);

process.exit(erros === 0 ? 0 : 1);
