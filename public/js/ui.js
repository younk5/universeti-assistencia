import { h, montar } from './dom.js';
import { icone } from './icons.js';
import { dataHora } from './format.js';
import { ROTULOS_STATUS } from './constantes.js';

/* -------------------------------------------------------------------------- */
/* Toasts                                                                      */
/* -------------------------------------------------------------------------- */

const hostToasts = () => document.getElementById('toasts');

const ICONE_POR_TIPO = {
  sucesso: 'check',
  erro: 'alerta',
  aviso: 'alerta',
  info: 'info',
};

export function toast(mensagem, { tipo = 'info', titulo = null, duracao = 4200 } = {}) {
  const host = hostToasts();
  if (!host) return () => {};

  const elemento = h(
    `div.toast.toast--${tipo}`,
    { role: 'alert' },
    h('span.toast__icone', {}, icone(ICONE_POR_TIPO[tipo] ?? 'info', { tamanho: 18 })),
    h(
      'div',
      { style: { minWidth: '0', flex: '1' } },
      titulo ? h('div.toast__titulo', {}, titulo) : null,
      h('div.toast__texto', {}, mensagem),
    ),
    h(
      'button.toast__fechar',
      { type: 'button', 'aria-label': 'Fechar aviso', onclick: () => fechar() },
      icone('x', { tamanho: 15 }),
    ),
  );

  host.append(elemento);
  let timer = duracao > 0 ? setTimeout(() => fechar(), duracao) : null;

  function fechar() {
    if (timer) clearTimeout(timer);
    if (!elemento.isConnected) return;
    elemento.classList.add('toast--saindo');
    setTimeout(() => elemento.remove(), 190);
  }

  elemento.addEventListener('pointerenter', () => {
    if (timer) clearTimeout(timer);
  });
  elemento.addEventListener('pointerleave', () => {
    timer = setTimeout(() => fechar(), 1800);
  });

  return fechar;
}

export const toastSucesso = (msg, opcoes) => toast(msg, { ...opcoes, tipo: 'sucesso' });
export const toastErro = (msg, opcoes) => toast(msg, { ...opcoes, tipo: 'erro', duracao: 6500 });
export const toastAviso = (msg, opcoes) => toast(msg, { ...opcoes, tipo: 'aviso' });

/* -------------------------------------------------------------------------- */
/* Modais                                                                      */
/* -------------------------------------------------------------------------- */

const hostModais = () => document.getElementById('modais');

let modaisAbertos = 0;

export function abrirModal({
  titulo,
  descricao = null,
  corpo = null,
  rodape = null,
  largura = null,
  fecharAoClicarFora = true,
  aoFechar = null,
} = {}) {
  const host = hostModais();
  const anterior = document.activeElement;

  const caixa = h(
    'div.modal',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo ?? 'Diálogo' },
    h('div.modal__puxador'),
    h(
      'div.modal__cabecalho',
      {},
      h(
        'div.modal__titulo-area',
        {},
        h('h2', {}, titulo ?? ''),
        descricao ? h('p.texto-pequeno.texto-suave', {}, descricao) : null,
      ),
      h(
        'button.modal__fechar',
        { type: 'button', 'aria-label': 'Fechar', onclick: () => fechar() },
        icone('x', { tamanho: 17 }),
      ),
    ),
    h('div.modal__corpo', {}, corpo),
    rodape ? h('div.modal__rodape', {}, rodape) : null,
  );

  if (largura) caixa.style.maxWidth = largura;

  const fundo = h('div.modal-fundo', {
    onclick: (evento) => {
      if (fecharAoClicarFora && evento.target === fundo) fechar();
    },
  }, caixa);

  host.append(fundo);
  modaisAbertos += 1;
  document.body.style.overflow = 'hidden';

  const aoTeclar = (evento) => {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      fechar();
    }
    if (evento.key === 'Tab') {
      const focaveis = caixa.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focaveis.length) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (evento.shiftKey && document.activeElement === primeiro) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
    }
  };

  document.addEventListener('keydown', aoTeclar);

  const primeiroCampo = caixa.querySelector('input, textarea, select, button');
  setTimeout(() => primeiroCampo?.focus?.(), 60);

  let fechado = false;
  function fechar(resultado) {
    if (fechado) return;
    fechado = true;
    document.removeEventListener('keydown', aoTeclar);
    modaisAbertos = Math.max(0, modaisAbertos - 1);
    if (modaisAbertos === 0) document.body.style.overflow = '';
    fundo.remove();
    anterior?.focus?.();
    aoFechar?.(resultado);
  }

  return { fechar, caixa, corpo: caixa.querySelector('.modal__corpo') };
}

