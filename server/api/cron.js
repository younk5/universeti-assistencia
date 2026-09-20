import { exportarBanco } from '../services/backup.js';
import { ErroApp } from '../erros.js';

/**
 * Rotina agendada (Vercel Cron) que exporta todas as tabelas em JSON e guarda
 * uma cópia no Vercel Blob. Protegida por CRON_SECRET — a Vercel envia o
 * cabeçalho Authorization automaticamente quando a variável existe.
 *
 *   vercel.json → "crons": [{ "path": "/api/cron/backup", "schedule": "0 6 * * *" }]
 */
export function registrar(rota) {
  rota.get('/api/cron/backup', async (ctx) => {
    const segredo = process.env.CRON_SECRET;
    if (segredo) {
      const autorizacao = String(ctx.req.headers['authorization'] ?? '');
      if (autorizacao !== `Bearer ${segredo}`) {
        throw new ErroApp('Não autorizado.', { status: 401, codigo: 'nao_autorizado' });
      }
    }

    const backup = await exportarBanco();
    const conteudo = JSON.stringify(backup);
    let url = null;

    try {
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      if (token) {
        const { put } = await import('@vercel/blob');
        const nome = `backups/backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        ({ url } = await put(nome, conteudo, {
          access: 'private',
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: 'application/json',
          token,
        }));
      }
    } catch (erro) {
      console.warn('[cron/backup] falha ao gravar no Blob:', erro?.message ?? erro);
    }

    const linhas = Object.fromEntries(Object.entries(backup.tabelas).map(([tabela, registros]) => [tabela, registros.length]));
    return { ok: true, geradoEm: backup.geradoEm, bytes: conteudo.length, url, linhas };
  });
}
