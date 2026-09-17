import { config } from './config.js';

/**
 * Fachada de armazenamento de imagens.
 *
 * O sistema guarda em `fotos_os.arquivo` uma "referência" opaca: um nome de
 * arquivo (disco local) ou uma URL (Vercel Blob). Os serviços nunca acessam o
 * disco diretamente — passam por aqui.
 */

let provedor = null;

async function carregar() {
  if (provedor) return provedor;
  if (process.env.BLOB_READ_WRITE_TOKEN && (process.env.VERCEL || process.env.STORAGE_DRIVER === 'blob')) {
    provedor = await import('./storage/blob.js');
    await provedor.abrir();
  } else if (process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      'Na Vercel as fotos precisam ir para o Vercel Blob: defina BLOB_READ_WRITE_TOKEN nas variáveis de ambiente.',
    );
  } else {
    provedor = await import('./storage/local.js');
  }
  return provedor;
}

export function descreverStorage() {
  return provedor?.descrever() ?? 'não inicializado';
}

export async function salvarImagem(buffer, nomeArquivo, mime) {
  return (await carregar()).salvar(buffer, nomeArquivo, mime);
}

export async function lerImagem(referencia) {
  return (await carregar()).ler(referencia);
}

export async function removerImagem(referencia) {
  return (await carregar()).remover(referencia);
}

export function eReferenciaRemota(referencia) {
  return /^https?:\/\//i.test(String(referencia ?? ''));
}

export { config };
