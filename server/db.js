import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * Fachada de acesso a dados.
 *
 * Escolhe o driver em tempo de execução:
 *   • Turso (libSQL hospedado) quando LIBSQL_URL está definida — obrigatório na
 *     Vercel, onde o filesystem é somente leitura e efêmero;
 *   • SQLite local (node:sqlite) caso contrário — desenvolvimento e hospedagem
 *     com disco persistente.
 *
 * Toda a aplicação fala apenas com esta fachada, sempre de forma assíncrona.
 */

let driver = null;
let carregando = null;

export async function carregarDriver() {
  if (driver) return driver;
  if (carregando) return carregando;

  carregando = (async () => {
    const tursoConfigurado = Boolean(process.env.LIBSQL_URL || process.env.TURSO_DATABASE_URL);

    if (tursoConfigurado) {
      driver = await import('./drivers/turso.js');
    } else if (process.env.VERCEL) {
      throw new Error(
        'Ambiente serverless sem banco configurado: defina LIBSQL_URL e LIBSQL_AUTH_TOKEN ' +
          '(Turso) nas variáveis de ambiente do projeto. O filesystem da Vercel não é persistente.',
      );
    } else {
      driver = await import('./drivers/sqlite-local.js');
    }

    await driver.abrir();
    return driver;
  })();

  try {
    return await carregando;
  } finally {
    carregando = null;
  }
}

function exigir() {
  if (!driver) throw new Error('O banco ainda não foi inicializado. Chame aguardarBanco() antes.');
  return driver;
}

export function driverAtual() {
  return driver?.nome ?? null;
}

export function descreverBanco() {
  return driver?.descrever() ?? 'não inicializado';
}

export async function executar(sql, ...params) {
  return exigir().executar(sql, params);
}

export async function consultar(sql, ...params) {
  return exigir().consultar(sql, params);
}

export async function consultarUm(sql, ...params) {
  return exigir().consultarUm(sql, params);
}

/** Igual a `consultarUm`, mas lança erro claro se o registro não existir. */
export async function exigirUm(sql, ...params) {
  const linha = await exigir().consultarUm(sql, params);
  if (!linha) throw new Error(`Registro obrigatório não encontrado para a consulta: ${sql.slice(0, 80)}…`);
  return linha;
}

export async function transacao(fn) {
  return exigir().transacao(fn);
}

export async function verificarSaude() {
  const linha = await exigir().consultarUm('SELECT 1 AS ok');
  return linha?.ok === 1;
}

/**
 * A trilha de auditoria (eventos e fotos) é protegida por triggers que impedem
 * DELETE. Para operações administrativas de exclusão explícita, elas precisam
 * ser suspensas e religadas em volta da operação.
 */
const TRIGGERS_AUDITORIA = [
  `CREATE TRIGGER IF NOT EXISTS trg_eventos_imutavel_delete
   BEFORE DELETE ON eventos_os
   BEGIN
     SELECT RAISE(ABORT, 'Registro de auditoria: eventos_os nao pode ser excluido.');
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_fotos_imutavel_delete
   BEFORE DELETE ON fotos_os
   BEGIN
     SELECT RAISE(ABORT, 'Registro de auditoria: fotos_os nao pode ser excluido.');
   END`,
];

export async function suspenderProtecaoAuditoria() {
  await executar('DROP TRIGGER IF EXISTS trg_eventos_imutavel_delete');
  await executar('DROP TRIGGER IF EXISTS trg_fotos_imutavel_delete');
}

export async function restaurarProtecaoAuditoria() {
  for (const sql of TRIGGERS_AUDITORIA) {
    await executar(sql);
  }
}

/**
 * Executa `fn` com as chaves estrangeiras desligadas — usado por exclusões
 * administrativas que devem prevalecer sobre vínculos (histórico, loja etc.).
 * No Turso o PRAGMA é simplesmente ignorado (o FK já não é aplicado lá).
 */
