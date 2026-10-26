import {
  listarAvisos,
  contarNaoLidos,
  marcarLidos,
  salvarInscricao,
  removerInscricao,
  contarInscricoes,
  chavePublicaPush,
  enviarPushParaUsuarios,
} from '../services/notificacoes.js';
import { exigirAutenticacao } from '../auth.js';
import { invalido } from '../erros.js';
import { agoraISO } from '../utils.js';

/** Inscrição de push: endpoint do serviço do navegador + par de chaves do aparelho. */
function interpretarInscricao(corpo) {
  const endpoint = typeof corpo?.endpoint === 'string' ? corpo.endpoint.trim() : '';
  if (!/^https:\/\/[^\s]{10,700}$/i.test(endpoint)) {
    throw invalido('Inscrição de notificação inválida (endpoint).', { campo: 'endpoint' });
  }
  const p256dh = String(corpo?.keys?.p256dh ?? '');
  const auth = String(corpo?.keys?.auth ?? '');
  if (Buffer.from(p256dh, 'base64url').length !== 65) {
    throw invalido('Inscrição de notificação inválida (chave do aparelho).', { campo: 'p256dh' });
  }
  if (Buffer.from(auth, 'base64url').length !== 16) {
    throw invalido('Inscrição de notificação inválida (segredo).', { campo: 'auth' });
  }
  return { endpoint, p256dh, auth };
}

export function registrar(rota) {
  /* ------------------------------- Central ------------------------------- */
  rota.get('/api/notificacoes', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    const [itens, naoLidos, inscricoes] = await Promise.all([
      listarAvisos(ctx.usuario, { limite: ctx.query.limite ?? 30 }),
      contarNaoLidos(ctx.usuario),
      contarInscricoes(ctx.usuario),
    ]);
    return {
      itens,
      naoLidos,
      push: {
        // O navegador só consegue se inscrever com a chave pública do servidor.
        chavePublica: await chavePublicaPush(),
        inscricoes,
      },
    };
  });

  rota.post('/api/notificacoes/lidas', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    const ids = Array.isArray(ctx.corpo?.ids) ? ctx.corpo.ids : null;
    await marcarLidos(ctx.usuario, ids);
    return { naoLidos: await contarNaoLidos(ctx.usuario), mensagem: 'Avisos marcados como lidos.' };
  });

  /* --------------------------- Push do navegador ------------------------- */
  rota.get('/api/notificacoes/push', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    return {
      chavePublica: await chavePublicaPush(),
      inscricoes: await contarInscricoes(ctx.usuario),
    };
  });

  rota.post('/api/notificacoes/push', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    const inscricao = interpretarInscricao(ctx.corpo);
    const total = await salvarInscricao(ctx.usuario, {
      ...inscricao,
      userAgent: ctx.req.headers['user-agent'] ?? null,
    });
    ctx.status = 201;
    return {
      inscricoes: total,
      mensagem: 'Este aparelho vai receber notificações de novos aparelhos.',
    };
  });

  rota.delete('/api/notificacoes/push', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    const endpoint = String(ctx.query.endpoint ?? '');
    if (!endpoint) throw invalido('Informe o aparelho que deve parar de receber notificações.', { campo: 'endpoint' });
    const total = await removerInscricao(ctx.usuario, endpoint);
    return {
      inscricoes: total,
      mensagem: 'Este aparelho não recebe mais notificações.',
    };
  });

  // Envia uma notificação de teste para as inscrições do próprio usuário.
  rota.post('/api/notificacoes/push/teste', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    const inscricoes = await contarInscricoes(ctx.usuario);
    if (!inscricoes) {
      throw invalido('Ative as notificações neste aparelho antes de enviar o teste.', { campo: 'push' });
    }
    const resultado = await enviarPushParaUsuarios(
      [{ id: ctx.usuario.id }],
      {
        titulo: 'UniverseTI Assistência',
        mensagem: `Notificação de teste enviada às ${agoraISO().slice(11, 16)} (UTC). Se você está vendo isto, os avisos estão funcionando.`,
        url: '/#/painel',
        tag: 'teste',
      },
    );
    return {
      ...resultado,
      mensagem:
        resultado.enviados > 0
          ? 'Notificação de teste enviada. Confira na barra de avisos do aparelho.'
          : 'Nenhuma notificação foi entregue. Reative as notificações neste aparelho e tente de novo.',
    };
  });
}
