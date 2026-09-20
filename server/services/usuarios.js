import { consultar, consultarUm, executar, semChavesEstrangeiras } from '../db.js';
import { registrarExclusao } from './auditoria.js';
import { agoraISO } from '../utils.js';
import { gerarHashSenha, validarForcaSenha } from '../auth.js';
import { conflito, naoEncontrado, invalido } from '../erros.js';

const PAPEIS = ['atendente', 'tecnico', 'admin'];

const CAMPOS_PUBLICOS =
  'u.id, u.nome, u.email, u.papel, u.loja_id, u.telefone, u.ativo, u.criado_em, l.nome AS loja_nome, l.codigo AS loja_codigo';

export async function listarUsuarios({ lojaId = null, papel = null, apenasAtivos = false } = {}) {
  const where = [];
  const params = [];
  if (lojaId) {
    where.push('u.loja_id = ?');
    params.push(Number(lojaId));
  }
  if (papel) {
    if (!PAPEIS.includes(papel)) throw invalido(`Papel inválido: ${papel}`);
    where.push('u.papel = ?');
    params.push(papel);
  }
  if (apenasAtivos) where.push('u.ativo = 1');
  return consultar(
    `SELECT ${CAMPOS_PUBLICOS}
       FROM usuarios u
       LEFT JOIN lojas l ON l.id = u.loja_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY u.ativo DESC, u.nome COLLATE NOCASE`,
    ...params,
  );
}

export async function buscarUsuario(id) {
  const usuario = await consultarUm(
    `SELECT ${CAMPOS_PUBLICOS} FROM usuarios u LEFT JOIN lojas l ON l.id = u.loja_id WHERE u.id = ?`,
    id,
  );
  if (!usuario) throw naoEncontrado('Usuário não encontrado.');
  return usuario;
}

