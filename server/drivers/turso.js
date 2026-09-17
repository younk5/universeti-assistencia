import { config } from '../config.js';

/**
 * Driver Turso (libSQL hospedado) — usado na Vercel, onde não existe disco.
 *
 * O pacote @libsql/client é carregado dinamicamente: quem roda localmente com
 * node:sqlite não precisa instalá-lo.
 */

export const nome = 'turso';

export let url = null;
export let authToken = null;

let cliente = null;

export function configurado() {
  return Boolean(process.env.LIBSQL_URL || process.env.TURSO_DATABASE_URL);
}

export function descrever() {
  if (!url) return 'Turso (não configurado)';
  return `Turso (${url.replace(/\/\/.*@/, '//')})`;
}

export async function abrir() {
  if (cliente) return;

  url = process.env.LIBSQL_URL || process.env.TURSO_DATABASE_URL;
  authToken = process.env.LIBSQL_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;

  if (!url) throw new Error('LIBSQL_URL não configurada.');
  if (!authToken) throw new Error('LIBSQL_AUTH_TOKEN não configurado.');

  let criarCliente;
  try {
    ({ createClient: criarCliente } = await import('@libsql/client'));
  } catch {
    throw new Error(
      'O driver Turso exige o pacote @libsql/client. Rode "npm install" ou use o driver local (DATA_DIR com node:sqlite).',
    );
  }

  cliente = criarCliente({ url, authToken });
}

/** Sanitiza parâmetros: o libSQL não aceita undefined e converte booleanos. */
function limpar(params) {
  return params.map((valor) => {
    if (valor === undefined) return null;
    if (typeof valor === 'boolean') return valor ? 1 : 0;
    if (valor instanceof Date) return valor.toISOString();
    return valor;
  });
}

function normalizar(linha) {
  if (!linha) return linha;
  const saida = {};
  for (const [chave, valor] of Object.entries(linha)) {
    saida[chave] = typeof valor === 'bigint' ? Number(valor) : valor;
  }
  return saida;
}

function lerResultado(resultado) {
  const linhas = (resultado.rows ?? []).map(normalizar);
  return {
    linhas,
    changes: Number(resultado.rowsAffected ?? 0),
    lastInsertRowid: Number(resultado.lastInsertRowid ?? 0),
  };
}

const envolverTransacao = (tx) => ({
  async all(sql, params = []) {
    return lerResultado(await tx.execute({ sql, args: limpar(params) })).linhas;
  },
  async get(sql, params = []) {
    const { linhas } = lerResultado(await tx.execute({ sql, args: limpar(params) }));
    return linhas[0] ?? null;
  },
  async run(sql, params = []) {
    const { changes, lastInsertRowid } = lerResultado(await tx.execute({ sql, args: limpar(params) }));
    return { changes, lastInsertRowid };
  },
});

export async function executarScript(sql) {
  // O Turso não aceita PRAGMA de journal_mode/busy_timeout.
  const semPragma = sql.replace(/^\s*PRAGMA[^;]*;/gim, '');
  await cliente.executeMultiple(semPragma);
}

export async function executar(sql, params = []) {
  const { changes, lastInsertRowid } = lerResultado(await cliente.execute({ sql, args: limpar(params) }));
  return { changes, lastInsertRowid };
}

export async function consultar(sql, params = []) {
  return lerResultado(await cliente.execute({ sql, args: limpar(params) })).linhas;
}

export async function consultarUm(sql, params = []) {
  const { linhas } = lerResultado(await cliente.execute({ sql, args: limpar(params) }));
  return linhas[0] ?? null;
}

export async function transacao(fn) {
  const tx = await cliente.transaction('write');
  try {
    const resultado = await fn(envolverTransacao(tx));
    await tx.commit();
    return resultado;
  } catch (erro) {
    try {
      await tx.rollback();
    } catch {
      /* transação já encerrada */
    }
    throw erro;
  }
}

/**
 * Executa um lote de escritas de forma atômica. Usado no seed, onde há centenas
 * de INSERTs e uma transação interativa por HTTP seria lenta demais.
 */
export async function lote(comandos) {
  if (!comandos.length) return [];
  const resultados = await cliente.batch(
    comandos.map(({ sql, params = [] }) => ({ sql, args: limpar(params) })),
    'write',
  );
  return resultados.map((r) => lerResultado(r));
}

export async function fechar() {
  if (cliente) {
    cliente.close();
    cliente = null;
  }
}

export function caminhoFisico() {
  return null;
}
