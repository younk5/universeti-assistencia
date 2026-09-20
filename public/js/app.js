import { store } from './store.js';
import { api, ErroApi, definirTratadorDeSessao } from './api.js';
import { Roteador } from './router.js';
import { montarLayout, atualizarBadges } from './layout.js';
import { monitorarConexao, toastErro, toastAviso } from './ui.js';
import { icone } from './icons.js';
import { h, montar } from './dom.js';

import { montarLogin } from './pages/login.js';
import { montarRastreio } from './pages/rastreio.js';
import { montarAprovacao } from './pages/aprovacao.js';
import { paginaDashboard } from './pages/painel.js';
import { paginaNovaOS } from './pages/nova-os.js';
import { paginaFila } from './pages/fila.js';
import { paginaOrdens } from './pages/ordens.js';
import { paginaOSDetalhe } from './pages/os-detalhe.js';
import { paginaAdmin } from './pages/admin.js';
import { abrirPerfil } from './pages/perfil.js';

const ROTAS = [
  { padrao: '/login', montar: () => montarLogin(), publica: true },
  { padrao: '/rastreio', montar: (c, p) => montarRastreio(p), publica: true },
  { padrao: '/rastreio/:numero', montar: (c, p) => montarRastreio(p), publica: true },
  { padrao: '/aprovacao/:token', montar: (c, p) => montarAprovacao(p), publica: true },
  { padrao: '/painel', montar: (c) => paginaDashboard(c), permissao: 'os.ver' },
  { padrao: '/nova', montar: (c) => paginaNovaOS(c), permissao: 'os.criar' },
  { padrao: '/fila', montar: (c) => paginaFila(c), permissao: 'os.ver' },
  { padrao: '/ordens', montar: (c) => paginaOrdens(c), permissao: 'os.ver' },
  { padrao: '/ordens/:id/finalizar', montar: (c, p) => paginaOSDetalhe(c, { ...p, acao: 'finalizar' }), permissao: 'os.ver' },
  { padrao: '/ordens/:id', montar: (c, p) => paginaOSDetalhe(c, p), permissao: 'os.ver' },
  { padrao: '/admin', montar: (c) => paginaAdmin(c), permissao: 'admin.lojas' },
  { padrao: '/perfil', montar: null, permissao: null },
];

const roteador = new Roteador();
for (const rota of ROTAS) roteador.registrar(rota.padrao, rota.montar);

const rotaPorPadrao = new Map(ROTAS.map((r) => [r.padrao, r]));

let rotaAtual = '/painel';
let renderizando = false;

function resolver(hash) {
  const alvo = roteador.resolver(hash);
  if (!alvo) return null;
  return { ...alvo, rota: rotaPorPadrao.get(alvo.padrao) };
}

function irPara(caminho) {
  const destino = caminho.startsWith('/') ? caminho : `/${caminho}`;
  if (window.location.hash === `#${destino}`) {
    renderizar();
    return;
  }
  window.location.hash = destino;
}

async function renderizar() {
  if (renderizando) return;
  renderizando = true;
  try {
    const alvo = resolver(window.location.hash || '#/painel');

    if (!alvo) {
      irPara(store.usuario ? '/painel' : '/login');
      return;
    }

    if (!alvo.rota.publica && !store.usuario) {
      irPara('/login');
      return;
    }

    if (alvo.rota.publica) {
      // Páginas públicas (login, rastreio, aprovação de orçamento) montam a
      // própria tela e não usam o layout interno. Só o login redireciona quem
      // já está logado; rastreio/aprovação continuam acessíveis.
      if (alvo.rota.padrao === '/login' && store.usuario) {
        irPara('/painel');
        return;
      }
      rotaAtual = alvo.caminho;
      document.title = tituloPublico(alvo.rota.padrao);
      await alvo.rota.montar(null, alvo.params);
      return;
    }

    if (alvo.rota.padrao === '/perfil') {
      // "Minha conta" é um modal: abre sobre a tela atual e devolve a URL
      // original ao fechar, sem recarregar a página por baixo.
      const anterior = rotaAtual && rotaAtual !== '/perfil' ? rotaAtual : '/painel';
      abrirPerfil({
        aoFechar: () => {
          window.history.replaceState(null, '', `#${anterior}`);
          rotaAtual = anterior;
        },
      });
      return;
    }

    if (alvo.rota.permissao && !store.pode(alvo.rota.permissao)) {
      mostrarSemPermissao(alvo.rota.padrao);
      return;
    }

    rotaAtual = alvo.caminho;
    document.title = `${titulo(alvo.caminho)} · UniverseTI Assistência`;

    const container = montarLayout(alvo.caminho);
    atualizarResumo();

    try {
      await alvo.rota.montar(container, alvo.params);
    } catch (erro) {
      console.error('[pagina] falha ao renderizar', erro);
      montar(
        container,
        h(
          'div.card',
          {},
          h(
            'div.card__corpo.pilha',
            {},
            h('h2', {}, 'Esta tela não pôde ser exibida'),
            h('p.texto-suave', {}, erro.message ?? 'Erro inesperado ao montar a página.'),
            h(
              'button.btn.btn--primario',
              { type: 'button', onclick: () => window.location.reload() },
              icone('recarregar', { tamanho: 16 }),
              'Recarregar o sistema',
            ),
          ),
        ),
      );
    }

    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  } finally {
    renderizando = false;
  }
}

