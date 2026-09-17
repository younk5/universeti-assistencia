/**
 * Roda todas as verificações do projeto:
 *
 *   1. estática   — sintaxe, imports e CSS do front-end (rápida);
 *   2. API        — fluxo completo da OS por HTTP (smoke);
 *   3. navegador  — SPA real no Chrome headless (se houver Chrome/Edge).
 *
 *   npm test
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function localizarChrome() {
  const candidatos = [
    process.env.CHROME_PATH,
    `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidatos.find((c) => fs.existsSync(c)) ?? null;
}

function executar(arquivo) {
  return new Promise((resolver) => {
    const processo = spawn(process.execPath, ['--no-warnings', arquivo], {
      cwd: raiz,
      stdio: 'inherit',
    });
    processo.on('exit', (codigo) => resolver(codigo ?? 1));
  });
}

const etapas = [
  { nome: 'Verificação estática do front-end', arquivo: path.join('server', 'test', 'validar-frontend.js') },
  { nome: 'Gerador de PDF (estrutura)', arquivo: path.join('server', 'test', 'pdf.js') },
  { nome: 'Fluxo completo via API', arquivo: path.join('server', 'test', 'smoke.js') },
];

if (localizarChrome()) {
  etapas.push({ nome: 'Interface real no navegador (Chrome headless)', arquivo: path.join('server', 'test', 'navegador.js') });
} else {
  console.log('\n  [aviso] Chrome/Edge não encontrado — o teste de navegador foi ignorado.');
  console.log('          Defina CHROME_PATH para incluí-lo.\n');
}

let falhas = 0;
for (const etapa of etapas) {
  console.log(`\n${'\u2501'.repeat(60)}`);
  console.log(`  ${etapa.nome}`);
  console.log('\u2501'.repeat(60));
  const codigo = await executar(etapa.arquivo);
  if (codigo !== 0) falhas += 1;
}

console.log(`\n${'\u2501'.repeat(60)}`);
console.log(
  falhas === 0
    ? `  Todas as ${etapas.length} etapas passaram.`
    : `  ${falhas} de ${etapas.length} etapa(s) falharam.`,
);
console.log(`${'\u2501'.repeat(60)}\n`);

process.exit(falhas === 0 ? 0 : 1);