export async function semChavesEstrangeiras(fn) {
  try {
    await executar('PRAGMA foreign_keys = OFF');
  } catch {
    /* driver sem suporte ao PRAGMA: segue */
  }
  try {
    return await fn();
  } finally {
    try {
      await executar('PRAGMA foreign_keys = ON');
    } catch {
      /* ignora */
    }
  }
}

/**
 * Localiza o schema.sql.
 *
 * O arquivo é lido em tempo de execução (e não importado), então o bundler da
 * Vercel não o enxerga sozinho — por isso ele é incluído explicitamente via
 * `functions.includeFiles` no vercel.json. Os caminhos candidatos cobrem as
 * diferentes formas de empacotamento.
 */
function localizarSchema() {
  const candidatos = [
    path.join(config.raizProjeto, 'server', 'schema.sql'),
    path.join(process.cwd(), 'server', 'schema.sql'),
    path.join(process.cwd(), 'schema.sql'),
    path.join(config.raizProjeto, 'schema.sql'),
  ];
  for (const candidato of candidatos) {
    if (fs.existsSync(candidato)) return candidato;
  }
  throw new Error(
    `schema.sql não encontrado. Caminhos verificados: ${candidatos.join(', ')}. ` +
      'Em deploys na Vercel, garanta "includeFiles" apontando para server/schema.sql no vercel.json.',
  );
}

/**
 * Aplica o schema (idempotente: tudo usa CREATE ... IF NOT EXISTS) e garante
 * que exista ao menos um administrador para o primeiro acesso.
 */
/**
 * Migrações incrementais para bancos que já existiam antes de uma nova coluna.
 * `CREATE TABLE IF NOT EXISTS` não altera tabelas existentes, então novas
 * colunas precisam de `ALTER TABLE ... ADD COLUMN`. É idempotente: checa o que
 * já existe antes de adicionar.
 */
const COLUNAS_INCREMENTAIS = {
  ordens_servico: [
    ['checklist', 'TEXT'],
    ['orcamento_valor', 'REAL'],
    ['orcamento_status', "TEXT NOT NULL DEFAULT 'sem_orcamento'"],
    ['orcamento_obs', 'TEXT'],
    ['orcamento_token', 'TEXT'],
    ['orcamento_criado_em', 'TEXT'],
    ['orcamento_decidido_em', 'TEXT'],
    ['forma_pagamento', 'TEXT'],
    ['garantia_dias', 'INTEGER'],
    ['garantia_ate', 'TEXT'],
    ['garantia_de_os_id', 'INTEGER'],
  ],
};

export async function aplicarMigracoes(atual) {
  for (const [tabela, colunas] of Object.entries(COLUNAS_INCREMENTAIS)) {
    let existentes;
    try {
      existentes = await atual.consultar(`PRAGMA table_info(${tabela})`);
    } catch {
      // Driver sem suporte a PRAGMA: assume que a tabela já veio do schema novo.
      continue;
    }
    const nomes = new Set((existentes ?? []).map((c) => c.name));
    for (const [nome, tipo] of colunas) {
      if (nomes.has(nome)) continue;
      try {
        await atual.executar(`ALTER TABLE ${tabela} ADD COLUMN ${nome} ${tipo}`);
      } catch (erro) {
        // Corrida entre instâncias serverless: se outra já adicionou, seguimos.
        if (!/duplicate column|já existe|already exists/i.test(String(erro?.message ?? ''))) throw erro;
      }
      nomes.add(nome);
    }
  }

  // Índices de colunas que podem ter acabado de ser criadas. Ficam aqui (e não
  // no schema) porque o schema roda antes da migração: em banco antigo, criar o
  // índice antes da coluna existir faria o boot falhar.
  const indices = [
    'CREATE INDEX IF NOT EXISTS idx_os_orcamento_token ON ordens_servico(orcamento_token)',
    'CREATE INDEX IF NOT EXISTS idx_os_orcamento_status ON ordens_servico(orcamento_status)',
  ];
  for (const sql of indices) {
    try {
      await atual.executar(sql);
    } catch (erro) {
      console.warn('[migração] índice não criado:', erro?.message ?? erro);
    }
  }

  await relaxarLojaUsuarios(atual);
}

