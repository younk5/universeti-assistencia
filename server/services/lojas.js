import { consultar, consultarUm, executar, semChavesEstrangeiras } from '../db.js';
import { registrarExclusao } from './auditoria.js';
import { agoraISO, slugCodigo } from '../utils.js';
import { conflito, naoEncontrado, invalido } from '../erros.js';

export async function listarLojas({ apenasAtivas = false } = {}) {
  return consultar(
    `SELECT l.*,
            (SELECT COUNT(*) FROM usuarios u WHERE u.loja_id = l.id AND u.ativo = 1) AS total_usuarios,
            (SELECT COUNT(*) FROM ordens_servico o WHERE o.loja_id = l.id) AS total_os,
            (SELECT COUNT(*) FROM ordens_servico o
              WHERE o.loja_id = l.id AND o.status NOT IN ('retirado', 'cancelado')) AS os_abertas
       FROM lojas l
      ${apenasAtivas ? 'WHERE l.ativo = 1' : ''}
      ORDER BY l.nome COLLATE NOCASE`,
  );
}

export async function buscarLoja(id) {
  const loja = await consultarUm('SELECT * FROM lojas WHERE id = ?', id);
  if (!loja) throw naoEncontrado('Loja não encontrada.');
  return loja;
}

export async function criarLoja({ nome, codigo, endereco, telefone }) {
  const codigoFinal = (codigo ? slugCodigo(codigo) : slugCodigo(nome)).slice(0, 6);
  if (await consultarUm('SELECT id FROM lojas WHERE codigo = ?', codigoFinal)) {
    throw conflito(`Já existe uma loja com o código "${codigoFinal}". Escolha outro código.`);
  }
  const info = await executar(
    'INSERT INTO lojas (codigo, nome, endereco, telefone, ativo, criado_em) VALUES (?, ?, ?, ?, 1, ?)',
    codigoFinal,
    nome,
    endereco ?? null,
    telefone ?? null,
    agoraISO(),
  );
  return buscarLoja(Number(info.lastInsertRowid));
}

export async function atualizarLoja(id, dados) {
  const atual = await buscarLoja(id);
  const atribuicoes = {};
  if (dados.nome !== undefined && dados.nome !== null) atribuicoes.nome = dados.nome;
  if (dados.endereco !== undefined) atribuicoes.endereco = dados.endereco;
  if (dados.telefone !== undefined) atribuicoes.telefone = dados.telefone;
  if (dados.ativo !== undefined && dados.ativo !== null) atribuicoes.ativo = dados.ativo ? 1 : 0;

  const colunas = Object.keys(atribuicoes);
  if (!colunas.length) return atual;

  await executar(
    `UPDATE lojas SET ${colunas.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    ...colunas.map((c) => atribuicoes[c]),
    id,
  );
  return buscarLoja(id);
}

export async function desativarLoja(id) {
  const loja = await buscarLoja(id);
  const abertas = await consultarUm(
    `SELECT COUNT(*) AS total FROM ordens_servico WHERE loja_id = ? AND status NOT IN ('retirado', 'cancelado')`,
    id,
  );
  if (Number(abertas.total) > 0) {
    throw invalido(
      `Não é possível desativar "${loja.nome}": existem ${abertas.total} OS em aberto nessa loja. Conclua ou cancele antes.`,
    );
  }
  await executar('UPDATE lojas SET ativo = 0 WHERE id = ?', id);
  return buscarLoja(id);
}

/**
 * Exclusão definitiva. Não há bloqueio: lojas com usuários ou OS vinculados
 * também podem ser removidas (os vínculos ficam órfãos, preservando o
 * histórico). O caminho de desativar continua existindo para quem preferir.
 */
export async function excluirLoja(id, usuario = null) {
  const loja = await buscarLoja(id);
  await registrarExclusao({
    tipo: 'loja',
    referencia: `${loja.codigo} · ${loja.nome}`,
    detalhes: loja.endereco ?? null,
    usuario,
  });
  await semChavesEstrangeiras(async () => {
    await executar('DELETE FROM lojas WHERE id = ?', id);
  });
  return loja;
}
