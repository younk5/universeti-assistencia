import crypto from 'node:crypto';
import { config } from '../config.js';
import { consultarUm, transacao, executar, suspenderProtecaoAuditoria, restaurarProtecaoAuditoria } from '../db.js';
import { agoraISO } from '../utils.js';
import { invalido, naoEncontrado, ErroApp } from '../erros.js';
import { salvarImagem, lerImagem, removerImagem } from '../storage.js';
import { registrarEvento } from './ordens.js';
import { registrarExclusao } from './auditoria.js';

export const TIPOS_FOTO = ['entrada', 'saida', 'retirada', 'assinatura'];

/** Extensões por mimetype aceito — fotos e vídeos entram na mesma tabela. */
export const EXTENSOES = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/3gpp': '.3gp',
};

export const MIMES_VIDEO = Object.keys(EXTENSOES).filter((mime) => mime.startsWith('video/'));
export const MIMES_IMAGEM = Object.keys(EXTENSOES).filter((mime) => mime.startsWith('image/'));

/**
 * Assinaturas binárias (magic bytes) por família de arquivo. Validar o
 * conteúdo — e não só o mimetype/extensão — impede que um arquivo qualquer
 * seja gravado como se fosse foto ou vídeo.
 */
const ASSINATURAS = {
  'image/jpeg': { assinaturas: [[0xff, 0xd8, 0xff]] },
  'image/png': { assinaturas: [[0x89, 0x50, 0x4e, 0x47]] },
  'image/webp': { assinaturas: [[0x52, 0x49, 0x46, 0x46]] },
  // MP4/MOV/3GP pertencem ao formato ISO BMFF: caixa `ftyp` no offset 4.
  'video/mp4': { assinaturas: [[0x66, 0x74, 0x79, 0x70]], salto: 4 },
  'video/quicktime': { assinaturas: [[0x66, 0x74, 0x79, 0x70]], salto: 4 },
  'video/3gpp': { assinaturas: [[0x66, 0x74, 0x79, 0x70]], salto: 4 },
  // WebM/Matroska: cabeçalho EBML.
  'video/webm': { assinaturas: [[0x1a, 0x45, 0xdf, 0xa3]] },
};

export const ehVideo = (mime) => String(mime ?? '').toLowerCase().startsWith('video/');

function pareceMidia(buffer, mime) {
  const definicao = ASSINATURAS[mime];
  if (!definicao) return false;
  const salto = definicao.salto ?? 0;
  return definicao.assinaturas.some(
    (assinatura) => assinatura.every((byte, i) => buffer[salto + i] === byte),
  );
}

function validarMidia(buffer, mime) {
  if (!EXTENSOES[mime]) {
    throw invalido(
      ehVideo(mime)
        ? 'Formato de vídeo não suportado. Envie MP4, MOV (iPhone) ou WebM.'
        : 'Formato de imagem não suportado. Envie JPEG, PNG ou WebP.',
      { campo: 'arquivo' },
    );
  }
  const limite = ehVideo(mime) ? config.maxVideoBytes : config.maxUploadBytes;
  if (buffer.length > limite) {
    const rotulo = ehVideo(mime) ? 'Vídeo' : 'Imagem';
    throw new ErroApp(`${rotulo} maior que o limite de ${Math.round(limite / 1024 / 1024)} MB.`, {
      status: 413,
      codigo: 'arquivo_muito_grande',
    });
  }
  if (!pareceMidia(buffer, mime)) {
    throw invalido(
      ehVideo(mime)
        ? 'O arquivo enviado não parece ser um vídeo válido.'
        : 'O arquivo enviado não parece ser uma imagem válida.',
      { campo: 'arquivo' },
    );
  }
}

function normalizarMime(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase();
}

/**
 * Grava o registro de um anexo (foto ou vídeo) já validado, dentro de uma
 * transação que também registra o evento na trilha de auditoria.
 */
