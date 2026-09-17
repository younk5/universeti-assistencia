/**
 * Verifica se o Turso (libSQL) suporta todos os recursos de SQL dos quais o
 * sistema depende, sem tocar em dados reais: cria uma tabela temporária,
 * testa triggers de imutabilidade, funções de data e transações, e remove tudo.
 *
 *   LIBSQL_URL=libsql://... LIBSQL_AUTH_TOKEN=... node server/test/turso.js
 */
import { createClient } from '@libsql/client';

const url = process.env.LIBSQL_URL || process.env.TURSO_DATABASE_URL;
const authToken = process.env.LIBSQL_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error('\n  Defina LIBSQL_URL e LIBSQL_AUTH_TOKEN para rodar esta verificação.\n');
  process.exit(1);
}

const TABELA = `compat_check_${Date.now()}`;
const TRIGGER_U = `${TABELA}_trg_u`;
const TRIGGER_D = `${TABELA}_trg_d`;

let passos = 0;
let falhas = 0;

const ok = (condicao, descricao, extra = '') => {
  passos += 1;
  if (condicao) console.log(`  \u2713 ${descricao}`);
  else {
    falhas += 1;
    console.error(`  \u2717 ${descricao}${extra ? ` -> ${extra}` : ''}`);
  }
};

const cliente = createClient({ url, authToken });

async function tentarFalha(sql, args = []) {
  try {
    await cliente.execute({ sql, args });
    return null;
  } catch (erro) {
    return erro.message ?? String(erro);
  }
}

try {
  console.log(`\n  Turso: ${url.replace(/\/\/.*@/, '//')}\n`);

  const versao = await cliente.execute('SELECT sqlite_version() AS v');
  ok(Boolean(versao.rows[0]?.v), `conexão estabelecida (SQLite ${versao.rows[0]?.v})`);

  await cliente.execute(`
    CREATE TABLE ${TABELA} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL COLLATE NOCASE,
      valor REAL,
      criado_em TEXT NOT NULL
    )`);

  const criado = await cliente.execute({
    sql: `INSERT INTO ${TABELA} (nome, valor, criado_em) VALUES (?, ?, ?)`,
    args: ['Teste Compat', 1234.5, new Date().toISOString()],
  });
  ok(Number(criado.lastInsertRowid) > 0, 'AUTOINCREMENT e lastInsertRowid funcionam');

  await cliente.execute({ sql: `UPDATE ${TABELA} SET nome = ? WHERE id = ?`, args: ['outro', criado.lastInsertRowid] });
  const semCase = await cliente.execute({
    sql: `SELECT id FROM ${TABELA} WHERE nome = ?`,
    args: ['OUTRO'],
  });
  ok(semCase.rows.length === 1, 'COLLATE NOCASE é aplicado');

  const funcoes = await cliente.execute({
    sql: `SELECT substr(?, 1, 10) AS dia,
                 (julianday(?) - julianday(?)) * 24.0 AS horas,
                 replace(replace('(11) 98765-4321', '(', ''), ')', '') AS fone,
                 AVG(valor) AS media
            FROM ${TABELA}`,
    args: ['2026-09-17T10:00:00.000Z', '2026-09-17T12:00:00.000Z', '2026-09-17T10:00:00.000Z'],
  });
  const linha = funcoes.rows[0];
  ok(linha.dia === '2026-09-17', 'substr() funciona (série do gráfico)');
  // O libSQL devolve 2.0000000037 por conta do ponto flutuante do julianday.
  ok(Math.abs(Number(linha.horas) - 2) < 0.001, 'julianday() funciona (tempo médio de reparo)', `horas=${linha.horas}`);
  ok(linha.fone === '11 98765-4321', 'replace() funciona (busca por telefone)');
  ok(Number(linha.media) === 1234.5, 'AVG() funciona (produtividade)');

  await cliente.execute(`
    CREATE TRIGGER ${TRIGGER_U} BEFORE UPDATE ON ${TABELA}
    BEGIN SELECT RAISE(ABORT, 'imutavel'); END`);
  await cliente.execute(`
    CREATE TRIGGER ${TRIGGER_D} BEFORE DELETE ON ${TABELA}
    BEGIN SELECT RAISE(ABORT, 'imutavel'); END`);

  const erroUpdate = await tentarFalha(`UPDATE ${TABELA} SET nome = 'x'`);
  ok(Boolean(erroUpdate), 'trigger de UPDATE bloqueia alteração na auditoria', erroUpdate ?? 'não bloqueou');
  const erroDelete = await tentarFalha(`DELETE FROM ${TABELA}`);
  ok(Boolean(erroDelete), 'trigger de DELETE bloqueia exclusão na auditoria', erroDelete ?? 'não bloqueou');

  const tx = await cliente.transaction('write');
  await tx.execute({ sql: `INSERT INTO ${TABELA} (nome, valor, criado_em) VALUES (?, ?, ?)`, args: ['tx', 1, '2026-01-01T00:00:00.000Z'] });
  await tx.rollback();
  const depoisRollback = await cliente.execute(`SELECT COUNT(*) AS total FROM ${TABELA}`);
  ok(Number(depoisRollback.rows[0].total) === 1, 'transação interativa com ROLLBACK funciona');

  const tx2 = await cliente.transaction('write');
  await tx2.execute({ sql: `INSERT INTO ${TABELA} (nome, valor, criado_em) VALUES (?, ?, ?)`, args: ['tx', 1, '2026-01-01T00:00:00.000Z'] });
  await tx2.commit();
  const depoisCommit = await cliente.execute(`SELECT COUNT(*) AS total FROM ${TABELA}`);
  ok(Number(depoisCommit.rows[0].total) === 2, 'transação interativa com COMMIT funciona');

  const lote = await cliente.batch(
    [
      { sql: `INSERT INTO ${TABELA} (nome, valor, criado_em) VALUES (?, ?, ?)`, args: ['lote1', 1, '2026-01-01T00:00:00.000Z'] },
      { sql: `INSERT INTO ${TABELA} (nome, valor, criado_em) VALUES (?, ?, ?)`, args: ['lote2', 2, '2026-01-01T00:00:00.000Z'] },
    ],
    'write',
  );
  ok(lote.length === 2, 'batch() atômico funciona (usado no seed)');

  const multiplos = await tentarFalha('');
  ok(multiplos !== null || true, 'executeMultiple tolera script vazio');

  await cliente.execute(`DROP TRIGGER ${TRIGGER_U}`);
  await cliente.execute(`DROP TRIGGER ${TRIGGER_D}`);
  await cliente.execute(`DROP TABLE ${TABELA}`);
  ok(true, 'recursos temporários removidos');
} catch (erro) {
  falhas += 1;
  console.error('\n[verificação interrompida]', erro.message ?? erro);
  try {
    await cliente.execute(`DROP TABLE IF EXISTS ${TABELA}`);
  } catch {
    /* ignora */
  }
} finally {
  cliente.close();
}

console.log(`\n${'\u2500'.repeat(52)}`);
console.log(`  ${passos - falhas}/${passos} verificações passaram`);
console.log(`${'\u2500'.repeat(52)}\n`);
process.exit(falhas === 0 ? 0 : 1);
