import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, caminhos } from '../config.js';

/**
 * Driver local (desenvolvimento e hospedagem com disco persistente).
 * Envolve o node:sqlite — síncrono por natureza — em uma API assíncrona,
 * para que o restante do sistema não saiba qual driver está por baixo.
 */

export const nome = 'sqlite-local';

export function descrever() {
  return `SQLite local (${caminhos.banco})`;
}

let banco = null;

function conexao() {
  if (!banco) throw new Error('Banco local não foi inicializado.');
  return banco;
}

const envolver = (conexaoBruta) => ({
  async all(sql, params) {
    return conexaoBruta.prepare(sql).all(...params);
  },
  async get(sql, params) {
    return conexaoBruta.prepare(sql).get(...params) ?? null;
  },
  async run(sql, params) {
    const info = conexaoBruta.prepare(sql).run(...params);
    return {
      changes: Number(info.changes ?? 0),
      lastInsertRowid: Number(info.lastInsertRowid ?? 0),
    };
  },
});

export async function abrir() {
  if (banco) return;

  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(caminhos.uploads, { recursive: true });

  banco = new DatabaseSync(caminhos.banco);
  banco.exec('PRAGMA journal_mode = WAL;');
  banco.exec('PRAGMA foreign_keys = ON;');
  banco.exec('PRAGMA busy_timeout = 5000;');
}

export async function executarScript(sql) {
  conexao().exec(sql);
}

export async function executar(sql, params = []) {
  const info = conexao().prepare(sql).run(...params);
  return {
    changes: Number(info.changes ?? 0),
    lastInsertRowid: Number(info.lastInsertRowid ?? 0),
  };
}

export async function consultar(sql, params = []) {
  return conexao().prepare(sql).all(...params);
}

export async function consultarUm(sql, params = []) {
  return conexao().prepare(sql).get(...params) ?? null;
}

/**
 * Transação interativa. Como o driver é síncrono, usamos BEGIN IMMEDIATE para
 * já garantir o lock de escrita (evita corrida na numeração das OS).
 */
export async function transacao(fn) {
  const bruto = conexao();
  bruto.exec('BEGIN IMMEDIATE');
  try {
    const resultado = await fn(envolver(bruto));
    bruto.exec('COMMIT');
    return resultado;
  } catch (erro) {
    try {
      bruto.exec('ROLLBACK');
    } catch {
      /* transação já encerrada */
    }
    throw erro;
  }
}

export async function fechar() {
  if (banco) {
    banco.close();
    banco = null;
  }
}

export function caminhoFisico() {
  return caminhos.banco;
}

export { path };