export async function criarUsuario({ nome, email, senha, papel, lojaId, telefone }) {
  if (!PAPEIS.includes(papel)) throw invalido(`Papel inválido. Opções: ${PAPEIS.join(', ')}.`, { campo: 'papel' });
  if (papel === 'atendente' && !lojaId) {
    throw invalido('O atendente precisa estar vinculado a uma loja.', { campo: 'lojaId' });
  }
  if (lojaId && !(await consultarUm('SELECT id FROM lojas WHERE id = ?', lojaId))) {
    throw invalido('A loja informada não existe.', { campo: 'lojaId' });
  }
  if (await consultarUm('SELECT id FROM usuarios WHERE email = ? COLLATE NOCASE', email)) {
    throw conflito(`Já existe um usuário cadastrado com o login ${email}.`);
  }
  validarForcaSenha(senha);
  const info = await executar(
    `INSERT INTO usuarios (nome, email, senha_hash, papel, loja_id, telefone, ativo, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    nome,
    email.toLowerCase(),
    gerarHashSenha(senha),
    papel,
    lojaId ?? null,
    telefone ?? null,
    agoraISO(),
  );
  return buscarUsuario(Number(info.lastInsertRowid));
}

export async function atualizarUsuario(id, { nome, email, papel, lojaId, telefone, ativo }) {
  const atual = await consultarUm('SELECT * FROM usuarios WHERE id = ?', id);
  if (!atual) throw naoEncontrado('Usuário não encontrado.');

  const papelFinal = papel ?? atual.papel;
  if (!PAPEIS.includes(papelFinal)) throw invalido(`Papel inválido. Opções: ${PAPEIS.join(', ')}.`, { campo: 'papel' });
  const lojaFinal = papelFinal === 'atendente' ? lojaId ?? atual.loja_id : lojaId ?? null;
  if (papelFinal === 'atendente' && !lojaFinal) {
    throw invalido('O atendente precisa estar vinculado a uma loja.', { campo: 'lojaId' });
  }
  if (email && email.toLowerCase() !== atual.email) {
    if (await consultarUm('SELECT id FROM usuarios WHERE email = ? COLLATE NOCASE AND id <> ?', email, id)) {
      throw conflito(`Já existe outro usuário com o login ${email}.`);
    }
  }
  if (ativo === false || ativo === 0) {
    if (atual.papel === 'admin') {
      const total = await consultarUm(`SELECT COUNT(*) AS total FROM usuarios WHERE papel = 'admin' AND ativo = 1`);
      if (Number(total.total) <= 1) throw invalido('Não é possível desativar o último administrador ativo do sistema.');
    }
    const abertas = await consultarUm(
      `SELECT COUNT(*) AS total FROM ordens_servico
        WHERE tecnico_id = ? AND status IN ('em_manutencao', 'aguardando_peca')`,
      id,
    );
    if (Number(abertas.total) > 0) {
      throw invalido(
        `Este técnico ainda é responsável por ${abertas.total} OS em andamento. Transfira ou finalize antes de desativá-lo.`,
      );
    }
  }

  await executar(
    `UPDATE usuarios SET nome = ?, email = ?, papel = ?, loja_id = ?, telefone = ?, ativo = ?
      WHERE id = ?`,
    nome ?? atual.nome,
    (email ?? atual.email).toLowerCase(),
    papelFinal,
    lojaFinal,
    telefone === undefined ? atual.telefone : telefone,
    ativo === undefined || ativo === null ? atual.ativo : ativo ? 1 : 0,
    id,
  );
  return buscarUsuario(id);
}

export async function alterarSenha(id, novaSenha) {
  const usuario = await consultarUm('SELECT id FROM usuarios WHERE id = ?', id);
  if (!usuario) throw naoEncontrado('Usuário não encontrado.');
  validarForcaSenha(novaSenha);
  await executar('UPDATE usuarios SET senha_hash = ? WHERE id = ?', gerarHashSenha(novaSenha), id);
  await executar('DELETE FROM sessoes WHERE usuario_id = ?', id);
  return true;
}

/**
 * Exclusão definitiva. Não há bloqueio por histórico: o usuário pode ser
 * removido mesmo tendo OS/eventos/fotos. Os registros antigos permanecem, com
 * o autor exibido como removido. Mantém-se apenas a proteção contra apagar o
 * último administrador (evita perder o acesso ao sistema).
 */
export async function excluirUsuario(id, usuario = null) {
  const alvo = await consultarUm('SELECT * FROM usuarios WHERE id = ?', id);
  if (!alvo) throw naoEncontrado('Usuário não encontrado.');

  if (alvo.papel === 'admin') {
    const admins = await consultarUm(`SELECT COUNT(*) AS total FROM usuarios WHERE papel = 'admin'`);
    if (Number(admins.total) <= 1) {
      throw invalido('Não é possível excluir o último administrador do sistema. Crie outro admin antes.');
    }
  }

  await registrarExclusao({
    tipo: 'usuario',
    referencia: alvo.nome,
    detalhes: `${alvo.email} · ${alvo.papel}`,
    usuario,
  });

  await semChavesEstrangeiras(async () => {
    await executar('DELETE FROM sessoes WHERE usuario_id = ?', id);
    await executar('DELETE FROM usuarios WHERE id = ?', id);
  });
  return alvo;
}

export async function listarTecnicos(lojaId = null) {
  return consultar(
    `SELECT u.id, u.nome, u.email, u.loja_id, l.nome AS loja_nome,
            (SELECT COUNT(*) FROM ordens_servico o WHERE o.tecnico_id = u.id AND o.status = 'em_manutencao') AS os_andamento,
            (SELECT COUNT(*) FROM ordens_servico o WHERE o.tecnico_id = u.id AND o.status = 'pronto') AS os_prontas
       FROM usuarios u
       LEFT JOIN lojas l ON l.id = u.loja_id
      WHERE u.papel = 'tecnico' AND u.ativo = 1 ${lojaId ? 'AND u.loja_id = ?' : ''}
      ORDER BY u.nome COLLATE NOCASE`,
    ...(lojaId ? [Number(lojaId)] : []),
  );
}

/**
 * Cria o primeiro administrador quando o banco está vazio — sem isso, um
 * deploy novo ficaria sem nenhuma forma de entrar no sistema.
 */
export async function garantirAdminInicial({ nome, email, senha, telefone = null }) {
  const existentes = await consultarUm(`SELECT COUNT(*) AS total FROM usuarios`);
  if (Number(existentes.total) > 0) return null;
  const usuario = await criarUsuario({ nome, email, senha, papel: 'admin', lojaId: null, telefone });
  return usuario;
}
