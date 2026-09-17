import { h, montar } from './dom.js';
import { icone } from './icons.js';
import { store } from './store.js';
import { iniciais, iniciaisPapel } from './format.js';

const ITENS = [
  { id: 'painel', rota: '/painel', rotulo: 'Painel', icone: 'painel', permissao: null },
  { id: 'nova', rota: '/nova', rotulo: 'Nova OS', icone: 'nova', permissao: 'os.criar' },
  { id: 'fila', rota: '/fila', rotulo: 'Fila', icone: 'ferramenta', permissao: 'os.assumir', contador: 'aguardando' },
  { id: 'ordens', rota: '/ordens', rotulo: 'Ordens', icone: 'lista', permissao: 'os.ver' },
  { id: 'admin', rota: '/admin', rotulo: 'Gestão', icone: 'engrenagem', permissao: 'admin.lojas' },
];

function itensVisiveis() {
  return ITENS.filter((item) => !item.permissao || store.pode(item.permissao));
}

function contadorDe(item, estado) {
  if (!item.contador) return 0;
  const resumo = estado ?? store.resumo;
  return resumo?.status?.[item.contador] ?? 0;
}

/**
 * Atualiza os contadores da navegação sem redesenhar o shell.
 * O resumo chega depois da primeira pintura; assim o badge aparece sozinho.
 */
export function atualizarBadges() {
  for (const elemento of document.querySelectorAll('[data-badge-status]')) {
    const status = elemento.dataset.badgeStatus;
    const total = store.resumo?.status?.[status] ?? 0;
    if (total > 0) {
      elemento.textContent = total > 99 ? '99+' : String(total);
      elemento.classList.remove('oculto');
    } else {
      elemento.classList.add('oculto');
    }
  }
}

function tituloDaRota(rota) {
  if (rota.startsWith('/ordens/')) return 'Detalhe da OS';
  const item = ITENS.find((i) => rota.startsWith(i.rota));
  if (item) return item.rotulo;
  if (rota.startsWith('/perfil')) return 'Minha conta';
  return 'UniverseTI Assistência';
}

let containerConteudo = null;

/**
 * Desenha o "chrome" da aplicação (sidebar, topbar, navegação inferior) e
 * devolve o elemento onde a página deve renderizar seu conteúdo.
 */
