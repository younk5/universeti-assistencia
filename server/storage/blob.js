/**
 * Armazenamento no Vercel Blob — usado na Vercel, onde não há disco.
 *
 * O store é criado em modo **privado**: os blobs não são acessíveis pela URL
 * pública e a leitura exige o token. Além disso, as fotos nunca são servidas
 * direto do Blob — a API autentica a sessão e o escopo da loja antes de
 * repassar os bytes (ver /api/fotos/:id/raw). Ou seja, há duas camadas: o Blob
 * privado e o controle de acesso do próprio sistema.
 */

export const nome = 'vercel-blob';

let putFn = null;
let getFn = null;
let delFn = null;

const token = () => process.env.BLOB_READ_WRITE_TOKEN;
const acesso = () => (process.env.BLOB_ACCESS === 'public' ? 'public' : 'private');

export function descrever() {
  return `Vercel Blob (${acesso()})`;
}

export async function abrir() {
  if (putFn) return;
  if (!token()) {
    throw new Error('BLOB_READ_WRITE_TOKEN não configurado — necessário para guardar as fotos na Vercel.');
  }
  try {
    ({ put: putFn, get: getFn, del: delFn } = await import('@vercel/blob'));
  } catch {
    throw new Error('O armazenamento em Blob exige o pacote @vercel/blob. Rode "npm install".');
  }
}

export async function salvar(buffer, nomeArquivo, mime) {
  await abrir();
  const { url } = await putFn(`fotos/${nomeArquivo}`, buffer, {
    access: acesso(),
    contentType: mime,
    addRandomSuffix: true,
    token: token(),
  });
  return url;
}

export async function ler(referencia) {
  await abrir();
  const resultado = await getFn(referencia, { access: acesso(), token: token() });
  if (!resultado || resultado.statusCode !== 200) return null;
  return Buffer.from(await new Response(resultado.stream).arrayBuffer());
}

export async function remover(referencia) {
  try {
    await abrir();
    await delFn(referencia, { token: token() });
  } catch {
    /* remoção best-effort: o registro de auditoria é imutável de qualquer forma */
  }
}