export function confirmar({
  titulo,
  mensagem,
  textoConfirmar = 'Confirmar',
  textoCancelar = 'Cancelar',
  perigoso = false,
  detalhes = null,
}) {
  return new Promise((resolve) => {
    let respondido = false;
    const responder = (valor) => {
      respondido = true;
      resolve(valor);
    };

    const botaoConfirmar = h(
      `button.btn.${perigoso ? 'btn--perigo' : 'btn--primario'}`,
      { type: 'button', onclick: () => { responder(true); modal.fechar(); } },
      textoConfirmar,
    );

    const modal = abrirModal({
      titulo,
      corpo: [
        h('p', { style: { lineHeight: '1.6' } }, mensagem),
        detalhes ? h('div.card.card--plana', {}, h('div.card__corpo', {}, detalhes)) : null,
      ],
      rodape: [
        h('button.btn.btn--secundario', { type: 'button', onclick: () => { responder(false); modal.fechar(); } }, textoCancelar),
        botaoConfirmar,
      ],
      fecharAoClicarFora: false,
      aoFechar: () => {
        if (!respondido) responder(false);
      },
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Badges e rótulos                                                            */
/* -------------------------------------------------------------------------- */

export function badgeStatus(status, { pequeno = false } = {}) {
  return h(
    `span.badge.badge--${status}`,
    { title: ROTULOS_STATUS[status] ?? status, style: pequeno ? { fontSize: '0.68rem' } : null },
    ROTULOS_STATUS[status] ?? status,
  );
}

/* -------------------------------------------------------------------------- */
/* Estados de carregamento / vazio / erro                                      */
/* -------------------------------------------------------------------------- */

export function esqueletoCartao(linhas = 3) {
  return h(
    'div.card',
    {},
    h(
      'div.card__corpo.pilha',
      {},
      h('div.esqueleto', { style: { height: '18px', width: '42%' } }),
      ...Array.from({ length: linhas }, (_, i) =>
        h('div.esqueleto', { style: { height: '12px', width: i === linhas - 1 ? '62%' : '88%' } }),
      ),
    ),
  );
}

export function esqueletoLista(quantidade = 4) {
  return h('div.pilha', {}, ...Array.from({ length: quantidade }, () => esqueletoCartao(2)));
}

export function estadoVazio({ icone: nome = 'caixa', titulo, texto, acao = null }) {
  return h(
    'div.vazio',
    {},
    h('div.vazio__icone', {}, icone(nome, { tamanho: 28 })),
    h('div', {}, h('div.vazio__titulo', {}, titulo), texto ? h('p.vazio__texto', {}, texto) : null),
    acao,
  );
}

export function faixaErro(mensagem, { titulo = 'Não foi possível carregar', aoTentar = null } = {}) {
  return h(
    'div.faixa-erro',
    { role: 'alert' },
    h('span.faixa-erro__icone', {}, icone('alerta', { tamanho: 20 })),
    h(
      'div',
      { style: { flex: '1', minWidth: '0' } },
      h('div.faixa-erro__titulo', {}, titulo),
      h('div.faixa-erro__texto', {}, mensagem),
      aoTentar
        ? h(
            'button.btn.btn--pequeno',
            { type: 'button', style: { marginTop: '10px' }, onclick: aoTentar },
            icone('recarregar', { tamanho: 14 }),
            'Tentar novamente',
          )
        : null,
    ),
  );
}

export function faixaAviso(mensagem) {
  return h(
    'div.faixa-aviso',
    {},
    icone('alerta', { tamanho: 18 }),
    h('span', { style: { flex: '1' } }, mensagem),
  );
}

/** Coloca/retira um botão em estado de carregamento preservando o rótulo. */
export function ocupado(botao, ativo, rotuloOcupado = null) {
  if (!botao) return;
  if (ativo) {
    if (!botao.dataset.rotuloOriginal) botao.dataset.rotuloOriginal = botao.innerHTML;
    botao.disabled = true;
    botao.setAttribute('aria-busy', 'true');
    montar(
      botao,
      h('span.btn__spinner'),
      rotuloOcupado ?? 'Aguarde…',
    );
  } else {
    botao.disabled = false;
    botao.removeAttribute('aria-busy');
    if (botao.dataset.rotuloOriginal) {
      botao.innerHTML = botao.dataset.rotuloOriginal;
      delete botao.dataset.rotuloOriginal;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Visualizador de fotos em tela cheia                                         */
/* -------------------------------------------------------------------------- */

export function visualizarFotos(fotos, indiceInicial = 0) {
  if (!fotos?.length) return;
  let indice = Math.max(0, Math.min(indiceInicial, fotos.length - 1));
  const focoAnterior = document.activeElement;

  const imagem = h('img', { alt: '' });
  const legenda = h('div.visualizador__rodape');
  const titulo = h('div.texto-forte');
  const contador = h('div.texto-mini', { style: { opacity: 0.7 }, 'aria-live': 'polite' });

  function atualizar() {
    const foto = fotos[indice];
    imagem.src = `/api/fotos/${foto.id}/raw`;
    imagem.alt = foto.legenda ?? `Foto de ${foto.tipo}`;
    const autor = foto.usuario_nome ? ` · ${foto.usuario_nome}` : '';
    legenda.textContent = `${dataHora(foto.criado_em)}${autor}`;
    titulo.textContent = foto.legenda ?? `Foto de ${foto.tipo}`;
    contador.textContent = `${indice + 1} de ${fotos.length}`;
  }

  const anterior = h('button.btn.btn--icone', { type: 'button', style: { color: '#fff' }, 'aria-label': 'Foto anterior', onclick: () => ir(-1) }, icone('chevronEsquerda', { tamanho: 20 }));
  const proximo = h('button.btn.btn--icone', { type: 'button', style: { color: '#fff' }, 'aria-label': 'Próxima foto', onclick: () => ir(1) }, icone('chevronDireita', { tamanho: 20 }));

  function ir(passo) {
    indice = (indice + passo + fotos.length) % fotos.length;
    atualizar();
  }

  const botaoFechar = h(
    'button.btn.btn--icone',
    { type: 'button', style: { color: '#fff' }, 'aria-label': 'Fechar', onclick: () => fechar() },
    icone('x', { tamanho: 20 }),
  );

  const camada = h(
    'div.visualizador',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Visualizador de fotos' },
    h(
      'div.visualizador__topo',
      {},
      h('div', {}, titulo, contador),
      botaoFechar,
    ),
    h(
      'div.visualizador__imagem',
      { onclick: (e) => { if (e.target === e.currentTarget) fechar(); } },
      imagem,
    ),
    h('div', { style: { display: 'flex', justifyContent: 'center', gap: '12px' } },
      fotos.length > 1 ? anterior : null,
      fotos.length > 1 ? proximo : null,
    ),
    legenda,
  );

  function aoTeclar(evento) {
    if (evento.key === 'Escape') fechar();
    if (evento.key === 'ArrowLeft') ir(-1);
    if (evento.key === 'ArrowRight') ir(1);
  }

  function fechar() {
    document.removeEventListener('keydown', aoTeclar);
    camada.remove();
    document.body.style.overflow = '';
    focoAnterior?.focus?.();
  }

  document.addEventListener('keydown', aoTeclar);
  document.body.style.overflow = 'hidden';
  document.body.append(camada);
  atualizar();
  botaoFechar.focus();
}

/* -------------------------------------------------------------------------- */
/* Aviso de conexão                                                            */
/* -------------------------------------------------------------------------- */

export function monitorarConexao() {
  const mostrar = () => {
    if (navigator.onLine) return;
    toast(
      'Você está sem internet. As telas já carregadas continuam visíveis, mas salvar e enviar fotos vai falhar até a conexão voltar.',
      { tipo: 'aviso', titulo: 'Sem conexão', duracao: 0 },
    );
  };
  window.addEventListener('offline', mostrar);
  window.addEventListener('online', () => {
    toast('Conexão restabelecida.', { tipo: 'sucesso', titulo: 'Online', duracao: 2600 });
  });
}
