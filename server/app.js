import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { config } from './config.js';
import { prepararBanco, driverAtual } from './db.js';
import { montarApi } from './api/index.js';
import { lerCookies, enviarJson, enviarErro, lerQuery, lerCorpoJson } from './utils.js';import { usuarioDaRequisicao, limparSessoesExpiradas } from './auth.js';
import { garantirAdminInicial } from './services/usuarios.js';
import { limitar } from './rate-limit.js';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const CABECALHOS_SEGURANCA = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; '),
};

const rota = montarApi();

let preparacao = null;

/**
 * Prepara banco (schema) e administrador inicial uma única vez por processo.
 * Em ambiente serverless isso roda no primeiro request de cada instância.
 */
export function prepararAplicacao() {
  if (!preparacao) {
    preparacao = (async () => {
      const { primeirAcesso } = await prepararBanco();

      if (primeirAcesso) {
        const email = process.env.ADMIN_EMAIL || 'universeti';
        const senha = process.env.ADMIN_SENHA || 'galaxy2026!';
        await garantirAdminInicial({
          nome: process.env.ADMIN_NOME || 'UniverseTI',
          email,
          senha,
          telefone: process.env.ADMIN_TELEFONE || null,
        });
        console.warn(
          `\n[banco vazio] Administrador inicial criado: ${email}\n` +
            (process.env.ADMIN_SENHA
              ? ''
              : '  >>> SENHA PADRÃO "galaxy2026!" — troque no primeiro acesso (menu Minha conta).\n'),
        );
      }

      await limparSessoesExpiradas();
      return { driver: driverAtual() };
    })().catch((erro) => {
      preparacao = null;
      throw erro;
    });
  }
  return preparacao;
}

function aplicarSeguranca(res) {
  for (const [chave, valor] of Object.entries(CABECALHOS_SEGURANCA)) {
    res.setHeader(chave, valor);
  }
}

/**
 * Proteção CSRF: em métodos que alteram estado, exige que a origem (Origin ou
 * Referer) bata com o host. Navegadores enviam Origin em requisições
 * cross-site; sem os cabeçalhos (curl, apps nativos) a checagem é ignorada.
 */
function mesmaOrigem(req) {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const alvo = req.headers.origin ?? req.headers.referer;
  if (!alvo || !host) return true;
  try {
    return new URL(alvo).host === host;
  } catch {
    return false;
  }
}

export function servirArquivoEstatico(req, res, urlPath) {
  const relativo = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.replace(/^\/+/, ''));
  const destino = path.resolve(config.publicDir, relativo);
  if (!destino.startsWith(config.publicDir)) {
    res.writeHead(403).end('Acesso negado');
    return true;
  }
  if (!fs.existsSync(destino) || fs.statSync(destino).isDirectory()) return false;

  const ext = path.extname(destino).toLowerCase();
  let conteudo = fs.readFileSync(destino);
  const imutavel = /\/vendor\/|\/img\/|\.woff2?$/.test(urlPath);
  const compressivel = ['.html', '.js', '.mjs', '.css', '.json', '.svg', '.webmanifest', '.txt'].includes(ext);
  const cabecalhos = {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': imutavel ? 'public, max-age=31536000, immutable' : 'no-cache',
    Vary: 'Accept-Encoding',
  };
  if (compressivel && conteudo.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    conteudo = zlib.gzipSync(conteudo, { level: 6 });
    cabecalhos['Content-Encoding'] = 'gzip';
  }
  cabecalhos['Content-Length'] = conteudo.length;
  cabecalhos.ETag = `W"${conteudo.length.toString(16)}-${ext}"`;
  res.writeHead(200, cabecalhos);
  res.end(conteudo);
  return true;
}

function responderIndexSPA(res) {
  const index = path.join(config.publicDir, 'index.html');
  if (!fs.existsSync(index)) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Front-end não encontrado. Verifique a pasta public/.');
    return;
  }
  const conteudo = fs.readFileSync(index);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(conteudo);
}

/**
 * Reconstrói a URL efetiva da requisição.
 *
 * Na Vercel todo /api/* é reescrito para /api/index com o caminho original no
 * parâmetro `__rota` (o builder estático da Vercel só registra um segmento por
 * função). Localmente a URL já chega correta. Os demais parâmetros da query
 * seguem intactos para os filtros das telas.
 */
function interpretarUrl(req) {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const caminhoOriginal = url.searchParams.get('__rota');
  if (caminhoOriginal !== null) {
    url.searchParams.delete('__rota');
    const limpo = String(caminhoOriginal).replace(/^\/+|\/+$/g, '');
    url.pathname = limpo ? `/api/${limpo}` : '/api';
  }
  return url;
}

