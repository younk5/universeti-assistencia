import { h, montar } from './dom.js';
import { icone } from './icons.js';
import { api } from './api.js';
import { store } from './store.js';
import { abrirModal, ocupado, toast, toastErro, toastSucesso, faixaAviso, estadoVazio } from './ui.js';
import { quando } from './format.js';

/**
 * Avisos: o sino do sistema.
 *
 * Dois canais trabalham juntos:
 *   • dentro do app — o contador no sino e a lista da central são atualizados
 *     por consulta periódica (e ao voltar para a aba), então o número aparece
 *     mesmo quando o push não está liberado;
 *   • fora do app — Web Push (service worker + VAPID) avisa o celular/computador
 *     com o sistema fechado. Basta ativar uma vez por aparelho.
 */

const INTERVALO_MS = 45000;

const estado = {
  itens: [],
  naoLidos: 0,
  ultimoId: null,
  iniciado: false,
  timer: null,
  ouvindo: false,
};

const ehIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

export function contarAvisos() {
  return estado.naoLidos;
}

/* -------------------------------------------------------------------------- */
/* Botões e contadores                                                        */
/* -------------------------------------------------------------------------- */

function contadorAtualizado() {
  return estado.naoLidos > 99 ? '99+' : String(estado.naoLidos);
}

/** Sino da topbar (celular e tablet): ícone + contador. */
export function montarBotaoAvisos() {
  return h(
    'button.btn.btn--icone.topbar__sino',
    {
      type: 'button',
      'aria-label': estado.naoLidos ? `Avisos (${estado.naoLidos} não lidos)` : 'Avisos',
      title: 'Avisos',
      onclick: () => abrirPainelAvisos(),
    },
    icone('sino', { tamanho: 19 }),
    h(
      `span.topbar__sino-contador${estado.naoLidos ? '' : '.oculto'}`,
      { dataset: { badgeAvisos: '1' } },
      contadorAtualizado(),
    ),
  );
}

/** Item da barra lateral (desktop): mesmo destino, mesmo contador. */
export function montarItemAvisos() {
  return h(
    'button.sidebar__link',
    {
      type: 'button',
      onclick: () => abrirPainelAvisos(),
      'aria-label': 'Avisos',
    },
    icone('sino', { tamanho: 19 }),
    'Avisos',
    h(
      `span.sidebar__link-contador${estado.naoLidos ? '' : '.oculto'}`,
      { dataset: { badgeAvisos: '1' } },
      contadorAtualizado(),
    ),
  );
}

export function atualizarBadgeAvisos() {
  const texto = contadorAtualizado();
  for (const elemento of document.querySelectorAll('[data-badge-avisos]')) {
    elemento.textContent = estado.naoLidos ? texto : '';
    elemento.classList.toggle('oculto', estado.naoLidos === 0);
  }
  for (const botao of document.querySelectorAll('.topbar__sino')) {
    botao.setAttribute('aria-label', estado.naoLidos ? `Avisos (${estado.naoLidos} não lidos)` : 'Avisos');
    botao.classList.toggle('topbar__sino--novo', estado.naoLidos > 0);
  }
}

function atualizarTitulo() {
  const base = String(document.title).replace(/^\(\d+\+?\)\s*/, '');
  document.title = estado.naoLidos ? `(${contadorAtualizado()}) ${base}` : base;
}

/* -------------------------------------------------------------------------- */
/* Ciclo de atualização                                                       */
/* -------------------------------------------------------------------------- */

export async function iniciarAvisos() {
  if (estado.iniciado) return;
  estado.iniciado = true;

  registrarServiceWorker();
  await atualizar({ silencioso: true });

  if (estado.timer) clearInterval(estado.timer);
  estado.timer = setInterval(() => {
    if (document.visibilityState === 'visible') atualizar();
  }, INTERVALO_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') atualizar();
  });

  if (!estado.ouvindo) {
    estado.ouvindo = true;
    store.assinar(() => {
      if (!store.usuario) pararAvisos();
    });
  }
}

