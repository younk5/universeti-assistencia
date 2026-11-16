import { consultar, consultarUm, executar } from '../db.js';
import { registrarExclusao } from './auditoria.js';
import { agoraISO } from '../utils.js';
import { conflito, naoEncontrado, invalido } from '../erros.js';

/**
 * Inventário de peças (administrador).
 *
 * Regra central: ao usar uma peça na conclusão de uma OS, gravamos uma cópia
 * (snapshot) de nome, fornecedor, preço unitário e loja em `pecas_usadas`.
 * Mudanças posteriores no cadastro não reescrevem histórico nem relatórios.
 */

/* -------------------------------------------------------------------------- */
/* Fornecedores                                                               */
/* -------------------------------------------------------------------------- */

export async function listarFornecedores({ busca = null, incluirInativos = true } = {}) {
  const where = [];
  const params = [];
  if (busca) {
    where.push('(f.nome LIKE ? OR f.contato LIKE ? OR f.observacoes LIKE ?)');
    const alvo = `%${busca}%`;
    params.push(alvo, alvo, alvo);
  }
  if (!incluirInativos) where.push('f.ativo = 1');

  const linhas = await consultar(
    `SELECT f.*,
            (SELECT COUNT(*) FROM pecas p WHERE p.fornecedor_id = f.id) AS total_pecas,
            (SELECT COUNT(*) FROM pecas p WHERE p.fornecedor_id = f.id AND p.ativo = 1) AS pecas_ativas
       FROM fornecedores f
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY f.ativo DESC, f.nome COLLATE NOCASE`,
    ...params,
  );
  return linhas.map((f) => ({
    ...f,
    ativo: Number(f.ativo) === 1,
    total_pecas: Number(f.total_pecas ?? 0),
    pecas_ativas: Number(f.pecas_ativas ?? 0),
  }));
}

export async function buscarFornecedor(id) {
  const fornecedor = await consultarUm('SELECT * FROM fornecedores WHERE id = ?', Number(id));
  if (!fornecedor) throw naoEncontrado('Fornecedor não encontrado.');
  return { ...fornecedor, ativo: Number(fornecedor.ativo) === 1 };
}

async function nomeDeFornecedorEmUso(nome, ignorarId = null) {
  const linha = await consultarUm(
    `SELECT id FROM fornecedores WHERE nome = ? COLLATE NOCASE ${ignorarId ? 'AND id <> ?' : ''}`,
    ...(ignorarId ? [nome, Number(ignorarId)] : [nome]),
  );
  return Boolean(linha);
}

export async function criarFornecedor({ nome, contato = null, observacoes = null }) {
  if (await nomeDeFornecedorEmUso(nome)) {
    throw conflito(`Já existe um fornecedor chamado "${nome}".`);
  }
  const agora = agoraISO();
  const info = await executar(
    `INSERT INTO fornecedores (nome, contato, observacoes, ativo, criado_em, atualizado_em)
     VALUES (?, ?, ?, 1, ?, ?)`,
    nome,
    contato,
    observacoes,
    agora,
    agora,
  );
  return buscarFornecedor(Number(info.lastInsertRowid));
}

