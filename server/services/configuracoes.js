import { consultar, consultarUm, executar } from '../db.js';
import { agoraISO } from '../utils.js';

/**
 * Configurações simples da rede (chave/valor). Hoje guarda o percentual de
 * comissão dos técnicos usado no painel financeiro.
 */

export const CHAVES = Object.freeze({
  GARANTIA_DIAS: 'garantia_dias_padrao',
  PRAZO_DIAS: 'prazo_dias_padrao',
});

const PADROES = {
  [CHAVES.GARANTIA_DIAS]: '90',
  [CHAVES.PRAZO_DIAS]: '5',
};

export async function lerConfig(chave, padrao = null) {
  const linha = await consultarUm('SELECT valor FROM configuracoes WHERE chave = ?', chave);
  if (linha) return linha.valor;
  return padrao ?? PADROES[chave] ?? null;
}

export async function lerNumeroConfig(chave, padrao = null) {
  const bruto = await lerConfig(chave, padrao);
  const numero = Number(bruto);
  return Number.isFinite(numero) ? numero : padrao;
}

export async function definirConfig(chave, valor) {
  await executar(
    `INSERT INTO configuracoes (chave, valor, atualizado_em) VALUES (?, ?, ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`,
    chave,
    String(valor),
    agoraISO(),
  );
}

export async function listarConfiguracoes() {
  const linhas = await consultar('SELECT chave, valor, atualizado_em FROM configuracoes ORDER BY chave');
  const mapa = { ...PADROES };
  for (const linha of linhas) mapa[linha.chave] = linha.valor;
  return mapa;
}