export function pararAvisos() {
  if (estado.timer) clearInterval(estado.timer);
  estado.timer = null;
  estado.iniciado = false;
  estado.itens = [];
  estado.naoLidos = 0;
  estado.ultimoId = null;
  atualizarBadgeAvisos();
}

/** Busca a central no servidor e avisa o que chegou desde a última consulta. */
export async function atualizar({ silencioso = false } = {}) {
  if (!store.usuario) return;
  try {
    const dados = await api.get('/api/notificacoes');
    const itens = dados.itens ?? [];
    const maiorId = itens.reduce((maior, item) => Math.max(maior, Number(item.id) || 0), 0);
    const novos =
      estado.ultimoId === null ? [] : itens.filter((item) => Number(item.id) > estado.ultimoId && !item.lido_em);

    estado.itens = itens;
    estado.naoLidos = Number(dados.naoLidos) || 0;
    if (maiorId) estado.ultimoId = Math.max(estado.ultimoId ?? 0, maiorId);

    atualizarBadgeAvisos();
    atualizarTitulo();

    if (silencioso) return;
    // Um aviso: mostra o conteúdo. Vários de uma vez: um resumo só, sem
    // empilhar toasts no meio do atendimento.
    if (novos.length === 1) {
      const [aviso] = novos;
      toast(aviso.mensagem ?? aviso.titulo, { titulo: aviso.titulo, tipo: 'info', duracao: 8000 });
    } else if (novos.length > 1) {
      toastSucesso(`${novos.length} avisos novos.`, { titulo: 'Avisos' });
    }
    for (const aviso of novos) mostrarNotificacaoLocal(aviso);
  } catch (erro) {
    // O sino é acessório: sem rede, a navegação continua normal.
    console.warn('[avisos] não foi possível atualizar:', erro?.message ?? erro);
  }
}

/* -------------------------------------------------------------------------- */
/* Notificação do próprio navegador (com o app aberto)                        */
/* -------------------------------------------------------------------------- */

async function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (erro) {
    console.warn('[avisos] service worker não registrou:', erro?.message ?? erro);
    return null;
  }
}

async function mostrarNotificacaoLocal(aviso) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const registro = await navigator.serviceWorker?.getRegistration();
    const opcoes = {
      body: aviso.mensagem ?? '',
      icon: '/img/icone-192.png',
      tag: `aviso-${aviso.id}`,
      data: { url: aviso.url ? `/#${aviso.url}` : '/#/painel' },
    };
    if (registro) await registro.showNotification(aviso.titulo, opcoes);
    else new Notification(aviso.titulo, opcoes);
  } catch (erro) {
    console.warn('[avisos] notificação local falhou:', erro?.message ?? erro);
  }
}

/* -------------------------------------------------------------------------- */
/* Push do aparelho                                                           */
/* -------------------------------------------------------------------------- */

function suportaPush() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function chaveParaBytes(base64Url) {
  const base64 = String(base64Url).replace(/-/g, '+').replace(/_/g, '/');
  const bruto = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
  return Uint8Array.from(bruto, (caractere) => caractere.charCodeAt(0));
}

async function situacaoDoAparelho() {
  if (!suportaPush()) return { suportado: false, inscrito: false, permissao: 'indisponivel' };
  let inscrito = false;
  try {
    const registro = await navigator.serviceWorker.getRegistration();
    const inscricao = registro ? await registro.pushManager.getSubscription() : null;
    inscrito = Boolean(inscricao);
  } catch {
    inscrito = false;
  }
  return { suportado: true, inscrito, permissao: Notification.permission };
}

