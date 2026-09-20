import { h, montar, debounce } from '../dom.js';
import { icone } from '../icons.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { cartaoOS } from '../components/cartao-os.js';
import { esqueletoLista, faixaErro, estadoVazio, toastErro, toastSucesso } from '../ui.js';
import { numero } from '../format.js';
import { ORDEM_STATUS, ROTULOS_STATUS } from '../constantes.js';
import { analisarRota } from '../router.js';

const PAGINA = 30;

const filtros = {
  busca: '',
  status: 'todos',
  lojaId: '',
  tecnicoId: '',
  de: '',
  ate: '',
};

export async function paginaOrdens(container) {
  const rota = analisarRota();
  if (rota.query.get('status')) filtros.status = rota.query.get('status');
  if (rota.query.get('busca')) filtros.busca = rota.query.get('busca');

  let itens = [];
  let total = 0;
  let deslocamento = 0;
  let carregando = false;
  let primeiroCarregamento = true;
  let erro = null;
  let mostrarAvancado = Boolean(filtros.tecnicoId || filtros.de || filtros.ate);

  const campoBusca = h('input.entrada', {
    type: 'search',
    placeholder: 'Buscar por OS, cliente, telefone, modelo ou IMEI…',
    value: filtros.busca,
    'aria-label': 'Buscar ordens de serviço',
  });

  const campoLoja = store.escopoRede && (store.meta?.lojas ?? []).length
    ? h('select.selecao', { 'aria-label': 'Loja' },
        h('option', { value: '' }, 'Todas as lojas'),
        ...store.meta.lojas.map((l) => h('option', { value: String(l.id), selected: filtros.lojaId === String(l.id) }, l.nome)))
    : null;

  const campoTecnico = store.meta?.tecnicos?.length
    ? h('select.selecao', { 'aria-label': 'Técnico responsável' },
        h('option', { value: '' }, 'Todos os técnicos'),
        ...store.meta.tecnicos.map((t) => h('option', { value: String(t.id), selected: filtros.tecnicoId === String(t.id) }, t.nome)))
    : null;

  const campoDe = h('input.entrada', { type: 'date', value: filtros.de, 'aria-label': 'Entrada a partir de' });
  const campoAte = h('input.entrada', { type: 'date', value: filtros.ate, 'aria-label': 'Entrada até' });

  const areaChips = h('div.faixa-chips');
  const areaLista = h('div');
  const areaRodape = h('div.pilha');

  const areaAvancado = h('div.filtros.filtros--avancado' + (mostrarAvancado ? '' : '.oculto'), {},
    campoTecnico ? h('div.campo', {}, h('label.campo__rotulo', {}, 'Técnico'), campoTecnico) : null,
    h('div.campo', {}, h('label.campo__rotulo', {}, 'Entrada de'), campoDe),
    h('div.campo', {}, h('label.campo__rotulo', {}, 'até'), campoAte),
  );

  const botaoAvancado = h(
    'button.btn.btn--fantasma.btn--pequeno',
    {
      type: 'button',
      onclick: () => {
        mostrarAvancado = !mostrarAvancado;
        areaAvancado.classList.toggle('oculto', !mostrarAvancado);
        botaoAvancado.replaceChildren(
          icone('filtro', { tamanho: 15 }),
          mostrarAvancado ? 'Ocultar filtros avançados' : 'Mais filtros',
        );
      },
    },
    icone('filtro', { tamanho: 15 }),
    mostrarAvancado ? 'Ocultar filtros avançados' : 'Mais filtros',
  );

  montar(
    container,
    h(
      'div',
      {},
      h(
        'div.pagina-cabecalho',
        {},
        h(
          'div.pagina-cabecalho__titulo',
          {},
          h('h1', {}, 'Ordens de serviço'),
          h('p.pagina-cabecalho__desc', {}, 'Histórico completo, com busca por cliente, aparelho e número da OS'),
        ),
        h(
          'div.pagina-cabecalho__acoes',
          {},
          h(
            'button.btn.btn--secundario',
            {
              type: 'button',
              onclick: async () => {
                try {
                  const nome = await api.baixar('/api/relatorios/ordens.csv', montarParametros());
                  toastSucesso(`Arquivo ${nome} gerado.`, { titulo: 'Exportação concluída' });
                } catch (erro) {
                  toastErro(erro.message);
                }
              },
            },
            icone('download', { tamanho: 16 }),
            'Exportar CSV',
          ),
          store.pode('os.criar') ? h('a.btn.btn--primario', { href: '#/nova' }, icone('nova', { tamanho: 16 }), 'Nova OS') : null,
        ),
      ),
      h(
        'div.filtros',
        {},
        h(
          'div.campo-com-icone',
          {},
          h('span.campo-com-icone__icone', {}, icone('busca', { tamanho: 17 })),
          campoBusca,
        ),
        campoLoja ? h('div.campo', {}, campoLoja) : null,
        h('div.campo', {}, h('label.campo__rotulo', {}, '\u00a0'), botaoAvancado),
        h(
          'div.campo',
          {},
          h('label.campo__rotulo', {}, '\u00a0'),
          h(
            'button.btn.btn--secundario.btn--bloco',
            {
              type: 'button',
              onclick: () => {
                Object.assign(filtros, { busca: '', status: 'todos', lojaId: '', tecnicoId: '', de: '', ate: '' });
                campoBusca.value = '';
                if (campoLoja) campoLoja.value = '';
                if (campoTecnico) campoTecnico.value = '';
                campoDe.value = '';
                campoAte.value = '';
                carregar();
              },
            },
            icone('filtroX', { tamanho: 15 }),
            'Limpar',
          ),
        ),
      ),
      areaAvancado,
      areaChips,
      areaLista,
      areaRodape,
    ),
  );

  const buscaAdiada = debounce(() => {
    filtros.busca = campoBusca.value.trim();
    carregar();
  }, 340);

  campoBusca.addEventListener('input', buscaAdiada);
  campoBusca.addEventListener('search', () => {
    filtros.busca = campoBusca.value.trim();
    carregar();
  });
  campoLoja?.addEventListener('change', () => {
    filtros.lojaId = campoLoja.value;
    carregar();
  });
  campoTecnico?.addEventListener('change', () => {
    filtros.tecnicoId = campoTecnico.value;
    carregar();
  });
  campoDe.addEventListener('change', () => {
    filtros.de = campoDe.value;
    carregar();
  });
  campoAte.addEventListener('change', () => {
    filtros.ate = campoAte.value;
    carregar();
  });

  function montarParametros() {
    return {
      busca: filtros.busca,
      status: filtros.status === 'todos' ? '' : filtros.status,
      lojaId: filtros.lojaId,
      tecnicoId: filtros.tecnicoId,
      de: filtros.de,
      ate: filtros.ate,
    };
  }

  await carregar();

  async function carregar({ acumular = false } = {}) {
    if (carregando) return;
    carregando = true;
    erro = null;
    if (!acumular) {
      deslocamento = 0;
      itens = [];
    }
    desenharChips();
    montar(areaLista, esqueletoLista(acumular ? 1 : 3));

    try {
      const resposta = await api.get('/api/ordens', {
        ...montarParametros(),
        limite: PAGINA,
        offset: deslocamento,
      });
      total = resposta.total;
      itens = acumular ? [...itens, ...resposta.itens] : resposta.itens;
      deslocamento += resposta.itens.length;
    } catch (e) {
      erro = e.message;
    } finally {
      carregando = false;
      primeiroCarregamento = false;
      desenhar();
    }
  }

  function desenharChips() {
    const contadores = store.resumo?.status ?? {};
    montar(
      areaChips,
      chipStatus('todos', 'Todas', null),
      ...ORDEM_STATUS.map((s) => chipStatus(s, ROTULOS_STATUS[s], contadores[s])),
    );
  }

  function chipStatus(valor, rotulo, contador) {
    return h(
      'button.chip',
      {
        type: 'button',
        'aria-pressed': filtros.status === valor ? 'true' : 'false',
        onclick: () => {
          filtros.status = valor;
          desenharChips();
          carregar();
        },
      },
      rotulo,
      contador != null ? h('span.chip__contador', {}, String(contador)) : null,
    );
  }

  function desenhar() {
    if (erro) {
      montar(areaLista, faixaErro(erro, { aoTentar: () => carregar() }));
      montar(areaRodape);
      return;
    }

    if (!itens.length) {
      montar(
        areaLista,
        h(
          'div.card',
          {},
          estadoVazio({
            icone: 'busca',
            titulo: primeiroCarregamento ? 'Carregando…' : 'Nenhuma OS encontrada',
            texto:
              'Nada corresponde a esses filtros. Tente limpar a busca, ampliar o período ou trocar o status selecionado.',
            acao: h(
              'button.btn.btn--secundario',
              {
                type: 'button',
                onclick: () => {
                  Object.assign(filtros, { busca: '', status: 'todos', lojaId: '', tecnicoId: '', de: '', ate: '' });
                  campoBusca.value = '';
                  if (campoLoja) campoLoja.value = '';
                  if (campoTecnico) campoTecnico.value = '';
                  campoDe.value = '';
                  campoAte.value = '';
                  carregar();
                },
              },
              'Limpar filtros',
            ),
          }),
        ),
      );
      montar(areaRodape);
      return;
    }

    montar(
      areaLista,
      h(
        'div.pilha--pequena.pilha',
        {},
        h(
          'div.linha.linha--entre',
          {},
          h('span.texto-pequeno.texto-suave', {}, `${numero(total)} ordem(ns) encontrada(s) · exibindo ${numero(itens.length)}`),
        ),
        h('div.grade--2.grade', {}, ...itens.map((ordem) => cartaoOS(ordem, { mostrarLoja: store.escopoRede }))),
      ),
    );

    montar(
      areaRodape,
      itens.length < total
        ? h(
            'button.btn.btn--secundario.btn--bloco',
            {
              type: 'button',
              onclick: async (evento) => {
                const botao = evento.currentTarget;
                botao.disabled = true;
                botao.textContent = 'Carregando…';
                await carregar({ acumular: true });
              },
            },
            `Carregar mais (${numero(total - itens.length)} restantes)`,
          )
        : h('p.texto-mini.texto-fraco.texto-central', {}, 'Fim da lista.'),
    );
  }

  return { recarregar: carregar };
}

export { filtros };
