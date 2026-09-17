import { consultar, consultarUm, executar, transacao, suspenderProtecaoAuditoria, restaurarProtecaoAuditoria } from '../db.js';
import { agoraISO } from '../utils.js';
import { removerImagem } from '../storage.js';
import { registrarExclusao } from './auditoria.js';
import { ErroApp, naoEncontrado, invalido, conflito } from '../erros.js';

export const STATUS = Object.freeze({
  AGUARDANDO: 'aguardando',
  EM_MANUTENCAO: 'em_manutencao',
  AGUARDANDO_PECA: 'aguardando_peca',
  PRONTO: 'pronto',
  RETIRADO: 'retirado',
  CANCELADO: 'cancelado',
});

export const STATUS_VALIDOS = Object.values(STATUS);

export const ROTULOS_STATUS = Object.freeze({
  [STATUS.AGUARDANDO]: 'Aguardando',
  [STATUS.EM_MANUTENCAO]: 'Em manutenção',
  [STATUS.AGUARDANDO_PECA]: 'Aguardando peça',
  [STATUS.PRONTO]: 'Pronto para retirada',
  [STATUS.RETIRADO]: 'Retirado',
  [STATUS.CANCELADO]: 'Cancelado',
});

/**
 * Grafo de transições permitidas. Qualquer mudança de status fora daqui é
 * rejeitada — o histórico precisa ser coerente para valer como auditoria.
 */
const TRANSICOES = {
  [STATUS.AGUARDANDO]: [STATUS.EM_MANUTENCAO, STATUS.CANCELADO],
  [STATUS.EM_MANUTENCAO]: [STATUS.AGUARDANDO_PECA, STATUS.PRONTO, STATUS.AGUARDANDO],
  [STATUS.AGUARDANDO_PECA]: [STATUS.EM_MANUTENCAO, STATUS.PRONTO],
  [STATUS.PRONTO]: [STATUS.RETIRADO, STATUS.EM_MANUTENCAO],
  [STATUS.RETIRADO]: [],
  [STATUS.CANCELADO]: [STATUS.AGUARDANDO],
};

export const CAMPOS_OS =
  'o.*, ' +
  'l.nome AS loja_nome, l.codigo AS loja_codigo, l.telefone AS loja_telefone, l.endereco AS loja_endereco, ' +
  'a.nome AS atendente_nome, t.nome AS tecnico_nome';

const JOINS_OS = `
  FROM ordens_servico o
  LEFT JOIN lojas l ON l.id = o.loja_id
  LEFT JOIN usuarios a ON a.id = o.atendente_entrada_id
  LEFT JOIN usuarios t ON t.id = o.tecnico_id`;

export async function gerarNumeroOS(conexao, lojaId) {
  const loja = await conexao.get('SELECT codigo FROM lojas WHERE id = ?', [lojaId]);
  if (!loja) throw invalido('Loja inválida para gerar o número da OS.');
  const ano = new Date().getFullYear();
  const prefixo = `${loja.codigo}-${ano}-`;
  const linha = await conexao.get(
    'SELECT numero_os FROM ordens_servico WHERE numero_os LIKE ? ORDER BY numero_os DESC LIMIT 1',
    [`${prefixo}%`],
  );
  let sequencia = 1;
  if (linha) {
    const parte = Number(String(linha.numero_os).slice(prefixo.length));
    if (Number.isFinite(parte)) sequencia = parte + 1;
  }
  let numero = `${prefixo}${String(sequencia).padStart(4, '0')}`;
  while (await conexao.get('SELECT 1 FROM ordens_servico WHERE numero_os = ?', [numero])) {
    sequencia += 1;
    numero = `${prefixo}${String(sequencia).padStart(4, '0')}`;
  }
  return numero;
}

export async function registrarEvento(conexao, { osId, tipoEvento, statusAnterior = null, statusNovo = null, descricao = null, usuarioId = null }) {
  await conexao.run(
    `INSERT INTO eventos_os (os_id, tipo_evento, status_anterior, status_novo, descricao, usuario_id, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [osId, tipoEvento, statusAnterior, statusNovo, descricao, usuarioId, agoraISO()],
  );
}

export async function criarOS(usuario, dados, lojaId, conexaoExterna = null) {
  const executarCriacao = async (conexao) => {
    const numero = await gerarNumeroOS(conexao, lojaId);
    const agora = agoraISO();
    const info = await conexao.run(
      `INSERT INTO ordens_servico (
          numero_os, loja_id, cliente_nome, cliente_telefone, tipo_aparelho, marca, modelo, cor, imei,
          acessorios, defeito_relatado, estado_aparelho, status, valor, atendente_entrada_id,
          criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        numero,
        lojaId,
        dados.clienteNome,
        dados.clienteTelefone,
        dados.tipoAparelho,
        dados.marca,
        dados.modelo,
        dados.cor ?? null,
        dados.imei ?? null,
        dados.acessorios ?? null,
        dados.defeitoRelatado,
        dados.estadoAparelho ?? null,
        STATUS.AGUARDANDO,
        dados.valorEstimado ?? null,
        dados.atendenteEntradaId ?? usuario.id,
        agora,
        agora,
      ],
    );
    const osId = Number(info.lastInsertRowid);
    await registrarEvento(conexao, {
      osId,
      tipoEvento: 'criacao',
      statusNovo: STATUS.AGUARDANDO,
      descricao: `Entrada registrada na loja ${dados.lojaNome ?? ''}`.trim(),
      usuarioId: usuario?.id ?? dados.atendenteEntradaId,
    });
    return osId;
  };

  if (conexaoExterna) return executarCriacao(conexaoExterna);
  return transacao(executarCriacao);
}