function titulo(caminho) {
  if (caminho.startsWith('/ordens/')) return 'Detalhe da OS';
  const nomes = {
    '/painel': 'Painel',
    '/nova': 'Nova OS',
    '/fila': 'Fila de atendimento',
    '/ordens': 'Ordens de serviço',
    '/admin': 'Gestão',
  };
  return nomes[caminho] ?? 'UniverseTI Assistência';
}

function tituloPublico(padrao) {
  if (String(padrao).startsWith('/rastreio')) return 'Acompanhar minha OS · UniverseTI Assistência';
  if (String(padrao).startsWith('/aprovacao')) return 'Aprovar orçamento · UniverseTI Assistência';
  return 'Entrar · UniverseTI Assistência';
}

function mostrarSemPermissao(padrao) {
  const container = montarLayout('/painel');
  montar(
    container,
    h(
      'div.card',
      {},
      h(
        'div.card__corpo.pilha',
        {},
        h('h2', {}, 'Sem permissão para esta tela'),
        h('p.texto-suave', {}, `O perfil "${store.papel}" não tem acesso a ${padrao}. Fale com o administrador se precisar deste recurso.`),
        h('a.btn.btn--primario', { href: '#/painel' }, 'Voltar ao painel'),
      ),
    ),
  );
}

async function atualizarResumo() {
  try {
    const dados = await api.get('/api/resumo');
    store.definirResumo({ status: dados.status });
    atualizarBadges();
  } catch {
    /* contadores são opcionais: a navegação segue funcionando */
  }
}

definirTratadorDeSessao(() => {
  if (store.usuario) {
    store.limparSessao();
    toastAviso('Sua sessão expirou. Entre novamente para continuar.', { titulo: 'Sessão encerrada' });
    setTimeout(() => irPara('/login'), 400);
  }
});

window.addEventListener('hashchange', () => renderizar());
window.addEventListener('unhandledrejection', (evento) => {
  if (evento.reason instanceof ErroApi) return;
  console.error('[promise]', evento.reason);
});

// Atalho: Ctrl/Cmd + K foca a busca de OS.
window.addEventListener('keydown', (evento) => {
  if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'k') {
    evento.preventDefault();
    if (!window.location.hash.startsWith('#/ordens')) irPara('/ordens');
    setTimeout(() => document.querySelector('input[type="search"]')?.focus(), 220);
  }
});

async function iniciar() {
  monitorarConexao();
  if (!('hash' in window)) console.warn('[router] navegador sem suporte a hash routing');
  if (!window.location.hash) {
    window.history.replaceState(null, '', '#/painel');
  }

  const usuario = await store.carregarSessao();
  if (usuario) {
    await store.carregarMeta();
    const jaTinhaTema = store.tema;
    document.documentElement.setAttribute('data-tema', jaTinhaTema);
  }

  const splash = document.getElementById('boot-splash');
  splash?.remove();

  await renderizar();
}

iniciar().catch((erro) => {
  console.error('[app] falha na inicialização', erro);
  const raiz = document.getElementById('app');
  if (!raiz) return;
  montar(
    raiz,
    h(
      'div.vazio',
      { style: { minHeight: '100dvh', placeContent: 'center' } },
      h('div.vazio__icone', {}, icone('alerta', { tamanho: 28 })),
      h('div.vazio__titulo', {}, 'Não foi possível iniciar o sistema'),
      h('p.vazio__texto', {}, erro.message ?? 'Erro inesperado.'),
      h(
        'button.btn.btn--primario',
        { type: 'button', onclick: () => window.location.reload() },
        icone('recarregar', { tamanho: 16 }),
        'Tentar novamente',
      ),
    ),
  );
  toastErro('Falha ao iniciar. Recarregue a página.');
});
