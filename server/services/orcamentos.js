import { consultarUm, transacao } from '../db.js';
import { agoraISO, gerarToken } from '../utils.js';
import { registrarEvento, CAMPOS_OS } from './ordens.js';
import { invalido, naoEncontrado, conflito } from '../erros.js';

/**
 * Orçamento enviado ao cliente para aprovação.
 *
 * O técnico lança o valor e o sistema gera um link público com token. O cliente
 * aprova ou recusa sem precisar de login, e a decisão fica gravada na trilha de
 * auditoria — a OS nunca é executada sem uma resposta registrada.
 */

export const STATUS_ORCAMENTO = Object.freeze({
  SEM_ORCAMENTO: 'sem_orcamento',
  PENDENTE: 'pendente',
  APROVADO: 'aprovado',
  RECUSADO: 'recusado',
});

export const ROTULOS_ORCAMENTO = Object.freeze({
  [STATUS_ORCAMENTO.SEM_ORCAMENTO]: 'Sem orçamento',
  [STATUS_ORCAMENTO.PENDENTE]: 'Aguardando aprovação do cliente',
  [STATUS_ORCAMENTO.APROVADO]: 'Orçamento aprovado',
  [STATUS_ORCAMENTO.RECUSADO]: 'Orçamento recusado',
});

const JOINS_PUBLICO = `
  FROM ordens_servico o
  LEFT JOIN lojas l ON l.id = o.loja_id
  LEFT JOIN usuarios a ON a.id = o.atendente_entrada_id
  LEFT JOIN usuarios t ON t.id = o.tecnico_id`;

async function buscarPorToken(token) {
  const os = await consultarUm(`SELECT ${CAMPOS_OS} ${JOINS_PUBLICO} WHERE o.orcamento_token = ?`, token);
  if (!os) throw naoEncontrado('Link de orçamento inválido ou expirado.');
  return os;
}

/** Cria/atualiza o orçamento de uma OS e devolve o link público de aprovação. */
export async function criarOrcamento(os, usuario, { valor, observacao = null, pecas = null }) {
  if (valor == null || !Number.isFinite(Number(valor)) || Number(valor) < 0) {
    throw invalido('Informe o valor do orçamento.', { campo: 'valor' });
  }
  if (os.status === 'retirado' || os.status === 'cancelado') {
    throw conflito('Não é possível enviar orçamento para uma OS já encerrada.');
  }

  const token = gerarToken(18);
  const agora = agoraISO();
  const detalhes = [`Orçamento: R$ ${Number(valor).toFixed(2)}`];
  if (pecas) detalhes.push(`Peças: ${pecas}`);
  if (observacao) detalhes.push(`Obs.: ${observacao}`);

  await transacao(async (conexao) => {
    await conexao.run(
      `UPDATE ordens_servico
          SET orcamento_valor = ?, orcamento_status = ?, orcamento_obs = ?, orcamento_token = ?,
              orcamento_criado_em = ?, orcamento_decidido_em = NULL, atualizado_em = ?
        WHERE id = ?`,
      [Number(valor), STATUS_ORCAMENTO.PENDENTE, observacao, token, agora, agora, os.id],
    );
    await registrarEvento(conexao, {
      osId: os.id,
      tipoEvento: 'orcamento',
      descricao: `${detalhes.join(' | ')} — aguardando aprovação do cliente`,
      usuarioId: usuario?.id ?? null,
    });
  });

  return { token, valor: Number(valor), observacao };
}

/** Registra a decisão do cliente (pelo link público) de forma auditável. */
export async function decidirOrcamentoPorToken(token, { decisao, observacao = null }) {
  if (![STATUS_ORCAMENTO.APROVADO, STATUS_ORCAMENTO.RECUSADO].includes(decisao)) {
    throw invalido('Decisão inválida.', { campo: 'decisao' });
  }
  const os = await buscarPorToken(token);
  if (os.orcamento_status !== STATUS_ORCAMENTO.PENDENTE) {
    throw conflito(`Este orçamento já foi respondido (${ROTULOS_ORCAMENTO[os.orcamento_status] ?? os.orcamento_status}).`);
  }

  const agora = agoraISO();
  const texto = [
    decisao === STATUS_ORCAMENTO.APROVADO ? 'Cliente APROVOU o orçamento' : 'Cliente RECUSOU o orçamento',
    `R$ ${Number(os.orcamento_valor ?? 0).toFixed(2)}`,
    observacao,
  ]
    .filter(Boolean)
    .join(' | ');

  await transacao(async (conexao) => {
    await conexao.run(
      'UPDATE ordens_servico SET orcamento_status = ?, orcamento_decidido_em = ?, atualizado_em = ? WHERE id = ?',
      [decisao, agora, agora, os.id],
    );
    await registrarEvento(conexao, {
      osId: os.id,
      tipoEvento: decisao === STATUS_ORCAMENTO.APROVADO ? 'orcamento_aprovado' : 'orcamento_recusado',
      descricao: texto,
      usuarioId: null,
    });
  });

  return { numeroOS: os.numero_os, decisao, valor: os.orcamento_valor };
}

/** Dados do orçamento para a página pública (sem expor o restante da OS). */
export async function orcamentoPublico(token) {
  const os = await buscarPorToken(token);
  return {
    numeroOS: os.numero_os,
    status: os.orcamento_status,
    valor: os.orcamento_valor,
    observacao: os.orcamento_obs,
    lojaNome: os.loja_nome,
    lojaTelefone: os.loja_telefone,
    marca: os.marca,
    modelo: os.modelo,
    criadoEm: os.orcamento_criado_em,
    decididoEm: os.orcamento_decidido_em,
  };
}

/** Override interno (admin) quando o cliente responde por telefone/balcão. */
export async function decidirOrcamentoInterno(os, usuario, { decisao, observacao = null }) {
  if (os.orcamento_status !== STATUS_ORCAMENTO.PENDENTE) {
    throw conflito('Esta OS não tem orçamento aguardando resposta.');
  }
  const agora = agoraISO();
  await transacao(async (conexao) => {
    await conexao.run(
      'UPDATE ordens_servico SET orcamento_status = ?, orcamento_decidido_em = ?, atualizado_em = ? WHERE id = ?',
      [decisao, agora, agora, os.id],
    );
    await registrarEvento(conexao, {
      osId: os.id,
      tipoEvento: decisao === STATUS_ORCAMENTO.APROVADO ? 'orcamento_aprovado' : 'orcamento_recusado',
      descricao: `Decisão registrada por ${usuario.nome}${observacao ? ` — ${observacao}` : ''}`,
      usuarioId: usuario.id,
    });
  });
  return consultarUm(`SELECT ${CAMPOS_OS} ${JOINS_PUBLICO} WHERE o.id = ?`, os.id);
}

export function urlAprovacao(req, token) {
  const proto = req.headers['x-forwarded-proto'] ?? 'http';
  const host = req.headers.host ?? 'localhost:3000';
  return `${proto}://${host}/#/aprovacao/${token}`;
}

export async function resumoOrcamentos(os) {
  return {
    status: os.orcamento_status ?? STATUS_ORCAMENTO.SEM_ORCAMENTO,
    rotulo: ROTULOS_ORCAMENTO[os.orcamento_status ?? STATUS_ORCAMENTO.SEM_ORCAMENTO],
    valor: os.orcamento_valor ?? null,
    observacao: os.orcamento_obs ?? null,
    token: os.orcamento_token ?? null,
    criadoEm: os.orcamento_criado_em ?? null,
    decididoEm: os.orcamento_decidido_em ?? null,
  };
}