export async function buscarOS(osId, usuario, { conexao = null } = {}) {
  const os = conexao
    ? await conexao.get(`SELECT ${CAMPOS_OS} ${JOINS_OS} WHERE o.id = ?`, [osId])
    : await consultarUm(`SELECT ${CAMPOS_OS} ${JOINS_OS} WHERE o.id = ?`, osId);
  if (!os) throw naoEncontrado('Ordem de serviço não encontrada.');
  if (usuario.papel !== 'admin' && Number(os.loja_id) !== Number(usuario.lojaId)) {
    throw new ErroApp('Esta OS pertence a outra loja.', { status: 403, codigo: 'loja_restrita' });
  }
  return os;
}

export async function buscarOSPorNumero(numeroOS, usuario) {
  const os = await consultarUm(
    `SELECT ${CAMPOS_OS} ${JOINS_OS} WHERE o.numero_os = ?`,
    String(numeroOS).toUpperCase(),
  );
  if (!os) throw naoEncontrado('Ordem de serviço não encontrada.');
  if (usuario.papel !== 'admin' && Number(os.loja_id) !== Number(usuario.lojaId)) {
    throw new ErroApp('Esta OS pertence a outra loja.', { status: 403, codigo: 'loja_restrita' });
  }
  return os;
}

/**
 * Exclusão definitiva de uma OS: remove eventos, fotos e a própria ordem.
 * A proteção de auditoria é suspensa propositalmente nesta operação
 * administrativa e religada em seguida.
 */
export async function excluirOS(osId, usuario) {
  const os = await buscarOS(osId, usuario);
  const fotos = await consultar('SELECT arquivo FROM fotos_os WHERE os_id = ?', osId);

  await registrarExclusao({
    tipo: 'os',
    referencia: os.numero_os,
    detalhes: `Cliente ${os.cliente_nome} · ${os.marca} ${os.modelo}`,
    usuario,
  });

  await suspenderProtecaoAuditoria();
  try {
    await executar('DELETE FROM fotos_os WHERE os_id = ?', osId);
    await executar('DELETE FROM eventos_os WHERE os_id = ?', osId);
    await executar('DELETE FROM ordens_servico WHERE id = ?', osId);
  } finally {
    await restaurarProtecaoAuditoria();
  }

  for (const foto of fotos) {
    await removerImagem(foto.arquivo).catch(() => {});
  }
  return os;
}

export function validarTransicao(os, novoStatus) {
  if (os.status === novoStatus) {
    throw conflito(`A OS ${os.numero_os} já está com o status "${ROTULOS_STATUS[novoStatus]}".`);
  }
  const permitidos = TRANSICOES[os.status] ?? [];
  if (!permitidos.includes(novoStatus)) {
    throw conflito(
      `Não é possível ir de "${ROTULOS_STATUS[os.status]}" para "${ROTULOS_STATUS[novoStatus]}". ` +
        `Transições possíveis: ${permitidos.map((s) => ROTULOS_STATUS[s]).join(', ') || 'nenhuma'}.`,
    );
  }
}

/**
 * Atualiza o status da OS de forma transacional e auditável:
 * valida a transição, grava o evento e só então persiste.
 */
