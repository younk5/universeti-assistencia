import { consultar, consultarUm, executar } from '../db.js';
import { agoraISO } from '../utils.js';
import { enviarPushParaUsuarios, obterChavesVapid } from './push.js';

/**
 * Avisos internos (sino do sistema) + push do navegador.
 *
 * Cada aviso é uma linha por destinatário: o mesmo fato gera um registro para
 * cada pessoa que precisa saber, e cada uma marca o seu como lido. O push é
 * disparado na hora da criação (sem cron), então não existe atraso entre o
 * aparelho dar entrada e o celular do dono apitar.
 */

export const TIPOS_AVISO = Object.freeze({
  NOVA_OS: 'os_criada',
  OS_PRONTA: 'os_pronta',
  GARANTIA: 'os_garantia',
});

// Reexportado para que a camada HTTP fale só com este serviço.
export { enviarPushParaUsuarios };

/** Tempo máximo que uma requisição gasta tentando avisar por push. */
const LIMITE_PUSH_MS = 6000;
const RETENCAO_DIAS = 90;

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Quem precisa saber de uma OS: admin e técnicos (rede inteira) + atendentes da
 * loja onde o aparelho deu entrada. Quem registrou a entrada não é avisado.
 */
export async function destinatariosDaLoja(lojaId, { excetoUsuarioId = null } = {}) {
  return consultar(
    `SELECT id, nome, papel FROM usuarios
      WHERE ativo = 1
        AND (papel IN ('admin', 'tecnico') OR loja_id = ?)
        AND id <> ?
      ORDER BY id`,
    lojaId,
    excetoUsuarioId ?? 0,
  );
}

