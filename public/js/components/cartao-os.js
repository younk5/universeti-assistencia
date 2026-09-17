import { h } from '../dom.js';
import { icone } from '../icons.js';
import { badgeStatus } from '../ui.js';
import { quando, moeda, telefone } from '../format.js';
import { ROTULOS_TIPO_FOTO } from '../constantes.js';

export function cartaoOS(ordem, { mostrarLoja = false } = {}) {
  const cartao = h(
    `a.card-os.card-os--${ordem.status}`,
    {
      href: `#/ordens/${ordem.id}`,
      'aria-label': `Abrir OS ${ordem.numero_os} de ${ordem.cliente_nome}`,
    },
    h(
      'div.card-os__topo',
      {},
      h('span.card-os__numero', {}, ordem.numero_os),
      badgeStatus(ordem.status),
      h(
        'span.texto-mini.texto-fraco',
        { style: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '4px' } },
        icone('relogio', { tamanho: 13 }),
        quando(ordem.criado_em),
      ),
    ),
    h(
      'div',
      {},
      h('div.card-os__titulo', {}, ordem.cliente_nome),
      h(
        'div.card-os__meta',
        { style: { marginTop: '4px' } },
        h('span', {}, icone('dispositivo', { tamanho: 14 }), `${ordem.marca} ${ordem.modelo}`),
        ordem.cor ? h('span', {}, ordem.cor) : null,
        h('span', {}, icone('telefone', { tamanho: 14 }), telefone(ordem.cliente_telefone)),
        mostrarLoja ? h('span', {}, icone('loja', { tamanho: 14 }), ordem.loja_nome) : null,
      ),
    ),
    ordem.defeito_relatado ? h('p.card-os__defeito', {}, ordem.defeito_relatado) : null,
    h(
      'div.card-os__rodape',
      {},
      h(
        'div.linha.texto-mini.texto-suave',
        { style: { gap: '10px', flexWrap: 'wrap' } },
        ordem.tecnico_nome
          ? h('span.linha', { style: { gap: '4px' } }, icone('ferramenta', { tamanho: 13 }), ordem.tecnico_nome)
          : h('span.linha', { style: { gap: '4px' } }, icone('usuario', { tamanho: 13 }), 'Sem técnico'),
        ordem.valor ? h('span', {}, moeda(ordem.valor)) : null,
        ordem.total_fotos
          ? h('span.linha', { style: { gap: '4px' } }, icone('imagem', { tamanho: 13 }), `${ordem.total_fotos} foto(s)`)
          : h('span.linha.texto-fraco', { style: { gap: '4px' } }, icone('alerta', { tamanho: 13 }), 'Sem foto'),
      ),
      h('span.texto-fraco.linha', { style: { gap: '2px' } }, 'Abrir', icone('chevronDireita', { tamanho: 15 })),
    ),
  );
  return cartao;
}

export function linhaCompactaOS(ordem) {
  return h(
    'a.lista-compacta__item',
    { href: `#/ordens/${ordem.id}` },
    h(
      'div',
      { style: { minWidth: '0', flex: '1' } },
      h('div.lista-compacta__titulo', {}, ordem.cliente_nome),
      h(
        'div.texto-mini.texto-fraco.linha',
        { style: { gap: '6px', flexWrap: 'wrap', marginTop: '2px' } },
        h('span.texto-mono', {}, ordem.numero_os),
        h('span', {}, '·'),
        h('span', {}, `${ordem.marca} ${ordem.modelo}`),
        h('span', {}, '·'),
        h('span', {}, quando(ordem.criado_em)),
      ),
    ),
    badgeStatus(ordem.status),
  );
}

export function cartaoFoto(foto, indice, aoAbrir, { aoExcluir } = {}) {
  const conteudo = [
    h('img', { src: `/api/fotos/${foto.id}/raw`, alt: foto.legenda ?? `Foto de ${foto.tipo}`, loading: 'lazy' }),
    h('span.miniatura__selo', {}, ROTULOS_TIPO_FOTO[foto.tipo] ?? foto.tipo),
    h('span.miniatura__quando', {}, quando(foto.criado_em)),
  ];

  if (aoExcluir) {
    const excluir = (evento) => {
      evento.preventDefault();
      evento.stopPropagation();
      aoExcluir(foto);
    };
    conteudo.push(
      h(
        'span.miniatura__excluir',
        {
          role: 'button',
          tabindex: '0',
          title: 'Excluir anexo',
          'aria-label': `Excluir ${ROTULOS_TIPO_FOTO[foto.tipo] ?? 'anexo'}`,
          onclick: excluir,
          onkeydown: (evento) => {
            if (evento.key === 'Enter' || evento.key === ' ') excluir(evento);
          },
        },
        icone('x', { tamanho: 13 }),
      ),
    );
  }

  return h(
    'button.miniatura',
    {
      type: 'button',
      onclick: () => aoAbrir(indice),
      title: foto.legenda ?? `Foto de ${foto.tipo}`,
      'aria-label': `Ampliar foto de ${ROTULOS_TIPO_FOTO[foto.tipo] ?? foto.tipo}`,
    },
    ...conteudo,
  );
}