export async function alterarStatus(osId, usuario, novoStatus, { descricao = null, campos = {}, tiposEvento = {} } = {}) {
  return transacao(async (conexao) => {
    const os = await conexao.get('SELECT * FROM ordens_servico WHERE id = ?', [osId]);
    if (!os) throw naoEncontrado('Ordem de serviço não encontrada.');
    if (usuario.papel !== 'admin' && Number(os.loja_id) !== Number(usuario.lojaId)) {
      throw new ErroApp('Esta OS pertence a outra loja.', { status: 403, codigo: 'loja_restrita' });
    }
    validarTransicao(os, novoStatus);

    const agora = agoraISO();
    const atribuicoes = { ...campos, status: novoStatus, atualizado_em: agora };
    const colunas = Object.keys(atribuicoes);
    await conexao.run(
      `UPDATE ordens_servico SET ${colunas.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...colunas.map((c) => atribuicoes[c]), osId],
    );

    await registrarEvento(conexao, {
      osId,
      tipoEvento: tiposEvento[novoStatus] ?? 'status',
      statusAnterior: os.status,
      statusNovo: novoStatus,
      descricao,
      usuarioId: usuario.id,
    });

    return conexao.get(`SELECT ${CAMPOS_OS} ${JOINS_OS} WHERE o.id = ?`, [osId]);
  });
}

export async function listarEventos(osId) {
  return consultar(
    `SELECT e.*, u.nome AS usuario_nome, u.papel AS usuario_papel
       FROM eventos_os e
       LEFT JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.os_id = ?
      ORDER BY e.id ASC`,
    osId,
  );
}

export async function listarFotos(osId) {
  return consultar(
    `SELECT f.id, f.os_id, f.tipo, f.mime, f.tamanho, f.legenda, f.criado_em, f.usuario_id, u.nome AS usuario_nome
       FROM fotos_os f
       LEFT JOIN usuarios u ON u.id = f.usuario_id
      WHERE f.os_id = ?
      ORDER BY f.id ASC`,
    osId,
  );
}

/* -------------------------------------------------------------------------- */
/* Filtros / listagem                                                          */
/* -------------------------------------------------------------------------- */

export function montarFiltros({ usuario, lojaId, status, tecnicoId, busca, de, ate }) {
  const where = [];
  const params = [];

  if (usuario.papel === 'admin') {
    if (lojaId) {
      where.push('o.loja_id = ?');
      params.push(Number(lojaId));
    }
  } else {
    where.push('o.loja_id = ?');
    params.push(usuario.lojaId);
  }

  if (status && status !== 'todos') {
    const lista = String(status).split(',').map((s) => s.trim()).filter(Boolean);
    for (const s of lista) {
      if (!STATUS_VALIDOS.includes(s)) throw invalido(`Status inválido no filtro: ${s}`);
    }
    if (lista.length) {
      where.push(`o.status IN (${lista.map(() => '?').join(', ')})`);
      params.push(...lista);
    }
  }

  if (tecnicoId) {
    where.push('o.tecnico_id = ?');
    params.push(Number(tecnicoId));
  }

  if (busca && String(busca).trim()) {
    const termo = `%${String(busca).trim().toLowerCase()}%`;
    const digitos = String(busca).replace(/\D/g, '');
    const partes = [
      'lower(o.numero_os) LIKE ?',
      'lower(o.cliente_nome) LIKE ?',
      'lower(o.modelo) LIKE ?',
      'lower(o.marca) LIKE ?',
      'lower(o.imei) LIKE ?',
    ];
    params.push(termo, termo, termo, termo, termo);
    // Telefone só entra na busca quando o termo tem dígitos; caso contrário
    // "LIKE '%%'" traria todos os registros e a busca perderia o sentido.
    if (digitos) {
      // O telefone é guardado formatado — normalizamos os separadores no SQL
      // para que "11987651234" também encontre "(11) 98765-1234".
      partes.push(
        `replace(replace(replace(replace(replace(o.cliente_telefone, '(', ''), ')', ''), '-', ''), ' ', ''), '+', '') LIKE ?`,
      );
      params.push(`%${digitos}%`);
    }
    where.push(`(${partes.join(' OR ')})`);
  }

  if (de) {
    where.push('o.criado_em >= ?');
    params.push(`${de}T00:00:00.000Z`);
  }
  if (ate) {
    where.push('o.criado_em <= ?');
    params.push(`${ate}T23:59:59.999Z`);
  }

  return { clausula: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export async function listarOS({ usuario, limite = 50, offset = 0, ordenar = 'recentes', ...filtro }) {
  const { clausula, params } = montarFiltros({ usuario, ...filtro });
  const ordem = ordenar === 'antigas' ? 'o.criado_em ASC' : 'o.criado_em DESC';

  const itens = await consultar(
    `SELECT ${CAMPOS_OS}, (SELECT COUNT(*) FROM fotos_os f WHERE f.os_id = o.id) AS total_fotos
     ${JOINS_OS}
     ${clausula}
     ORDER BY ${ordem}
     LIMIT ? OFFSET ?`,
    ...params,
    Math.min(Number(limite) || 50, 200),
    Math.max(Number(offset) || 0, 0),
  );

  const linhaTotal = await consultarUm(
    `SELECT COUNT(*) AS total FROM ordens_servico o ${clausula}`,
    ...params,
  );

  return { itens, total: Number(linhaTotal?.total ?? 0) };
}