async function ativarPush() {
  if (!suportaPush()) {
    throw new Error(
      ehIos()
        ? 'No iPhone, primeiro adicione o sistema à Tela de Início (Compartilhar → Adicionar à Tela de Início) e abra por lá.'
        : 'Este navegador não suporta notificações push. Use Chrome, Edge ou Firefox atualizado.',
    );
  }
  const permissao = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permissao !== 'granted') {
    throw new Error('Permissão de notificação bloqueada. Libere as notificações deste site nas configurações do navegador.');
  }

  const registro = await navigator.serviceWorker.ready;
  const { chavePublica } = await api.get('/api/notificacoes/push');
  const chave = chaveParaBytes(chavePublica);

  let inscricao = await registro.pushManager.getSubscription();
  try {
    inscricao =
      inscricao ?? (await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave }));
  } catch (erro) {
    if (erro?.name !== 'InvalidStateError') throw erro;
    // A inscrição antiga usava outra chave do servidor: refaz.
    const antiga = await registro.pushManager.getSubscription();
    await antiga?.unsubscribe();
    inscricao = await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave });
  }

  const dados = inscricao.toJSON();
  await api.post('/api/notificacoes/push', {
    endpoint: dados.endpoint,
    keys: { p256dh: dados.keys.p256dh, auth: dados.keys.auth },
  });
  return inscricao;
}

async function desativarPush() {
  const registro = await navigator.serviceWorker?.getRegistration();
  const inscricao = registro ? await registro.pushManager.getSubscription() : null;
  if (inscricao) {
    await api.delete(`/api/notificacoes/push?endpoint=${encodeURIComponent(inscricao.endpoint)}`).catch(() => {});
    await inscricao.unsubscribe().catch(() => {});
  }
}

/* -------------------------------------------------------------------------- */
/* Painel                                                                     */
/* -------------------------------------------------------------------------- */