export async function registrarFoto({ os, usuario, tipo, arquivo, mime, tamanho, legenda = null, descricaoEvento = null }) {
  if (!TIPOS_FOTO.includes(tipo)) {
    throw invalido(`Tipo de anexo inválido. Opções: ${TIPOS_FOTO.join(', ')}.`, { campo: 'tipo' });
  }
  const criadoEm = agoraISO();
  return transacao(async (conexao) => {
    const info = await conexao.run(
      `INSERT INTO fotos_os (os_id, tipo, arquivo, mime, tamanho, legenda, usuario_id, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [os.id, tipo, arquivo, mime, tamanho, legenda, usuario.id, criadoEm],
    );

    const substantivo = ehVideo(mime) ? 'Vídeo' : 'Foto';
    await registrarEvento(conexao, {
      osId: os.id,
      tipoEvento: 'foto',
      descricao:
        descricaoEvento ?? `${substantivo} de ${tipo} anexad${ehVideo(mime) ? 'o' : 'a'}${legenda ? `: ${legenda}` : ''}`,
      usuarioId: usuario.id,
    });

    return conexao.get('SELECT * FROM fotos_os WHERE id = ?', [Number(info.lastInsertRowid)]);
  });
}

/**
 * Salva um anexo enviado pelo próprio servidor (corpo binário da requisição).
 */
export async function salvarFoto({ os, usuario, tipo, buffer, mime, legenda = null, descricaoEvento = null }) {
  if (!buffer || buffer.length === 0) throw invalido('Nenhum arquivo foi recebido.');
  const mimeNormalizado = normalizarMime(mime);
  validarMidia(buffer, mimeNormalizado);

  const nomeArquivo = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${EXTENSOES[mimeNormalizado]}`;
  const referencia = await salvarImagem(buffer, nomeArquivo, mimeNormalizado);

  try {
    return await registrarFoto({
      os,
      usuario,
      tipo,
      arquivo: referencia,
      mime: mimeNormalizado,
      tamanho: buffer.length,
      legenda,
      descricaoEvento,
    });
  } catch (erro) {
    // A auditoria é imutável: se o evento não pôde ser gravado, a imagem
    // também não deve ficar órfã no armazenamento.
    await removerImagem(referencia).catch(() => {});
    throw erro;
  }
}

/**
 * Registra um anexo que já foi enviado direto do navegador para o Blob
 * (vídeos grandes não passam pela função serverless — limite de corpo da
 * Vercel). Os metadados são conferidos contra o storage antes de gravar.
 * Idempotente: repetir a confirmação do mesmo arquivo não duplica o registro.
 */
export async function registrarAnexoRemoto({ os, usuario, tipo, arquivo, mime, tamanho, legenda = null }) {
  const existente = await consultarUm('SELECT * FROM fotos_os WHERE arquivo = ? LIMIT 1', arquivo);
  if (existente) return existente;
  const mimeNormalizado = normalizarMime(mime);
  if (!MIMES_VIDEO.includes(mimeNormalizado)) {
    throw invalido('O registro direto é reservado a vídeos.', { campo: 'arquivo' });
  }
  if (Number(tamanho) > config.maxVideoBytes) {
    throw new ErroApp(
      `Vídeo maior que o limite de ${Math.round(config.maxVideoBytes / 1024 / 1024)} MB.`,
      { status: 413, codigo: 'arquivo_muito_grande' },
    );
  }
  return registrarFoto({
    os,
    usuario,
    tipo,
    arquivo,
    mime: mimeNormalizado,
    tamanho: Number(tamanho) || 0,
    legenda,
  });
}

export async function buscarFoto(fotoId) {
  const foto = await consultarUm('SELECT * FROM fotos_os WHERE id = ?', fotoId);
  if (!foto) throw naoEncontrado('Anexo não encontrado.');
  return foto;
}

/** Exclusão definitiva de uma foto/anexo (administrativa). */
export async function excluirFoto(fotoId, usuario = null) {
  const foto = await buscarFoto(fotoId);
  const os = await consultarUm('SELECT numero_os FROM ordens_servico WHERE id = ?', foto.os_id);

  await registrarExclusao({
    tipo: 'foto',
    referencia: os?.numero_os ?? `OS ${foto.os_id}`,
    detalhes: `Anexo de ${foto.tipo}${foto.legenda ? `: ${foto.legenda}` : ''}`,
    usuario,
  });

  await suspenderProtecaoAuditoria();
  try {
    await executar('DELETE FROM fotos_os WHERE id = ?', fotoId);
  } finally {
    await restaurarProtecaoAuditoria();
  }
  await removerImagem(foto.arquivo).catch(() => {});
  return foto;
}

/**
 * Lê os bytes do arquivo a partir da referência guardada (nome no disco local
 * ou URL do Blob). As fotos nunca são expostas sem passar pela checagem de
 * sessão e de loja em /api/fotos/:id/raw.
 *
 * `faixa` ({ inicio, fim }) é usada pelo servidor para responder a requisições
 * Range — o vídeo precisa disso para tocar no Safari/iOS.
 */
export async function lerArquivoFoto(foto, { faixa = null } = {}) {
  const conteudo = await lerImagem(foto.arquivo, { faixa });
  if (!conteudo) {
    throw naoEncontrado('O arquivo do anexo não está mais disponível no servidor.');
  }
  return { conteudo, mime: foto.mime };
}
