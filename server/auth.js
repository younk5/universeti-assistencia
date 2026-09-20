import crypto from 'node:crypto';
import { config } from './config.js';
import { executar, consultarUm } from './db.js';
import { gerarToken, agoraISO } from './utils.js';
import { naoAutenticado, semPermissao, invalido } from './erros.js';

export const NOME_COOKIE = 'tecnoflow_sessao';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* -------------------------------------------------------------------------- */
/* Senhas — scrypt com salt aleatório, formato auto-descritivo                 */
/* -------------------------------------------------------------------------- */

export function gerarHashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const derivada = crypto.scryptSync(senha, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    derivada.toString('base64'),
  ].join('$');
}

export function conferirSenha(senha, hashArmazenado) {
  try {
    const partes = String(hashArmazenado).split('$');
    if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
    const [, n, r, p, saltB64, hashB64] = partes;
    const salt = Buffer.from(saltB64, 'base64');
    const esperado = Buffer.from(hashB64, 'base64');
    const derivada = crypto.scryptSync(senha, salt, esperado.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(derivada, esperado);
  } catch {
    return false;
  }
}

export function validarForcaSenha(senha) {
  const texto = String(senha ?? '');
  if (texto.length < 6) throw invalido('A senha deve ter ao menos 6 caracteres.', { campo: 'senha' });
  if (texto.length > 128) throw invalido('A senha deve ter no máximo 128 caracteres.', { campo: 'senha' });
  if (!/[A-Za-z]/.test(texto) || !/[0-9]/.test(texto)) {
    throw invalido('A senha deve conter letras e números.', { campo: 'senha' });
  }
  return texto;
}

/* -------------------------------------------------------------------------- */
/* Sessões — token opaco assinado com HMAC, guardado no banco                  */
/* -------------------------------------------------------------------------- */

function assinar(token) {
  return crypto.createHmac('sha256', config.sessionSecret).update(token).digest('base64url');
}

function serializarToken(token) {
  return `${token}.${assinar(token)}`;
}

function desserializarToken(valor) {
  if (typeof valor !== 'string') return null;
  const idx = valor.lastIndexOf('.');
  if (idx === -1) return null;
  const token = valor.slice(0, idx);
  const assinatura = valor.slice(idx + 1);
  const esperada = assinar(token);
  if (assinatura.length !== esperada.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperada))) return null;
  return token;
}

export async function criarSessao(usuarioId, userAgent = '') {
  const token = gerarToken(32);
  const agora = new Date();
  const expira = new Date(agora.getTime() + config.sessionTtlDias * 24 * 60 * 60 * 1000);
  await executar(
    'INSERT INTO sessoes (token, usuario_id, criado_em, expira_em, user_agent) VALUES (?, ?, ?, ?, ?)',
    token,
    usuarioId,
    agora.toISOString(),
    expira.toISOString(),
    String(userAgent).slice(0, 300),
  );
  return { valor: serializarToken(token), expiraEm: expira.toISOString() };
}

export async function encerrarSessao(valorCookie) {
  const token = desserializarToken(valorCookie);
  if (!token) return;
  await executar('DELETE FROM sessoes WHERE token = ?', token);
}

export async function limparSessoesExpiradas() {
  await executar('DELETE FROM sessoes WHERE expira_em < ?', agoraISO());
}

const SQL_USUARIO_SESSAO = `
  SELECT u.id, u.nome, u.email, u.papel, u.loja_id, u.ativo,
         l.nome AS loja_nome, l.codigo AS loja_codigo,
         s.expira_em
    FROM sessoes s
    JOIN usuarios u ON u.id = s.usuario_id
    LEFT JOIN lojas l ON l.id = u.loja_id
   WHERE s.token = ?`;

export async function usuarioDaRequisicao(req) {
  const cookies = req.cookies ?? {};
  const token = desserializarToken(cookies[NOME_COOKIE]);
  if (!token) return null;
  const dados = await consultarUm(SQL_USUARIO_SESSAO, token);
  if (!dados) return null;
  if (new Date(dados.expira_em).getTime() < Date.now()) {
    await executar('DELETE FROM sessoes WHERE token = ?', token);
    return null;
  }
  if (!dados.ativo) return null;
  return {
    id: dados.id,
    nome: dados.nome,
    email: dados.email,
    papel: dados.papel,
    lojaId: dados.loja_id,
    lojaNome: dados.loja_nome,
    lojaCodigo: dados.loja_codigo,
  };
}

/* -------------------------------------------------------------------------- */
/* Autorização                                                                 */
/* -------------------------------------------------------------------------- */

export const PERMISSOES = {
  admin: [
    'os.criar', 'os.ver', 'os.ver_todas', 'os.assumir', 'os.finalizar',
    'os.retirar', 'os.comentar', 'os.reabrir', 'admin.lojas', 'admin.usuarios', 'relatorios',
  ],
  atendente: ['os.criar', 'os.ver', 'os.retirar', 'os.comentar', 'relatorios'],
  tecnico: ['os.ver', 'os.assumir', 'os.finalizar', 'os.comentar', 'relatorios'],
};

export function pode(usuario, permissao) {
  if (!usuario) return false;
  return (PERMISSOES[usuario.papel] ?? []).includes(permissao);
}

/**
 * Escopo de visão: administrador e técnico enxergam a rede inteira;
 * o atendente fica restrito à própria loja.
 */
export function escopoRede(usuario) {
  return Boolean(usuario) && (usuario.papel === 'admin' || usuario.papel === 'tecnico');
}

export function exigirPermissao(usuario, permissao) {
  if (!usuario) throw naoAutenticado();
  if (!pode(usuario, permissao)) {
    throw semPermissao(`A ação "${permissao}" não está disponível para o perfil ${usuario.papel}.`);
  }
}

export function exigirAutenticacao(usuario) {
  if (!usuario) throw naoAutenticado();
  return usuario;
}
