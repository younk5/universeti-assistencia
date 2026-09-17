import crypto from 'node:crypto';
import { config } from '../config.js';
import { consultarUm, transacao, executar, suspenderProtecaoAuditoria, restaurarProtecaoAuditoria } from '../db.js';
import { agoraISO } from '../utils.js';
import { invalido, naoEncontrado, ErroApp } from '../erros.js';
import { salvarImagem, lerImagem, removerImagem } from '../storage.js';
import { registrarEvento } from './ordens.js';
import { registrarExclusao } from './auditoria.js';

export const TIPOS_FOTO = ['entrada', 'saida', 'retirada', 'assinatura'];

const EXTENSOES = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const CABECALHOS = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
};

function pareceImagem(buffer, mime) {
  const assinaturas = CABECALHOS[mime];
  if (!assinaturas) return false;
  return assinaturas.some((assinatura) => assinatura.every((byte, i) => buffer[i] === byte));
}

export async function salvarFoto({ os, usuario, tipo, buffer, mime, legenda = null, descricaoEvento = null }) {
  if (!TIPOS_FOTO.includes(tipo)) {
    throw invalido(`Tipo de foto inválido. Opções: ${TIPOS_FOTO.join(', ')}.`, { campo: 'tipo' });
  }
  if (!buffer || buffer.length === 0) throw invalido('Nenhuma imagem foi recebida.');
  if (buffer.length > config.maxUploadBytes) {
    throw new ErroApp(`Imagem maior que o limite de ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`, {
      status: 413,
      codigo: 'arquivo_muito_grande',
    });
  }
  const mimeNormalizado = String(mime || '').split(';')[0].trim().toLowerCase();
  if (!EXTENSOES[mimeNormalizado]) {
    throw invalido('Formato de imagem não suportado. Envie JPEG, PNG ou WebP.', { campo: 'arquivo' });
  }
  if (!pareceImagem(buffer, mimeNormalizado)) {
    throw invalido('O arquivo enviado não parece ser uma imagem válida.', { campo: 'arquivo' });
  }

  const nomeArquivo = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${EXTENSOES[mimeNormalizado]}`;
  const referencia = await salvarImagem(buffer, nomeArquivo, mimeNormalizado);

  const criadoEm = agoraISO();
  try {
    const foto = await transacao(async (conexao) => {
      const info = await conexao.run(
        `INSERT INTO fotos_os (os_id, tipo, arquivo, mime, tamanho, legenda, usuario_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [os.id, tipo, referencia, mimeNormalizado, buffer.length, legenda, usuario.id, criadoEm],
      );

      await registrarEvento(conexao, {
        osId: os.id,
        tipoEvento: 'foto',
        descricao: descricaoEvento ?? `Foto de ${tipo} anexada${legenda ? `: ${legenda}` : ''}`,
        usuarioId: usuario.id,
      });

      return conexao.get('SELECT * FROM fotos_os WHERE id = ?', [Number(info.lastInsertRowid)]);
    });
    return foto;
  } catch (erro) {
    // A auditoria é imutável: se o evento não pôde ser gravado, a imagem
    // também não deve ficar órfã no armazenamento.
    await removerImagem(referencia);
    throw erro;
  }
}

export async function buscarFoto(fotoId) {
  const foto = await consultarUm('SELECT * FROM fotos_os WHERE id = ?', fotoId);
  if (!foto) throw naoEncontrado('Foto não encontrada.');
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
 * Lê os bytes da imagem a partir da referência guardada (arquivo local ou URL
 * do Blob). As fotos nunca são expostas sem passar pela checagem de sessão e
 * de loja em /api/fotos/:id/raw.
 */
export async function lerArquivoFoto(foto) {
  const conteudo = await lerImagem(foto.arquivo);
  if (!conteudo) {
    throw naoEncontrado('O arquivo da imagem não está mais disponível no servidor.');
  }
  return { conteudo, mime: foto.mime };
}