export async function atualizarFornecedor(id, dados) {
  const atual = await buscarFornecedor(id);
  const atribuicoes = {};
  if (dados.nome !== undefined && dados.nome !== null && dados.nome !== atual.nome) {
    if (await nomeDeFornecedorEmUso(dados.nome, id)) {
      throw conflito(`Já existe um fornecedor chamado "${dados.nome}".`);
    }
    atribuicoes.nome = dados.nome;
  }
  if (dados.contato !== undefined) atribuicoes.contato = dados.contato;
  if (dados.observacoes !== undefined) atribuicoes.observacoes = dados.observacoes;
  if (dados.ativo !== undefined && dados.ativo !== null) atribuicoes.ativo = dados.ativo ? 1 : 0;

  const colunas = Object.keys(atribuicoes);
  if (!colunas.length) return atual;

  atribuicoes.atualizado_em = agoraISO();
  const todas = Object.keys(atribuicoes);
  await executar(
    `UPDATE fornecedores SET ${todas.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    ...todas.map((c) => atribuicoes[c]),
    Number(id),
  );
  return buscarFornecedor(id);
}

/**
 * Exclusão definitiva só é permitida sem rastro: fornecedor com peças
 * cadastradas ou peças já usadas em OS não pode sair do banco (o histórico e os
 * relatórios perdem a referência). Nesse caso orientamos desativar.
 */
export async function excluirFornecedor(id, usuario = null) {
  const fornecedor = await buscarFornecedor(id);
  const pecas = await consultarUm('SELECT COUNT(*) AS total FROM pecas WHERE fornecedor_id = ?', Number(id));
  const usadas = await consultarUm('SELECT COUNT(*) AS total FROM pecas_usadas WHERE fornecedor_id = ?', Number(id));

  if (Number(usadas.total) > 0) {
    throw invalido(
      `"${fornecedor.nome}" já tem peças usadas em ordens de serviço e não pode ser excluído. Desative o fornecedor para tirá-lo das listas.`,
    );
  }
  if (Number(pecas.total) > 0) {
    throw invalido(
      `"${fornecedor.nome}" ainda tem ${pecas.total} peça(s) cadastrada(s). Exclua ou transfira as peças antes.`,
    );
  }

  await registrarExclusao({
    tipo: 'fornecedor',
    referencia: fornecedor.nome,
    detalhes: fornecedor.contato ?? null,
    usuario,
  });
  await executar('DELETE FROM fornecedores WHERE id = ?', Number(id));
  return fornecedor;
}

/* -------------------------------------------------------------------------- */
/* Peças                                                                      */
/* -------------------------------------------------------------------------- */

function normalizarPeca(linha) {
  const estoque = linha.quantidade_estoque === null || linha.quantidade_estoque === undefined
    ? null
    : Number(linha.quantidade_estoque);
  return {
    ...linha,
    preco_custo: Number(linha.preco_custo ?? 0),
    quantidade_estoque: estoque,
    controla_estoque: estoque !== null,
    disponivel: estoque === null || estoque > 0,
    ativo: Number(linha.ativo) === 1,
    total_usado: Number(linha.total_usado ?? 0),
  };
}

export async function listarPecas({
  busca = null,
  fornecedorId = null,
  incluirInativas = false,
  somenteDisponiveis = false,
} = {}) {
  const where = [];
  const params = [];
  if (!incluirInativas) where.push('p.ativo = 1');
  if (fornecedorId) {
    where.push('p.fornecedor_id = ?');
    params.push(Number(fornecedorId));
  }
  if (busca) {
    where.push('(p.nome LIKE ? OR p.modelo LIKE ? OR f.nome LIKE ?)');
    const alvo = `%${busca}%`;
    params.push(alvo, alvo, alvo);
  }
  if (somenteDisponiveis) {
    where.push('(p.quantidade_estoque IS NULL OR p.quantidade_estoque > 0)');
  }

  const linhas = await consultar(
    `SELECT p.*, f.nome AS fornecedor_nome, f.contato AS fornecedor_contato,
            (SELECT COALESCE(SUM(pu.quantidade), 0) FROM pecas_usadas pu WHERE pu.peca_id = p.id) AS total_usado
       FROM pecas p
       JOIN fornecedores f ON f.id = p.fornecedor_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.ativo DESC, p.nome COLLATE NOCASE, f.nome COLLATE NOCASE`,
    ...params,
  );
  return linhas.map(normalizarPeca);
}

export async function buscarPeca(id) {
  const linha = await consultarUm(
    `SELECT p.*, f.nome AS fornecedor_nome, f.contato AS fornecedor_contato
       FROM pecas p
       JOIN fornecedores f ON f.id = p.fornecedor_id
      WHERE p.id = ?`,
    Number(id),
  );
  if (!linha) throw naoEncontrado('Peça não encontrada no inventário.');
  return normalizarPeca(linha);
}

async function exigirFornecedorAtivo(fornecedorId) {
  const fornecedor = await consultarUm('SELECT id, nome, ativo FROM fornecedores WHERE id = ?', Number(fornecedorId));
  if (!fornecedor) throw invalido('Selecione um fornecedor válido para a peça.', { campo: 'fornecedorId' });
  if (Number(fornecedor.ativo) !== 1) {
    throw invalido(`O fornecedor "${fornecedor.nome}" está desativado. Reative antes de cadastrar peças.`, {
      campo: 'fornecedorId',
    });
  }
  return fornecedor;
}

export async function criarPeca({ fornecedorId, nome, modelo = null, precoCusto, quantidadeEstoque = null }) {
  await exigirFornecedorAtivo(fornecedorId);
  const agora = agoraISO();
  const info = await executar(
    `INSERT INTO pecas (fornecedor_id, nome, modelo, preco_custo, quantidade_estoque, ativo, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    Number(fornecedorId),
    nome,
    modelo,
    Number(precoCusto),
    quantidadeEstoque === null || quantidadeEstoque === undefined ? null : Number(quantidadeEstoque),
    agora,
    agora,
  );
  return buscarPeca(Number(info.lastInsertRowid));
}

export async function atualizarPeca(id, dados) {
  const atual = await buscarPeca(id);
  const atribuicoes = {};

  if (dados.fornecedorId !== undefined && dados.fornecedorId !== null) {
    await exigirFornecedorAtivo(dados.fornecedorId);
    atribuicoes.fornecedor_id = Number(dados.fornecedorId);
  }
  if (dados.nome !== undefined && dados.nome !== null) atribuicoes.nome = dados.nome;
  if (dados.modelo !== undefined) atribuicoes.modelo = dados.modelo;
  if (dados.precoCusto !== undefined && dados.precoCusto !== null) atribuicoes.preco_custo = Number(dados.precoCusto);
  if (dados.quantidadeEstoque !== undefined) {
    atribuicoes.quantidade_estoque = dados.quantidadeEstoque === null ? null : Number(dados.quantidadeEstoque);
  }
  if (dados.ativo !== undefined && dados.ativo !== null) atribuicoes.ativo = dados.ativo ? 1 : 0;

  const colunas = Object.keys(atribuicoes);
  if (!colunas.length) return atual;

  atribuicoes.atualizado_em = agoraISO();
  const todas = Object.keys(atribuicoes);
  await executar(
    `UPDATE pecas SET ${todas.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    ...todas.map((c) => atribuicoes[c]),
    Number(id),
  );
  return buscarPeca(id);
}

/**
 * Peça já usada em alguma OS não pode ser apagada (o histórico aponta para
 * ela); nesse caso ela é desativada para sumir das listas de seleção.
 */
export async function excluirPeca(id, usuario = null) {
  const peca = await buscarPeca(id);
  const usadas = await consultarUm('SELECT COUNT(*) AS total FROM pecas_usadas WHERE peca_id = ?', Number(id));

  if (Number(usadas.total) > 0) {
    await executar('UPDATE pecas SET ativo = 0, atualizado_em = ? WHERE id = ?', agoraISO(), Number(id));
    return { peca: await buscarPeca(id), desativada: true, totalUsado: Number(usadas.total) };
  }

  await registrarExclusao({
    tipo: 'peca',
    referencia: `${peca.nome}${peca.modelo ? ` · ${peca.modelo}` : ''}`,
    detalhes: peca.fornecedor_nome,
    usuario,
  });
  await executar('DELETE FROM pecas WHERE id = ?', Number(id));
  return { peca, desativada: false, totalUsado: 0 };
}

/* -------------------------------------------------------------------------- */
/* Consumo na conclusão da OS                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Grava as peças usadas em uma OS dentro da transação da conclusão.
 * Dá baixa no estoque (quando controlado) e congela preço/fornecedor/nome.
 *
 * @param {object} conexao conexão da transação (`transacao`)
 * @param {object} params
 * @param {{id:number, numero_os:string, loja_id:number, modelo:string, marca?:string}} params.os
 * @param {{pecaId:number, quantidade:number}[]} params.itens
 * @param {number} params.usuarioId
 * @returns {Promise<object[]>} linhas de `pecas_usadas` criadas
 */
export async function registrarPecasUsadas(conexao, { os, itens, usuarioId }) {
  if (!Array.isArray(itens) || !itens.length) return [];

  const loja = await conexao.get('SELECT id, nome FROM lojas WHERE id = ?', [os.loja_id]);
  const lojaNome = loja?.nome ?? 'Loja removida';
  const aparelho = [os.marca, os.modelo].filter(Boolean).join(' ') || null;
  const usadoEm = agoraISO();
  const criadas = [];

  for (const item of itens) {
    const quantidade = Number(item.quantidade ?? 1);
    const peca = await conexao.get(
      `SELECT p.*, f.nome AS fornecedor_nome
         FROM pecas p
         JOIN fornecedores f ON f.id = p.fornecedor_id
        WHERE p.id = ?`,
      [Number(item.pecaId)],
    );
    if (!peca) throw invalido('Uma das peças escolhidas não existe mais no inventário. Atualize a lista.');
    if (Number(peca.ativo) !== 1) throw invalido(`A peça "${peca.nome}" está desativada e não pode ser usada.`);

    if (peca.quantidade_estoque !== null && peca.quantidade_estoque !== undefined) {
      const baixa = await conexao.run(
        'UPDATE pecas SET quantidade_estoque = quantidade_estoque - ?, atualizado_em = ? WHERE id = ? AND quantidade_estoque >= ?',
        [quantidade, usadoEm, peca.id, quantidade],
      );
      if (!baixa?.changes) {
        throw invalido(
          `Estoque insuficiente para "${peca.nome}": restam ${peca.quantidade_estoque} unidade(s) e você pediu ${quantidade}.`,
        );
      }
    }

    const precoUnitario = Number(peca.preco_custo ?? 0);
    const precoTotal = Number((precoUnitario * quantidade).toFixed(2));
    const info = await conexao.run(
      `INSERT INTO pecas_usadas
         (os_id, peca_id, fornecedor_id, loja_id, nome_peca, modelo, fornecedor_nome, loja_nome,
          modelo_aparelho, quantidade, preco_unitario, preco_total, os_numero, usuario_id, usado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        os.id,
        peca.id,
        peca.fornecedor_id,
        os.loja_id,
        peca.nome,
        peca.modelo ?? null,
        peca.fornecedor_nome,
        lojaNome,
        aparelho,
        quantidade,
        precoUnitario,
        precoTotal,
        os.numero_os ?? null,
        usuarioId ?? null,
        usadoEm,
      ],
    );
    criadas.push({
      id: Number(info.lastInsertRowid),
      nome: peca.nome,
      quantidade,
      precoUnitario,
      precoTotal,
      fornecedor: peca.fornecedor_nome,
    });
  }

  return criadas;
}

