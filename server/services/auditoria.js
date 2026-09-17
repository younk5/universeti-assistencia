import { consultar, executar } from '../db.js';
import { agoraISO } from '../utils.js';

/**
 * Trilha de exclusões administrativas.
 *
 * Diferente da auditoria da OS (imutável e ligada ao aparelho), aqui fica só o
 * "quem apagou o quê e quando" — o suficiente para dar rastreabilidade sem
 * guardar o conteúdo removido.
 */
export async function registrarExclusao({ tipo, referencia = null, detalhes = null, usuario = null }) {
  await executar(
    `INSERT INTO exclusoes_log (tipo, referencia, detalhes, usuario_id, usuario_nome, criado_em)
     VALUES (?, ?, ?, ?, ?, ?)`,
    tipo,
    referencia,
    detalhes,
    usuario?.id ?? null,
    usuario?.nome ?? null,
    agoraISO(),
  );
}

export async function listarExclusoes({ limite = 100 } = {}) {
  const total = Math.min(Math.max(Number(limite) || 100, 1), 500);
  return consultar('SELECT * FROM exclusoes_log ORDER BY id DESC LIMIT ?', total);
}
