import crypto from 'node:crypto';
import { ErroApp, invalido } from './erros.js';

export const agoraISO = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* Respostas HTTP                                                              */
/* -------------------------------------------------------------------------- */

export function enviarJson(res, status, payload) {
  const corpo = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(corpo),
    'Cache-Control': 'no-store',
  });
  res.end(corpo);
}

export function enviarErro(res, erro) {
  const esperado = erro instanceof ErroApp;
  if (!esperado) {
    console.error('[erro-nao-tratado]', erro);
  }
  const status = esperado ? erro.status : 500;
  enviarJson(res, status, {
    ok: false,
    erro: {
      codigo: esperado ? erro.codigo : 'erro_interno',
      mensagem: esperado ? erro.message : 'Ocorreu um erro inesperado no servidor. Tente novamente.',
      detalhes: esperado ? erro.detalhes : null,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Cookies                                                                     */
/* -------------------------------------------------------------------------- */

export function lerCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  for (const parte of header.split(';')) {
    const idx = parte.indexOf('=');
    if (idx === -1) continue;
    cookies[parte.slice(0, idx).trim()] = decodeURIComponent(parte.slice(idx + 1).trim());
  }
  return cookies;
}

export function definirCookie(res, nome, valor, { maxAgeSegundos, httpOnly = true, sameSite = 'Lax', secure = false, path = '/' } = {}) {
  const partes = [`${nome}=${encodeURIComponent(valor)}`, `Path=${path}`];
  if (httpOnly) partes.push('HttpOnly');
  partes.push(`SameSite=${sameSite}`);
  if (secure) partes.push('Secure');
  if (maxAgeSegundos !== undefined) partes.push(`Max-Age=${Math.floor(maxAgeSegundos)}`);
  const atual = res.getHeader('Set-Cookie');
  const lista = atual ? (Array.isArray(atual) ? atual : [atual]) : [];
  lista.push(partes.join('; '));
  res.setHeader('Set-Cookie', lista);
}

export function limparCookie(res, nome) {
  definirCookie(res, nome, '', { maxAgeSegundos: 0 });
}

/* -------------------------------------------------------------------------- */
/* Leitura de corpo                                                            */
/* -------------------------------------------------------------------------- */

export async function lerCorpoJson(req, { limite = 1_000_000 } = {}) {
  const buffer = await lerCorpoBinario(req, limite);
  if (buffer.length === 0) return {};
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw invalido('O corpo da requisição não é um JSON válido.');
  }
}

export async function lerCorpoBinario(req, limite = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    let estourou = false;

    req.on('data', (chunk) => {
      if (estourou) return;
      total += chunk.length;
      if (total > limite) {
        estourou = true;
        reject(new ErroApp('Arquivo excede o tamanho máximo permitido.', { status: 413, codigo: 'arquivo_muito_grande' }));
        req.destroy();
        return;
      }
      partes.push(chunk);
    });
    req.on('end', () => {
      if (!estourou) resolve(Buffer.concat(partes));
    });
    req.on('error', (erro) => {
      if (!estourou) reject(erro);
    });
  });
}

export function lerQuery(url) {
  return Object.fromEntries(url.searchParams.entries());
}

/* -------------------------------------------------------------------------- */
/* Validação                                                                   */
/* -------------------------------------------------------------------------- */

export function exigirTexto(valor, campo, { min = 1, max = 500, opcional = false } = {}) {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (!texto) {
    if (opcional) return null;
    throw invalido(`O campo "${campo}" é obrigatório.`, { campo });
  }
  if (texto.length < min) throw invalido(`O campo "${campo}" deve ter ao menos ${min} caracteres.`, { campo });
  if (texto.length > max) throw invalido(`O campo "${campo}" deve ter no máximo ${max} caracteres.`, { campo });
  return texto;
}

/**
 * Identificador de acesso: aceita usuário simples ("UniverseTI") ou e-mail.
 * É o valor usado no login — não exige formato de e-mail para permitir
 * logins curtos e memoráveis.
 */
export function exigirLogin(valor) {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (!texto) throw invalido('Informe o usuário para entrar.', { campo: 'login' });
  if (texto.length > 200) throw invalido('O usuário deve ter no máximo 200 caracteres.', { campo: 'login' });
  if (/\s/.test(texto)) throw invalido('O usuário não pode conter espaços.', { campo: 'login' });
  return texto;
}

const RE_TELEFONE = /^\+?[0-9\s()-]{8,20}$/;

export function exigirTelefone(valor, campo = 'telefone', { opcional = false } = {}) {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (!texto) {
    if (opcional) return null;
    throw invalido(`O campo "${campo}" é obrigatório.`, { campo });
  }
  if (!RE_TELEFONE.test(texto)) {
    throw invalido('Telefone inválido. Use DDD + número, ex: (11) 91234-5678.', { campo });
  }
  const digitos = texto.replace(/\D/g, '');
  if (digitos.length < 10 || digitos.length > 13) {
    throw invalido('Telefone deve ter entre 10 e 13 dígitos (com DDD).', { campo });
  }
  return texto;
}

export function exigirEnum(valor, campo, permitidos, { opcional = false } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (opcional) return null;
    throw invalido(`O campo "${campo}" é obrigatório.`, { campo });
  }
  if (!permitidos.includes(valor)) {
    throw invalido(`Valor inválido para "${campo}". Opções: ${permitidos.join(', ')}.`, { campo });
  }
  return valor;
}

export function exigirNumero(valor, campo, { min = 0, max = 1_000_000, opcional = true } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (opcional) return null;
    throw invalido(`O campo "${campo}" é obrigatório.`, { campo });
  }
  const numero = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
  if (!Number.isFinite(numero)) throw invalido(`O campo "${campo}" deve ser um número.`, { campo });
  if (numero < min || numero > max) throw invalido(`O campo "${campo}" deve estar entre ${min} e ${max}.`, { campo });
  return numero;
}

/* -------------------------------------------------------------------------- */
/* Diversos                                                                    */
/* -------------------------------------------------------------------------- */

export const slugCodigo = (texto) =>
  String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 6) || 'LOJA';

export function normalizarDigitos(texto) {
  return String(texto ?? '').replace(/\D/g, '');
}

export function telefoneParaWhatsapp(telefone) {
  const digitos = normalizarDigitos(telefone);
  if (!digitos) return null;
  return digitos.length <= 11 ? `55${digitos}` : digitos;
}

export function gerarToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