export async function listarPecasUsadasDaOS(osId) {
  const linhas = await consultar(
    `SELECT id, nome_peca, modelo, fornecedor_nome, loja_nome, modelo_aparelho,
            quantidade, preco_unitario, preco_total, usado_em
       FROM pecas_usadas
      WHERE os_id = ?
      ORDER BY fornecedor_nome COLLATE NOCASE, nome_peca COLLATE NOCASE`,
    Number(osId),
  );
  return linhas.map((l) => ({
    ...l,
    quantidade: Number(l.quantidade),
    preco_unitario: Number(l.preco_unitario),
    preco_total: Number(l.preco_total),
  }));
}

/* -------------------------------------------------------------------------- */
/* Gastos com peças (relatório)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Agrupa o consumo por fornecedor e por loja dentro de um período.
 *
 * @param {object} params
 * @param {string|null} params.de  início (ISO ou YYYY-MM-DD)
 * @param {string|null} params.ate fim (ISO ou YYYY-MM-DD — inclusive o dia todo)
 * @param {number|null} params.lojaId
 * @param {number|null} params.fornecedorId
 */
export async function gastosPecas({ de = null, ate = null, lojaId = null, fornecedorId = null } = {}) {
  const where = [];
  const params = [];
  if (de) {
    where.push('pu.usado_em >= ?');
    params.push(de.length === 10 ? `${de}T00:00:00.000Z` : de);
  }
  if (ate) {
    where.push('pu.usado_em <= ?');
    params.push(ate.length === 10 ? `${ate}T23:59:59.999Z` : ate);
  }
  if (lojaId) {
    where.push('pu.loja_id = ?');
    params.push(Number(lojaId));
  }
  if (fornecedorId) {
    where.push('pu.fornecedor_id = ?');
    params.push(Number(fornecedorId));
  }

  const filtro = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const linhas = await consultar(
    `SELECT pu.fornecedor_id, pu.fornecedor_nome, pu.nome_peca, pu.modelo, pu.loja_id, pu.loja_nome,
            pu.modelo_aparelho, pu.quantidade, pu.preco_unitario, pu.preco_total, pu.usado_em, pu.os_numero
       FROM pecas_usadas pu
      ${filtro}
      ORDER BY pu.fornecedor_nome COLLATE NOCASE, pu.usado_em, pu.id`,
    ...params,
  );

  const porFornecedor = new Map();
  const porLoja = new Map();
  let totalGeral = 0;
  let totalItens = 0;

  for (const linha of linhas) {
    const valor = Number(linha.preco_total ?? 0);
    const quantidade = Number(linha.quantidade ?? 0);
    totalGeral += valor;
    totalItens += quantidade;

    const chaveFornecedor = String(linha.fornecedor_id);
    if (!porFornecedor.has(chaveFornecedor)) {
      porFornecedor.set(chaveFornecedor, {
        fornecedorId: Number(linha.fornecedor_id),
        fornecedor: linha.fornecedor_nome,
        itens: [],
        subtotal: 0,
        totalItens: 0,
      });
    }
    const grupo = porFornecedor.get(chaveFornecedor);
    grupo.itens.push({
      peca: linha.nome_peca,
      modelo: linha.modelo,
      aparelho: linha.modelo_aparelho,
      loja: linha.loja_nome,
      lojaId: Number(linha.loja_id),
      quantidade,
      precoUnitario: Number(linha.preco_unitario ?? 0),
      preco: valor,
      data: linha.usado_em,
      os: linha.os_numero,
    });
    grupo.subtotal = Number((grupo.subtotal + valor).toFixed(2));
    grupo.totalItens += quantidade;

    const chaveLoja = String(linha.loja_id);
    if (!porLoja.has(chaveLoja)) {
      porLoja.set(chaveLoja, { lojaId: Number(linha.loja_id), loja: linha.loja_nome, total: 0, totalItens: 0 });
    }
    const grupoLoja = porLoja.get(chaveLoja);
    grupoLoja.total = Number((grupoLoja.total + valor).toFixed(2));
    grupoLoja.totalItens += quantidade;
  }

  return {
    fornecedores: [...porFornecedor.values()],
    porLoja: [...porLoja.values()].sort((a, b) => b.total - a.total),
    totalGeral: Number(totalGeral.toFixed(2)),
    totalItens,
    totalLancamentos: linhas.length,
  };
}
