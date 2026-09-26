import { ErroApp } from './erros.js';

/**
 * Limitador de requisições em memória (por IP + escopo). Protege rotas
 * públicas e a API contra abuso/força-bruta. Em ambiente serverless cada
 * instância tem seu próprio balde — suficiente como camada extra; o bloqueio
 * de login continua sendo persistente no banco.
 */

const baldes = new Map();
let ultimaLimpeza = 0;

function ipDe(req) {
  const encaminhado = String(req.headers?.['x-forwarded-for'] ?? '')
    .split(',')[0]
    .trim();
  return encaminhado || req.socket?.remoteAddress || 'desconhecido';
}

function limpar() {
  const agora = Date.now();
  if (agora - ultimaLimpeza < 60_000) return;
  ultimaLimpeza = agora;
  for (const [chave, registro] of baldes) {
    if (agora - registro.desde > 10 * 60_000) baldes.delete(chave);
  }
}

export function limitar(req, escopo, { max = 60, janelaMs = 60_000 } = {}) {
  const chave = `${escopo}|${ipDe(req)}`;
  const agora = Date.now();
  const registro = baldes.get(chave);

  if (!registro || agora - registro.desde >= janelaMs) {
    baldes.set(chave, { desde: agora, total: 1 });
    limpar();
    return;
  }

  registro.total += 1;
  if (registro.total > max) {
    const restante = Math.max(1, Math.ceil((janelaMs - (agora - registro.desde)) / 1000));
    throw new ErroApp(`Muitas requisições em pouco tempo. Tente novamente em ${restante}s.`, {
      status: 429,
      codigo: 'muitas_requisicoes',
      detalhes: { retryAfterSegundos: restante },
    });
  }
}