export async function abrirPainelAvisos() {
  const corpo = h('div.pilha', {}, h('p.texto-mini.texto-suave', {}, 'Carregando avisos…'));
  const rodape = h('div.grupo-botoes');

  const modal = abrirModal({
    titulo: 'Avisos',
    descricao: 'Novos aparelhos e atualizações da assistência',
    corpo,
    rodape,
    largura: '620px',
  });

  desenhar();

  async function desenhar() {
    montar(corpo, h('p.texto-mini.texto-suave', {}, 'Carregando avisos…'));
    montar(rodape);
    await atualizar({ silencioso: true });
    const situacao = await situacaoDoAparelho();

    const lista = estado.itens.length
      ? h(
          'div.pilha--pequena.pilha',
          {},
          ...estado.itens.map((aviso) =>
            h(
              `button.aviso${aviso.lido_em ? '.aviso--lido' : ''}`,
              {
                type: 'button',
                onclick: async () => {
                  if (!aviso.lido_em) {
                    await api.post('/api/notificacoes/lidas', { ids: [aviso.id] }).catch(() => {});
                  }
                  modal.fechar();
                  if (aviso.url) window.location.hash = aviso.url;
                  else await atualizar();
                },
              },
              h('span.aviso__marca', {}, icone(aviso.tipo === 'os_criada' ? 'dispositivo' : 'relogio', { tamanho: 16 })),
              h(
                'span.aviso__corpo',
                {},
                h('span.aviso__titulo', {}, aviso.titulo),
                aviso.mensagem ? h('span.aviso__texto', {}, aviso.mensagem) : null,
                h('span.aviso__quando', {}, `${quando(aviso.criado_em)}${aviso.numero_os ? ` · OS ${aviso.numero_os}` : ''}`),
              ),
              aviso.lido_em ? null : h('span.aviso__ponto', { 'aria-label': 'Não lido' }),
            ),
          ),
        )
      : estadoVazio({
          icone: 'sino',
          titulo: 'Nenhum aviso por aqui',
          texto: 'Quando um aparelho der entrada na assistência, o aviso aparece aqui e no seu celular.',
        });

    montar(
      corpo,
      blocoAparelho(situacao, desenhar),
      h('div.linha.linha--entre', {}, h('h3', { style: { fontSize: '0.92rem' } }, 'Últimos avisos'), estado.naoLidos ? h('span.badge.badge--acento.badge--sem-ponto', {}, `${estado.naoLidos} não lido(s)`) : null),
      lista,
    );

    montar(
      rodape,
      h(
        'button.btn.btn--secundario',
        {
          type: 'button',
          disabled: estado.naoLidos === 0,
          onclick: async (evento) => {
            ocupado(evento.currentTarget, true, 'Marcando…');
            try {
              await api.post('/api/notificacoes/lidas', {});
              await desenhar();
            } finally {
              ocupado(evento.currentTarget, false);
            }
          },
        },
        icone('check', { tamanho: 16 }),
        'Marcar todas como lidas',
      ),
      h('button.btn.btn--primario', { type: 'button', onclick: () => modal.fechar() }, 'Fechar'),
    );
  }

  function blocoAparelho(situacao, aoMudar) {
    const titulo = h('span.texto-forte', {}, 'Notificações neste aparelho');
    const badge = situacao.inscrito
      ? h('span.badge.badge--pronto.badge--sem-ponto', {}, 'Ativadas')
      : h('span.badge.badge--retirado.badge--sem-ponto', {}, 'Desativadas');

    const explicacao = situacao.suportado
      ? situacao.inscrito
        ? 'Você recebe um aviso no celular ou no computador assim que um aparelho dá entrada — mesmo com o sistema fechado.'
        : 'Ative para o aparelho apitar quando chegar um celular novo, sem precisar abrir o sistema para conferir.'
      : ehIos()
        ? 'No iPhone, o aviso só funciona com o sistema adicionado à Tela de Início (Compartilhar → Adicionar à Tela de Início).'
        : 'Este navegador não suporta notificações push. Abra o sistema no Chrome, Edge ou Firefox.';

    const botaoAtivar = h(
      'button.btn.btn--primario.btn--pequeno',
      {
        type: 'button',
        onclick: async (evento) => {
          ocupado(evento.currentTarget, true, 'Ativando…');
          try {
            await ativarPush();
            toastSucesso('Pronto: este aparelho vai receber os avisos.', { titulo: 'Notificações ativadas' });
            await aoMudar();
          } catch (erro) {
            toastErro(erro.message, { titulo: 'Não foi possível ativar' });
          } finally {
            ocupado(evento.currentTarget, false);
          }
        },
      },
      icone('sino', { tamanho: 15 }),
      'Ativar neste aparelho',
    );

    const botaoTeste = h(
      'button.btn.btn--secundario.btn--pequeno',
      {
        type: 'button',
        onclick: async (evento) => {
          ocupado(evento.currentTarget, true, 'Enviando…');
          try {
            const resposta = await api.post('/api/notificacoes/push/teste', {});
            toastSucesso(resposta.mensagem, { titulo: 'Teste enviado' });
          } catch (erro) {
            toastErro(erro.message, { titulo: 'Teste não enviado' });
          } finally {
            ocupado(evento.currentTarget, false);
          }
        },
      },
      'Enviar teste',
    );

    const botaoDesativar = h(
      'button.btn.btn--fantasma.btn--pequeno',
      {
        type: 'button',
        onclick: async (evento) => {
          ocupado(evento.currentTarget, true, 'Desativando…');
          try {
            await desativarPush();
            toast('Este aparelho não recebe mais avisos.', { tipo: 'aviso' });
            await aoMudar();
          } catch (erro) {
            toastErro(erro.message);
          } finally {
            ocupado(evento.currentTarget, false);
          }
        },
      },
      'Desativar neste aparelho',
    );

    return h(
      'div.card.card--plana',
      {},
      h(
        'div.card__corpo.pilha--pequena.pilha',
        {},
        h('div.linha.linha--entre', {}, titulo, badge),
        h('p.texto-mini.texto-suave', {}, explicacao),
        situacao.permissao === 'denied' && situacao.suportado
          ? faixaAviso('As notificações estão bloqueadas para este site. Libere em Configurações do navegador → Notificações.')
          : null,
        h(
          'div.grupo-botoes',
          {},
          situacao.inscrito ? botaoTeste : botaoAtivar,
          situacao.inscrito ? botaoDesativar : null,
        ),
      ),
    );
  }

  return modal;
}

// Mantém o título da aba coerente quando a página volta do histórico.
window.addEventListener('pageshow', () => {
  if (estado.iniciado) atualizarTitulo();
});
