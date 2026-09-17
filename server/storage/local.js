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

export async function ler(referencia) {
  const destino = path.join(caminhos.uploads, path.basename(referencia));
  if (!fs.existsSync(destino)) return null;
  return fs.readFileSync(destino);
}

export async function remover(referencia) {
  const destino = path.join(caminhos.uploads, path.basename(referencia));
  fs.rmSync(destino, { force: true });
}
