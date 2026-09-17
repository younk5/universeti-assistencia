import { consultar, consultarUm } from '../db.js';
import { STATUS_VALIDOS } from './ordens.js';

const CORES_STATUS = ['aguardando', 'em_manutencao', 'aguardando_peca', 'pronto', 'retirado', 'cancelado'];

function periodoPadrao(de, ate) {
  const hoje = new Date();
  const inicio = de ? new Date(`${de}T00:00:00.000Z`) : new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));
  const fim = ate ? new Date(`${ate}T23:59:59.999Z`) : new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { de: inicio.toISOString(), ate: fim.toISOString() };
}

export async function resumoDashboard({ usuario, lojaId = null, de = null, ate = null }) {
  const escopo = usuario.papel === 'admin' ? (lojaId ? Number(lojaId) : null) : Number(usuario.lojaId);
  const baseWhere = [];
  const baseParams = [];
  if (escopo) {
    baseWhere.push('o.loja_id = ?');
    baseParams.push(escopo);
  }
  const filtroLoja = baseWhere.length ? `WHERE ${baseWhere.join(' AND ')}` : '';

  const contagens = Object.fromEntries(CORES_STATUS.map((s) => [s, 0]));
  for (const linha of await consultar(
    `SELECT o.status, COUNT(*) AS total FROM ordens_servico o ${filtroLoja} GROUP BY o.status`,
    ...baseParams,
  )) {
    if (STATUS_VALIDOS.includes(linha.status)) contagens[linha.status] = Number(linha.total);
  }

  const abertas = CORES_STATUS.filter((s) => !['retirado', 'cancelado'].includes(s)).reduce(
    (soma, s) => soma + contagens[s],
    0,
  );

  const janela = periodoPadrao(de, ate);
  const wherePeriodo = [...baseWhere, 'o.criado_em >= ?', 'o.criado_em <= ?'];
  const paramsPeriodo = [...baseParams, janela.de, janela.ate];

  const periodo = await consultarUm(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN o.status IN ('pronto','retirado') THEN o.valor ELSE 0 END), 0) AS faturamento
       FROM ordens_servico o
      WHERE ${wherePeriodo.join(' AND ')}`,
    ...paramsPeriodo,
  );

  const porLoja = await consultar(
    `SELECT l.id, l.nome, l.codigo, l.ativo,
            COUNT(o.id) AS total,
            SUM(CASE WHEN o.status = 'aguardando' THEN 1 ELSE 0 END) AS aguardando,
            SUM(CASE WHEN o.status = 'em_manutencao' THEN 1 ELSE 0 END) AS em_manutencao,
            SUM(CASE WHEN o.status = 'aguardando_peca' THEN 1 ELSE 0 END) AS aguardando_peca,
            SUM(CASE WHEN o.status = 'pronto' THEN 1 ELSE 0 END) AS pronto,
            SUM(CASE WHEN o.status = 'retirado' THEN 1 ELSE 0 END) AS retirado,
            SUM(CASE WHEN o.status = 'cancelado' THEN 1 ELSE 0 END) AS cancelado,
            SUM(CASE WHEN o.status = 'retirado' AND o.retirado_em >= ? THEN 1 ELSE 0 END) AS retirados_periodo
       FROM lojas l
       LEFT JOIN ordens_servico o ON o.loja_id = l.id AND o.criado_em >= ? AND o.criado_em <= ?
      WHERE l.ativo = 1 ${escopo ? 'AND l.id = ?' : ''}
      GROUP BY l.id
      ORDER BY total DESC, l.nome COLLATE NOCASE`,
    janela.de,
    janela.de,
    janela.ate,
    ...(escopo ? [escopo] : []),
  );

  const produtividade = await consultar(
    `SELECT u.id, u.nome, l.nome AS loja_nome,
            COUNT(o.id) AS concluidas,
            SUM(CASE WHEN o.concluido_em IS NOT NULL THEN 1 ELSE 0 END) AS concluidas_com_data,
            AVG(CASE WHEN o.concluido_em IS NOT NULL
                     THEN (julianday(o.concluido_em) - julianday(o.iniciado_em)) * 24.0 END) AS horas_medias
       FROM usuarios u
       LEFT JOIN lojas l ON l.id = u.loja_id
       LEFT JOIN ordens_servico o
              ON o.tecnico_id = u.id
             AND o.concluido_em IS NOT NULL
             AND o.concluido_em >= ? AND o.concluido_em <= ?
      WHERE u.papel = 'tecnico' AND u.ativo = 1 ${escopo ? 'AND u.loja_id = ?' : ''}
      GROUP BY u.id
      ORDER BY concluidas_com_data DESC, u.nome COLLATE NOCASE
      LIMIT 10`,
    janela.de,
    janela.ate,
    ...(escopo ? [escopo] : []),
  );

  const serie = await consultar(
    `SELECT substr(o.criado_em, 1, 10) AS dia,
            COUNT(*) AS entrada,
            SUM(CASE WHEN o.retirado_em IS NOT NULL AND substr(o.retirado_em, 1, 10) = substr(o.criado_em, 1, 10) THEN 1 ELSE 0 END) AS retiradas
       FROM ordens_servico o
      WHERE o.criado_em >= ? AND o.criado_em <= ? ${escopo ? 'AND o.loja_id = ?' : ''}
      GROUP BY dia
      ORDER BY dia ASC`,
    janela.de,
    janela.ate,
    ...(escopo ? [escopo] : []),
  );

  return {
    geradoEm: new Date().toISOString(),
    periodo: { de: janela.de.slice(0, 10), ate: janela.ate.slice(0, 10) },
    escopo: { lojaId: escopo, todas: usuario.papel === 'admin' && !escopo },
    status: { ...contagens, abertas, total: Object.values(contagens).reduce((a, b) => a + b, 0) },
    periodoResumo: {
      total: Number(periodo?.total ?? 0),
      faturamento: Number(periodo?.faturamento ?? 0),
    },
    porLoja: porLoja.map((l) => ({
      ...l,
      total: Number(l.total),
      aguardando: Number(l.aguardando ?? 0),
      em_manutencao: Number(l.em_manutencao ?? 0),
      aguardando_peca: Number(l.aguardando_peca ?? 0),
      pronto: Number(l.pronto ?? 0),
      retirado: Number(l.retirado ?? 0),
      cancelado: Number(l.cancelado ?? 0),
      retirados_periodo: Number(l.retirados_periodo ?? 0),
    })),
    produtividade: produtividade.map((t) => ({
      ...t,
      concluidas: Number(t.concluidas ?? 0),
      concluidas_com_data: Number(t.concluidas_com_data ?? 0),
      horas_medias: t.horas_medias == null ? null : Number(t.horas_medias),
    })),
    serie: serie.map((p) => ({ ...p, entrada: Number(p.entrada), retiradas: Number(p.retiradas ?? 0) })),
  };
}