export function montarLayout(rota) {
  const raiz = document.getElementById('app');
  const usuario = store.usuario;
  const itens = itensVisiveis();

  const sidebar = h(
    'aside.sidebar',
    {},
    h(
      'div.sidebar__marca',
      {},
      h('div.sidebar__logo', {}, 'UT'),
      h(
        'div',
        { style: { minWidth: '0' } },
        h('div.sidebar__nome', {}, 'UniverseTI Assistência'),
        h('div.sidebar__sub', {}, store.ehAdmin ? 'Todas as lojas' : (usuario?.lojaNome ?? 'Sem loja')),
      ),
    ),
    h(
      'nav.sidebar__nav',
      { 'aria-label': 'Navegação principal' },
      ...itens.map((item) => {
        const contador = contadorDe(item);
        return h(
          'a.sidebar__link',
          {
            href: `#${item.rota}`,
            'aria-current': rota.startsWith(item.rota) ? 'page' : null,
          },
          icone(item.icone, { tamanho: 19 }),
          item.rotulo,
          item.contador
            ? h(
                `span.sidebar__link-contador${contador > 0 ? '' : '.oculto'}`,
                { dataset: { badgeStatus: item.contador } },
                contador > 0 ? String(contador) : '',
              )
            : null,
        );
      }),
    ),
    h(
      'div.sidebar__rodape',
      {},
      h(
        'button.sidebar__link',
        { type: 'button', onclick: () => abrirMenuConta() },
        h('span.avatar', { style: { width: '26px', height: '26px', fontSize: '0.68rem' } }, iniciais(usuario?.nome)),
        h(
          'span',
          { style: { minWidth: '0' } },
          h('div.texto-truncar', { style: { fontWeight: '620' } }, usuario?.nome ?? ''),
          h('div.texto-mini.texto-fraco', {}, iniciaisPapel(usuario?.papel)),
        ),
      ),
    ),
  );

  const topbar = h(
    'header.topbar',
    {},
    h(
      'div.topbar__marca',
      {},
      h('div.topbar__logo', {}, 'UT'),
      h(
        'div',
        { style: { minWidth: '0' } },
        h('div.topbar__titulo', {}, tituloDaRota(rota)),
        h(
          'div.topbar__loja',
          {},
          store.ehAdmin ? 'Administrador · todas as lojas' : (usuario?.lojaNome ?? 'Sem loja vinculada'),
        ),
      ),
    ),
    h(
      'div.topbar__acoes',
      {},
      h(
        'button.btn.btn--icone',
        {
          type: 'button',
          'aria-label': 'Alternar tema claro/escuro',
          title: 'Alternar tema claro/escuro',
          onclick: (evento) => {
            const tema = store.alternarTema();
            const botao = evento.currentTarget;
            botao.replaceChildren(icone(tema === 'escuro' ? 'sol' : 'lua', { tamanho: 19 }));
            botao.setAttribute('aria-label', tema === 'escuro' ? 'Ativar tema claro' : 'Ativar tema escuro');
          },
        },
        icone(store.tema === 'escuro' ? 'sol' : 'lua', { tamanho: 19 }),
      ),
      h(
        'button.btn.btn--icone',
        { type: 'button', 'aria-label': 'Minha conta', onclick: () => abrirMenuConta() },
        h('span.avatar', { style: { width: '30px', height: '30px', fontSize: '0.72rem' } }, iniciais(usuario?.nome)),
      ),
    ),
  );

  const bottomnav = h(
    'nav.bottomnav',
    { 'aria-label': 'Navegação principal' },
    ...itens.map((item) => {
      const contador = contadorDe(item);
      return h(
        'a.bottomnav__item',
        {
          href: `#${item.rota}`,
          'aria-current': rota.startsWith(item.rota) ? 'page' : null,
          style: { position: 'relative' },
        },
        icone(item.icone, { tamanho: 22 }),
        item.rotulo,
        item.contador
          ? h(
              `span.bottomnav__badge${contador > 0 ? '' : '.oculto'}`,
              { dataset: { badgeStatus: item.contador } },
              contador > 0 ? (contador > 99 ? '99+' : String(contador)) : '',
            )
          : null,
      );
    }),
  );

  containerConteudo = h('main.conteudo', { id: 'conteudo' });

  montar(raiz, h('div', { style: { display: 'contents' } }, sidebar), topbar, containerConteudo, bottomnav);

  if (store.ehAdmin === false && !usuario?.lojaId) {
    containerConteudo.append(
      h(
        'div.faixa-aviso',
        { style: { marginBottom: '16px' } },
        icone('alerta', { tamanho: 18 }),
        h('span', {}, 'Sua conta não está vinculada a uma loja. Peça ao administrador para corrigir o cadastro.'),
      ),
    );
  }

  if (window.matchMedia('(min-width: 960px)').matches) raiz.firstElementChild?.focus?.();
  return containerConteudo;
}

export function obterConteudo() {
  return containerConteudo ?? document.getElementById('conteudo');
}

/* -------------------------------------------------------------------------- */
/* Menu da conta                                                               */
/* -------------------------------------------------------------------------- */

let menuAberto = null;

export async function abrirMenuConta() {
  if (menuAberto) return;
  const { abrirPerfil } = await import('./pages/perfil.js');
  menuAberto = abrirPerfil({
    aoFechar: () => {
      menuAberto = null;
    },
  });
}

// Sempre que o resumo da rede muda, os contadores da navegação acompanham.
store.assinar(() => atualizarBadges());
