import { api } from './api.js';
import { store } from './store.js';

/**
 * Envio de anexos (fotos e vídeos) para uma OS.
 *
 * Fotos continuam subindo comprimidas pelo servidor (< ~900 KB). Vídeos não
 * são comprimidos: quando o servidor usa Vercel Blob (produção na Vercel), o
 * arquivo sobe **direto do navegador** para o Blob — o limite de corpo da
 * função serverless (4,5 MB) tornaria vídeos inviáveis. No modo local, o
 * vídeo vai pelo próprio servidor.
 */

export function ehVideo(mime) {
  return String(mime ?? '').toLowerCase().startsWith('video/');
}

export function extensaoVideo(mime) {
  return (
    {
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/webm': 'webm',
      'video/3gpp': '3gp',
    }[String(mime ?? '').toLowerCase()] ?? 'mp4'
  );
}

function aleatorio() {
  const bytes = new Uint8Array(6);
  (globalThis.crypto ?? window.crypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Envia o arquivo escolhido (foto ou vídeo) como anexo da OS.
 * Devolve `null` em caso de sucesso ou a mensagem de erro para a interface.
 */
export async function enviarAnexo(ordemId, arquivo, { tipo, legenda = null } = {}) {
  if (!arquivo?.blob) return null;
  const video = arquivo.tipo === 'video' || ehVideo(arquivo.mime);
  const legendaFinal = arquivo.legenda ?? legenda;

  if (video && modoBlob()) {
    try {
      await enviarVideoDireto(ordemId, arquivo, tipo, legendaFinal);
      return null;
    } catch (erro) {
      console.error('[anexos] upload direto falhou:', erro);
      return mensagemErroVideo(erro);
    }
  }

  try {
    await api.enviarArquivo(`/api/ordens/${ordemId}/fotos`, arquivo.blob, {
      params: { tipo, legenda: legendaFinal },
      // Vídeo no modo local pode ser grande; o limite padrão de 60 s é curto.
      timeoutMs: video ? 300000 : 60000,
    });
    return null;
  } catch (erro) {
    return erro.message;
  }
}

function modoBlob() {
  return store.meta?.anexos?.modo === 'blob';
}

async function enviarVideoDireto(ordemId, arquivo, tipo, legenda) {
  // Import tardio: o SDK só é baixado quando alguém envia um vídeo.
  const { upload } = await import('./vendor/blob-client.js');
  const caminho = `fotos/${ordemId}/${Date.now()}-${aleatorio()}.${extensaoVideo(arquivo.mime)}`;
  const blob = await upload(caminho, arquivo.blob, {
    access: 'private',
    contentType: arquivo.mime,
    // Acima de ~8 MB o SDK fatia o arquivo e reenvia partes com retry.
    multipart: (arquivo.bytes ?? arquivo.blob.size ?? 0) > 8 * 1024 * 1024,
    handleUploadUrl: '/api/anexos/blob',
    clientPayload: JSON.stringify({ osId: ordemId, tipo, legenda, contentType: arquivo.mime }),
  });

  await api.post(`/api/ordens/${ordemId}/anexos/blob/confirmar`, {
    url: blob?.url,
    tipo,
    legenda,
  });
}

function mensagemErroVideo(erro) {
  const texto = String(erro?.message ?? '');
  if (/too large|TOO_LARGE|maximum size/i.test(texto)) {
    return 'O vídeo passou do tamanho máximo permitido. Grave um trecho mais curto e tente de novo.';
  }
  if (/content type|CONTENT_TYPE|not allowed/i.test(texto)) {
    return 'Formato de vídeo não aceito. Use MP4, MOV (iPhone) ou WebM.';
  }
  if (/token/i.test(texto)) {
    return 'A autorização do envio expirou. Feche o aviso e tente enviar o vídeo novamente.';
  }
  return 'Falha ao enviar o vídeo. Verifique a conexão (o vídeo usa mais dados que a foto) e tente novamente.';
}
