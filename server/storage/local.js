import fs from 'node:fs';
import path from 'node:path';
import { caminhos } from '../config.js';

/** Armazenamento em disco — desenvolvimento e hospedagem com volume persistente. */

export const nome = 'disco-local';

export function descrever() {
  return `Disco local (${caminhos.uploads})`;
}

export async function salvar(buffer, nomeArquivo) {
  fs.mkdirSync(caminhos.uploads, { recursive: true });
  fs.writeFileSync(path.join(caminhos.uploads, nomeArquivo), buffer);
  return nomeArquivo;
}

/**
 * Lê o arquivo inteiro ou apenas uma faixa (Range) — o player de vídeo faz
 * requisições parciais, então ler só o pedaço evita carregar o vídeo completo
 * em memória a cada avanço da reprodução.
 */
export async function ler(referencia, { faixa = null } = {}) {
  const destino = path.join(caminhos.uploads, path.basename(referencia));
  if (!fs.existsSync(destino)) return null;
  if (!faixa) return fs.readFileSync(destino);

  const tamanho = fs.statSync(destino).size;
  const inicio = Math.max(0, Math.min(Number(faixa.inicio) || 0, tamanho - 1));
  const fim = Math.max(inicio, Math.min(Number(faixa.fim) || tamanho - 1, tamanho - 1));
  const comprimento = fim - inicio + 1;

  const buffer = Buffer.alloc(comprimento);
  const descritor = fs.openSync(destino, 'r');
  try {
    fs.readSync(descritor, buffer, 0, comprimento, inicio);
  } finally {
    fs.closeSync(descritor);
  }
  return buffer;
}

export async function remover(referencia) {
  const destino = path.join(caminhos.uploads, path.basename(referencia));
  fs.rmSync(destino, { force: true });
}