export async function criarAvisos({ tipo, osId = null, titulo, mensagem = null, url = null, destinatarios }) {
  if (!destinatarios?.length) return [];
  const agora = agoraISO();
  const ids = [];
  for (const usuario of destinatarios) {
    const info = await executar(
      `INSERT INTO notificacoes (usuario_id, os_id, tipo, titulo, mensagem, url, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      usuario.id,
      osId,
      tipo,
      titulo,
      mensagem,
      url,
      agora,
    );
    ids.push(Number(info.lastInsertRowid));
  }
  await limparAvisosAntigos();
  return ids;
}

/** Mantém a tabela pequena: avisos lidos com mais de 90 dias saem do caminho. */
async function limparAvisosAntigos() {
  const limite = new Date(Date.now() - RETENCAO_DIAS * 86400000).toISOString();
  try {
    await executar('DELETE FROM notificacoes WHERE lido_em IS NOT NULL AND criado_em < ?', limite);
  } catch (erro) {
    console.warn('[avisos] limpeza falhou:', erro?.message ?? erro);
  }
}

export async function listarAvisos(usuario, { limite = 30 } = {}) {
  return consultar(
    `SELECT n.id, n.tipo, n.titulo, n.mensagem, n.url, n.criado_em, n.lido_em,
            n.os_id, o.numero_os, o.status AS os_status
       FROM notificacoes n
       LEFT JOIN ordens_servico o ON o.id = n.os_id
      WHERE n.usuario_id = ?
      ORDER BY n.id DESC
      LIMIT ?`,
    usuario.id,
    Math.min(Math.max(Number(limite) || 30, 1), 100),
  );
}

export async function contarNaoLidos(usuario) {
  const linha = await consultarUm(
    'SELECT COUNT(*) AS total FROM notificacoes WHERE usuario_id = ? AND lido_em IS NULL',
    usuario.id,
  );
  return Number(linha?.total ?? 0);
}

/** Marca avisos como lidos. Sem `ids`, marca todos (é o botão "marcar todas"). */
export async function marcarLidos(usuario, ids = null) {
  const agora = agoraISO();
  if (Array.isArray(ids) && ids.length) {
    const lista = ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0).slice(0, 200);
    if (!lista.length) return 0;
    const info = await executar(
      `UPDATE notificacoes SET lido_em = ?
        WHERE usuario_id = ? AND lido_em IS NULL AND id IN (${lista.map(() => '?').join(', ')})`,
      agora,
      usuario.id,
      ...lista,
    );
    return Number(info?.changes ?? 0);
  }
  const info = await executar(
    'UPDATE notificacoes SET lido_em = ? WHERE usuario_id = ? AND lido_em IS NULL',
    agora,
    usuario.id,
  );
  return Number(info?.changes ?? 0);
}

/* -------------------------------------------------------------------------- */
/* Inscrições de push                                                         */
/* -------------------------------------------------------------------------- */

export async function salvarInscricao(usuario, { endpoint, p256dh, auth, userAgent = null }) {
  const agora = agoraISO();
  // O mesmo navegador pode ser usado por outra pessoa: a inscrição passa a
  // pertencer a quem acabou de entrar, em vez de duplicar o envio.
  await executar(
    `INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth, user_agent, criado_em)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       usuario_id = excluded.usuario_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       user_agent = excluded.user_agent,
       falhas = 0`,
    usuario.id,
    endpoint,
    p256dh,
    auth,
    userAgent ? String(userAgent).slice(0, 300) : null,
    agora,
  );
  const linha = await consultarUm('SELECT COUNT(*) AS total FROM push_inscricoes WHERE usuario_id = ?', usuario.id);
  return Number(linha?.total ?? 0);
}

export async function removerInscricao(usuario, endpoint) {
  await executar('DELETE FROM push_inscricoes WHERE usuario_id = ? AND endpoint = ?', usuario.id, endpoint);
  const linha = await consultarUm('SELECT COUNT(*) AS total FROM push_inscricoes WHERE usuario_id = ?', usuario.id);
  return Number(linha?.total ?? 0);
}

export async function contarInscricoes(usuario) {
  const linha = await consultarUm('SELECT COUNT(*) AS total FROM push_inscricoes WHERE usuario_id = ?', usuario.id);
  return Number(linha?.total ?? 0);
}

/** Chave pública VAPID usada pelo navegador para se inscrever. */
export async function chavePublicaPush() {
  const chaves = await obterChavesVapid();
  return chaves.publicaBase64Url;
}

/* -------------------------------------------------------------------------- */
/* Envio do aviso de nova OS                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Avisa a equipe que um aparelho deu entrada. Nunca lança: uma falha de
 * notificação não pode impedir a abertura da OS no balcão.
 */
export async function avisarNovaOS({ os, autor }) {
  try {
    const destinatarios = await destinatariosDaLoja(os.loja_id, { excetoUsuarioId: autor?.id });
    if (!destinatarios.length) return { avisos: destinatarios.length, push: null };

    const titulo = `Novo aparelho na assistência · ${os.numero_os}`;
    const partes = [`${os.marca} ${os.modelo}`, os.cliente_nome, os.loja_nome ?? null].filter(Boolean);
    const mensagem = partes.join(' · ');
    const url = `/ordens/${os.id}`;

    await criarAvisos({
      tipo: TIPOS_AVISO.NOVA_OS,
      osId: os.id,
      titulo,
      mensagem,
      url,
      destinatarios,
    });

    // O push tem teto de tempo: a Vercel encerra a função e o balcão não pode
    // esperar o serviço de push de cada celular responder.
    const push = await Promise.race([
      enviarPushParaUsuarios(destinatarios, {
        titulo,
        mensagem,
        url: `/#/ordens/${os.id}`,
        tag: `os-${os.id}`,
      }),
      esperar(LIMITE_PUSH_MS).then(() => ({ enviados: 0, removidos: 0, falhas: 0, expirado: true })),
    ]);

    return { avisos: destinatarios.length, push };
  } catch (erro) {
    console.warn('[avisos] falha ao avisar nova OS:', erro?.message ?? erro);
    return { avisos: 0, push: null };
  }
}