function mensagemDiagnostico(erro) {
  const bruto = String(erro?.message ?? erro ?? 'erro desconhecido');
  return bruto
    .replace(/[A-Za-z0-9_-]{40,}/g, '<omitido>')
    .replace(/([?&](authToken|token|senha|password)=)[^&\s]+/gi, '$1<omitido>')
    .replace(/(libsql:\/\/)[^@\s]+@/gi, '$1<omitido>@')
    .slice(0, 300);
}

/**
 * Handler principal, compartilhado pelo servidor local (server/index.js) e pela
 * função serverless da Vercel (api/index.js).
 *
 * @param {object} opcoes
 * @param {boolean} opcoes.servirEstaticos  no local o próprio Node entrega os
 *   arquivos de public/; na Vercel isso é feito pela CDN.
 */
export async function tratarRequisicao(req, res, { servirEstaticos = true } = {}) {
  const url = interpretarUrl(req);
  const caminho = url.pathname;

  aplicarSeguranca(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !mesmaOrigem(req)) {
    enviarJson(res, 403, {
      ok: false,
      erro: { codigo: 'origem_invalida', mensagem: 'Requisição bloqueada pela proteção contra CSRF.' },
    });
    return;
  }

  if (servirEstaticos && !caminho.startsWith('/api/')) {
    if (servirArquivoEstatico(req, res, caminho)) return;
    if (req.method === 'GET' || req.method === 'HEAD') {
      responderIndexSPA(res);
      return;
    }
  }

  try {
    await prepararAplicacao();
  } catch (erro) {
    console.error('[bootstrap] falha ao preparar o banco:', erro);
    enviarJson(res, 503, {
      ok: false,
      erro: {
        codigo: 'banco_indisponivel',
        mensagem:
          'O sistema não conseguiu conectar ao banco de dados. ' +
          'Verifique se as credenciais do Turso (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN) estão configuradas.',
        // A mensagem passa por sanitização (tokens e credenciais são removidos)
        // para que uma falha de configuração seja diagnosticável em produção.
        detalhes: mensagemDiagnostico(erro),
      },
    });
    return;
  }

  req.cookies = lerCookies(req);

  // Limite geral da API por IP (as rotas públicas têm limite mais rígido).
  if (caminho.startsWith('/api/')) {
    limitar(req, 'api', { max: 600, janelaMs: 60_000 });
  }

  const usuario = await usuarioDaRequisicao(req);

  const encontrada = rota.encontrar(req.method, caminho);
  if (!encontrada) {
    if (caminho.startsWith('/api/')) {
      enviarJson(res, 404, {
        ok: false,
        erro: { codigo: 'rota_nao_encontrada', mensagem: `Rota não encontrada: ${caminho}` },
      });
      return;
    }
    responderIndexSPA(res);
    return;
  }
  if (encontrada.metodoNaoPermitido) {
    enviarJson(res, 405, {
      ok: false,
      erro: { codigo: 'metodo_nao_permitido', mensagem: `${req.method} não é suportado em ${caminho}.` },
    });
    return;
  }

  const ctx = {
    req,
    res,
    url,
    query: lerQuery(url),
    params: encontrada.params,
    usuario,
    corpo: {},
    status: 200,
    arquivo: null,
  };

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const tipo = String(req.headers['content-type'] ?? '');
    if (tipo.includes('application/json')) {
      ctx.corpo = await lerCorpoJson(req);
    }
  }

  const dados = await encontrada.handler(ctx);

  if (ctx.arquivo) {
    res.writeHead(200, {
      'Content-Type': ctx.arquivo.mime,
      'Content-Length': ctx.arquivo.conteudo.length,
      'Cache-Control': 'private, max-age=86400',
    });
    res.end(ctx.arquivo.conteudo);
    return;
  }

  if (dados && dados.__csv) {
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${dados.nomeArquivo}"`,
      'Cache-Control': 'no-store',
    });
    res.end(dados.conteudo);
    return;
  }

  if (dados === null || dados === undefined) {
    res.writeHead(204).end();
    return;
  }

  enviarJson(res, ctx.status, { ok: true, ...dados });
}

/**
 * Versão segura para ser ligada direto ao servidor HTTP: captura qualquer erro
 * (de domínio ou inesperado) e devolve a resposta JSON padronizada.
 */
export function criarHandler(opcoes = {}) {
  return (req, res) => {
    tratarRequisicao(req, res, opcoes).catch((erro) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      enviarErro(res, erro);
    });
  };
}
