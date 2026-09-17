import { Roteador } from '../router.js';
import { registrar as registrarAuth } from './auth.js';
import { registrar as registrarOrdens } from './ordens.js';
import { registrar as registrarDashboard } from './dashboard.js';
import { registrar as registrarAdmin } from './admin.js';
import { verificarSaude, descreverBanco, driverAtual } from '../db.js';

export function montarApi() {
  const rota = new Roteador();

  rota.get('/api/health', async (ctx) => {
    const ok = await verificarSaude();
    return {
      ok,
      versao: '1.1.0',
      hora: new Date().toISOString(),
      banco: driverAtual(),
      bancoDescricao: descreverBanco(),
      // Exposto de propósito: ajuda a diagnosticar roteamento/rewrites na Vercel.
      caminhoRecebido: ctx.url.pathname,
      parametros: ctx.query,
    };
  });

  registrarAuth(rota);
  registrarOrdens(rota);
  registrarDashboard(rota);
  registrarAdmin(rota);

  return rota;
}
