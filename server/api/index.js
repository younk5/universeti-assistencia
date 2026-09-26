import { Roteador } from '../router.js';
import { registrar as registrarAuth } from './auth.js';
import { registrar as registrarOrdens } from './ordens.js';
import { registrar as registrarDashboard } from './dashboard.js';
import { registrar as registrarAdmin } from './admin.js';
import { registrar as registrarPublico } from './publico.js';
import { registrar as registrarCron } from './cron.js';
import { verificarSaude, descreverBanco, driverAtual } from '../db.js';
import { acessoTotal } from '../auth.js';

export function montarApi() {
  const rota = new Roteador();

  rota.get('/api/health', async (ctx) => {
    const ok = await verificarSaude();
    const base = { ok, versao: '1.1.0', hora: new Date().toISOString() };
    // Detalhes internos só para administrador/técnico autenticado.
    if (acessoTotal(ctx.usuario)) {
      return { ...base, banco: driverAtual(), bancoDescricao: descreverBanco(), caminhoRecebido: ctx.url.pathname };
    }
    return base;
  });

  registrarAuth(rota);
  registrarOrdens(rota);
  registrarDashboard(rota);
  registrarAdmin(rota);
  registrarPublico(rota);
  registrarCron(rota);

  return rota;
}
