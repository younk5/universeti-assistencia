/**
 * Armazenamento no Vercel Blob — usado na Vercel, onde não há disco.
 *
 * O store é criado em modo **privado**: os blobs não são acessíveis pela URL
 * pública e a leitura exige o token. Além disso, os anexos nunca são servidos
 * direto do Blob — a API autentica a sessão e o escopo da loja antes de
 * repassar os bytes (ver /api/fotos/:id/raw). Ou seja, há duas camadas: o Blob
 * privado e o controle de acesso do próprio sistema.
 *
 * Vídeos grandes (que estouram o limite de corpo da função serverless) sobem
 * **direto do navegador** para o Blob, autorizados por um token de cliente
 * gerado aqui no servidor (tokenUploadCliente).
 */

export const nome = 'vercel-blob';

let putFn = null;
let getFn = null;
let delFn = null;
let headFn = null;

const token = () => process.env.BLOB_READ_WRITE_TOKEN;
const acesso = () => (process.env.BLOB_ACCESS === 'public' ? 'public' : 'private');

export function descrever() {
  return `Vercel Blob (${acesso()})`;
}

export async function abrir() {
  if (putFn) return;
  if (!token()) {
    throw new Error('BLOB_READ_WRITE_TOKEN não configurado — necessário para guardar os anexos na Vercel.');
  }
  try {
    ({ put: putFn, get: getFn, del: delFn, head: headFn } = await import('@vercel/blob'));
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

/**
 * Lê o conteúdo — ou apenas uma faixa (Range), usada pelo player de vídeo —
 * do arquivo apontado pela referência. O pedido de faixa é repassado ao CDN do
 * Blob via cabeçalho Range; se o CDN responder o arquivo inteiro, o recorte é
 * feito em memória.
 */
export async function ler(referencia, { faixa = null } = {}) {
  await abrir();
  const opcoes = { access: acesso(), token: token() };
  if (faixa) opcoes.headers = { Range: `bytes=${faixa.inicio}-${faixa.fim}` };
  const resultado = await getFn(referencia, opcoes);
  if (!resultado || resultado.statusCode !== 200) return null;
  const buffer = Buffer.from(await new Response(resultado.stream).arrayBuffer());
  if (!faixa) return buffer;
  // 206 + Content-Range significa que o CDN já devolveu só a faixa pedida.
  const atendida = Boolean(resultado.headers?.get?.('content-range'));
  return atendida ? buffer : buffer.subarray(faixa.inicio, faixa.fim + 1);
}

export async function remover(referencia) {
  try {
    await abrir();
    await delFn(referencia, { token: token() });
  } catch {
    /* remoção best-effort: o registro de auditoria é imutável de qualquer forma */
  }
}

/** Metadados oficiais de um blob (tamanho e mimetype) — validam uploads diretos. */
export async function metadados(referencia) {
  await abrir();
  return headFn(referencia, { token: token() });
}

/**
 * Gera um token de cliente para o navegador enviar o arquivo direto ao Blob.
 * O token fica restrito ao caminho, família de conteúdo e tamanho definidos
 * aqui — o navegador não consegue gravar nada fora disso.
 */
export async function tokenUploadCliente({
  pathname,
  contentType,
  maximumSizeInBytes,
  validadeMs = 30 * 60 * 1000,
  tokenPayload = null,
}) {
  await abrir();
  const { generateClientTokenFromReadWriteToken } = await import('@vercel/blob/client');
  const familia = String(contentType ?? '').startsWith('video/') ? 'video/*' : 'image/*';
  return generateClientTokenFromReadWriteToken({
    token: token(),
    pathname,
    addRandomSuffix: true,
    allowedContentTypes: [familia],
    maximumSizeInBytes,
    validUntil: Date.now() + validadeMs,
    tokenPayload: tokenPayload ?? undefined,
  });
}
