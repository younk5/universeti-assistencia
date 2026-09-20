import { resumoDashboard } from '../services/dashboard.js';
import { listarOS } from '../services/ordens.js';
import { exigirAutenticacao, exigirPermissao, escopoRede } from '../auth.js';
import { consultar } from '../db.js';

export function registrar(rota) {
  /** Contadores leves para os badges de navegação (sem relatórios pesados). */
  rota.get('/api/resumo', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    const escopo = escopoRede(ctx.usuario) ? null : ctx.usuario.lojaId;
    const chaves = ['aguardando', 'em_manutencao', 'aguardando_peca', 'pronto', 'retirado', 'cancelado'];
    const status = Object.fromEntries(chaves.map((c) => [c, 0]));
    const linhas = await consultar(
      `SELECT status, COUNT(*) AS total FROM ordens_servico o ${escopo ? 'WHERE o.loja_id = ?' : ''} GROUP BY status`,
      ...(escopo ? [escopo] : []),
    );
    for (const linha of linhas) {
      if (linha.status in status) status[linha.status] = Number(linha.total);
    }
    status.abertas = chaves
      .filter((c) => c !== 'retirado' && c !== 'cancelado')
      .reduce((soma, c) => soma + status[c], 0);
    status.total = chaves.reduce((soma, c) => soma + status[c], 0);
    return { status };
  });

  rota.get('/api/dashboard', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    exigirPermissao(ctx.usuario, 'os.ver');

    const resumo = await resumoDashboard({
      usuario: ctx.usuario,
      lojaId: ctx.query.lojaId,
      de: ctx.query.de,
      ate: ctx.query.ate,
    });

    const recentes = (
      await listarOS({
        usuario: ctx.usuario,
        lojaId: ctx.query.lojaId,
        limite: Number(ctx.query.limite ?? 8),
      })
    ).itens;

    const fila = (
      await listarOS({
        usuario: ctx.usuario,
        status: 'aguardando,em_manutencao,aguardando_peca',
        lojaId: ctx.query.lojaId,
        limite: 5,
      })
    ).itens;

    return { ...resumo, recentes, fila };
  });
}