/**
 * Relaxa o vínculo de loja dos usuários: só o atendente passa a exigir loja.
 * Técnico e administrador enxergam a rede inteira e podem existir sem loja.
 *
 * SQLite não permite alterar um CHECK existente, então a tabela é recriada
 * preservando os ids (outras tabelas referenciam usuarios.id). A reconstrução
 * evita RENAME para não reescrever as chaves estrangeiras das outras tabelas.
 */
async function relaxarLojaUsuarios(atual) {
  let sql = null;
  try {
    const linhas = await atual.consultar("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'usuarios'");
    sql = linhas?.[0]?.sql ?? null;
  } catch {
    return;
  }
  if (!sql) return;
  if (!/papel\s*=\s*'admin'\s+OR\s+loja_id\s+IS\s+NOT\s+NULL/i.test(sql)) return;

  const ddl = `CREATE TABLE usuarios (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nome       TEXT    NOT NULL,
    email      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    senha_hash TEXT    NOT NULL,
    papel      TEXT    NOT NULL CHECK (papel IN ('atendente', 'tecnico', 'admin')),
    loja_id    INTEGER REFERENCES lojas(id) ON DELETE RESTRICT,
    telefone   TEXT,
    ativo      INTEGER NOT NULL DEFAULT 1,
    criado_em  TEXT    NOT NULL,
    CHECK (papel <> 'atendente' OR loja_id IS NOT NULL)
  )`;

  const passos = [
    'CREATE TABLE usuarios_backup AS SELECT * FROM usuarios',
    'DROP TABLE usuarios',
    ddl,
    `INSERT INTO usuarios (id, nome, email, senha_hash, papel, loja_id, telefone, ativo, criado_em)
       SELECT id, nome, email, senha_hash, papel, loja_id, telefone, ativo, criado_em FROM usuarios_backup`,
    'DROP TABLE usuarios_backup',
    'CREATE INDEX IF NOT EXISTS idx_usuarios_loja ON usuarios(loja_id)',
  ];

  try {
    await atual.executar('PRAGMA foreign_keys = OFF');
  } catch {
    /* driver sem PRAGMA (Turso) — a integridade referencial já não é aplicada lá */
  }
  try {
    for (const comando of passos) await atual.executar(comando);
    console.log('[migração] vínculo de loja relaxado (técnico/admin sem loja).');
  } catch (erro) {
    console.warn('[migração] falhou ao relaxar o vínculo de loja:', erro?.message ?? erro);
    try {
      const existe = await atual.consultar("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'usuarios'");
      if (!existe?.length) await atual.executar('CREATE TABLE usuarios AS SELECT * FROM usuarios_backup');
    } catch {
      /* melhor esforço */
    }
  } finally {
    try {
      await atual.executar('PRAGMA foreign_keys = ON');
    } catch {
      /* ignora */
    }
  }
}

export async function prepararBanco() {
  const atual = await carregarDriver();

  const schema = fs.readFileSync(localizarSchema(), 'utf8');
  await atual.executarScript(schema);
  await aplicarMigracoes(atual);

  const versao = await atual.consultarUm('SELECT COUNT(*) AS total FROM schema_version');
  if (!versao || Number(versao.total) === 0) {
    await atual.executar('INSERT INTO schema_version (versao, aplicado_em) VALUES (?, ?)', [1, new Date().toISOString()]);
  }

  const usuarios = await atual.consultarUm('SELECT COUNT(*) AS total FROM usuarios');
  return { primeirAcesso: Number(usuarios?.total ?? 0) === 0 };
}

export function caminhoDoBanco() {
  return driver?.caminhoFisico?.() ?? null;
}

export async function fecharBanco() {
  if (driver?.fechar) await driver.fechar();
  driver = null;
}
