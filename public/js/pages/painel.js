import { h, montar } from '../dom.js';
import { icone } from '../icons.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { cartaoOS, linhaCompactaOS } from '../components/cartao-os.js';
import { esqueletoLista, faixaErro, estadoVazio, toastErro, toastSucesso, ocupado } from '../ui.js';
import { numero, moeda, duracao, mesAtual, rotuloPeriodo, iniciais } from '../format.js';
import { ORDEM_STATUS, ROTULOS_STATUS, COR_STATUS } from '../constantes.js';
import { baixarRelatorioPainel } from '../relatorio-painel.js';

const ROTULOS_PAGAMENTO = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  credito: 'Cartão de crédito',
  debito: 'Cartão de débito',
  outro: 'Outro',
  nao_informado: 'Não informado',
};

let filtros = { ...mesAtual(), lojaId: '' };

export async function paginaDashboard(container) {
  const escopoRede = store.escopoRede;
  const lojas = store.meta?.lojas ?? [];

  const campoDe = h('input.entrada', { type: 'date', value: filtros.de, 'aria-label': 'Data inicial' });
  const campoAte = h('input.entrada', { type: 'date', value: filtros.ate, 'aria-label': 'Data final' });
  const campoLoja = escopoRede && lojas.length
    ? h(
        'select.selecao',
        { 'aria-label': 'Filtrar por loja' },
        h('option', { value: '' }, 'Todas as lojas'),
        ...lojas.map((l) => h('option', { value: String(l.id), selected: String(filtros.lojaId) === String(l.id) }, l.nome)),
      )
    : null;

  const areaFiltros = h(
    'div.filtros',
    {},
    h(
      'div',
      {},
      h('div.rotulo-flutuante', { style: { marginBottom: '6px' } }, 'Período'),
      h('div.linha', { style: { gap: '8px' } }, campoDe, h('span.texto-fraco', {}, 'até'), campoAte),
    ),
    campoLoja ? h('div.campo', {}, h('label.campo__rotulo', {}, 'Loja'), campoLoja) : null,
    h(
      'div.campo',
      {},
      h('label.campo__rotulo', {}, '\u00a0'),
      h(
        'button.btn.btn--secundario.btn--bloco',
        { type: 'button', onclick: () => { const m = mesAtual(); filtros.de = m.de; filtros.ate = m.ate; campoDe.value = m.de; campoAte.value = m.ate; carregar(); } },
        'Mês atual',
      ),
    ),
    h(
      'div.campo',
      {},
      h('label.campo__rotulo', {}, '\u00a0'),
      h(
        'button.btn.btn--primario.btn--bloco',
        { type: 'button', onclick: () => carregar() },
        icone('filtro', { tamanho: 16 }),
        'Aplicar',
      ),
    ),
  );

  const areaConteudo = h('div.pilha--grande.pilha', {}, esqueletoLista(3));

  const pagina = h(
    'div',
    {},
    h(
      'div.pagina-cabecalho',
      {},
      h(
        'div.pagina-cabecalho__titulo',
        {},
        h('h1', {}, escopoRede ? 'Painel da rede' : `Painel · ${store.usuario.lojaNome ?? ''}`),
        h('p.pagina-cabecalho__desc', {}, `Indicadores de ${rotuloPeriodo(filtros.de, filtros.ate).toLowerCase()}`),
      ),
      h(
        'div.pagina-cabecalho__acoes',
        {},
        h(
          'button.btn.btn--secundario',
          {
            type: 'button',
            onclick: async (evento) => {
              const botao = evento.currentTarget;
              ocupado(botao, true, 'Gerando…');
              try {
                const dados = await api.get('/api/dashboard', { de: filtros.de, ate: filtros.ate, lojaId: filtros.lojaId });
                const nomeLoja = (store.meta?.lojas ?? []).find((l) => String(l.id) === String(filtros.lojaId))?.nome;
                const escopo = nomeLoja ?? (store.escopoRede ? 'Rede inteira' : store.usuario?.lojaNome ?? '');
                await baixarRelatorioPainel(dados, { escopo });
                toastSucesso('Relatório gerado.', { titulo: 'Download iniciado' });
              } catch (erro) {
                toastErro(erro.message, { titulo: 'Não foi possível gerar o relatório' });
              } finally {
                ocupado(botao, false);
              }
            },
          },
          icone('download', { tamanho: 16 }),
          'Relatório PDF',
        ),
        h(
          'button.btn.btn--secundario',
          {
            type: 'button',
            onclick: async () => {
              try {
                const nome = await api.baixar('/api/relatorios/ordens.csv', {
                  de: filtros.de,
                  ate: filtros.ate,
                  lojaId: filtros.lojaId,
                });
                toastSucesso(`Arquivo ${nome} gerado.`, { titulo: 'Exportação concluída' });
              } catch (erro) {
                toastErro(erro.message);
              }
            },
          },
          icone('download', { tamanho: 16 }),
          'Exportar CSV',
        ),
        store.pode('os.criar')
          ? h('a.btn.btn--primario', { href: '#/nova' }, icone('nova', { tamanho: 16 }), 'Nova OS')
          : null,
      ),
    ),
    areaFiltros,
    areaConteudo,
  );

  montar(container, pagina);

  const aoAplicar = () => {
    filtros.de = campoDe.value;
    filtros.ate = campoAte.value;
    filtros.lojaId = campoLoja ? campoLoja.value : '';
    carregar();
  };
  campoDe.addEventListener('change', aoAplicar);
  campoAte.addEventListener('change', aoAplicar);
  campoLoja?.addEventListener('change', aoAplicar);

  await carregar();

  async function carregar() {
    montar(areaConteudo, esqueletoLista(3));
    const descricao = pagina.querySelector('.pagina-cabecalho__desc');
    if (descricao) descricao.textContent = `Indicadores de ${rotuloPeriodo(filtros.de, filtros.ate).toLowerCase()}`;
    try {
      const dados = await api.get('/api/dashboard', {
        de: filtros.de,
        ate: filtros.ate,
        lojaId: filtros.lojaId,
      });
      store.definirResumo(dados);
      renderizar(dados);
    } catch (erro) {
      montar(areaConteudo, faixaErro(erro.message, { aoTentar: carregar }));
    }
  }

  function renderizar(dados) {
    const status = dados.status ?? {};
    const resumo = dados.periodoResumo ?? {};

    const cartoesStatus = [
      { chave: 'aguardando', rotulo: 'Aguardando', dica: 'Na fila da loja' },
      { chave: 'em_manutencao', rotulo: 'Em manutenção', dica: 'Na bancada agora' },
      { chave: 'aguardando_peca', rotulo: 'Aguardando peça', dica: 'Pausadas' },
      { chave: 'pronto', rotulo: 'Prontos', dica: 'Esperando retirada' },
      { chave: 'retirado', rotulo: 'Retirados', dica: 'Histórico total' },
    ].map((item) =>
      h(
        `div.stat.stat--${item.chave}`,
        { onclick: () => irParaOrdens(item.chave) },
        h('div.stat__rotulo', {}, item.rotulo),
        h('div.stat__valor', {}, numero(status[item.chave] ?? 0)),
        h('div.stat__rodape', {}, item.dica),
      ),
    );

    const indicadores = h(
      'div.grade',
      {},
      ...cartoesStatus,
      h(
        'div.stat',
        { style: { cursor: 'default' } },
        h('div.stat__rotulo', {}, 'Em aberto'),
        h('div.stat__valor', {}, numero(status.abertas ?? 0)),
        h('div.stat__rodape', {}, 'Total ainda em fluxo'),
      ),
    );

    const comp = dados.comparativo;
    const variacaoTexto = (v) =>
      v === null || v === undefined ? null : `${v > 0 ? '▲' : v < 0 ? '▼' : '•'} ${String(Math.abs(v)).replace('.', ',')}% vs. período anterior`;
    const resumoPeriodo = h(
      'div.grade',
      {},
      cartaoResumo(
        'Entradas no período',
        numero(resumo.total ?? 0),
        variacaoTexto(comp?.variacaoEntradas) ?? rotuloPeriodo(dados.periodo?.de, dados.periodo?.ate),
        'caixa',
      ),
      cartaoResumo(
        'Valor em serviços',
        moeda(resumo.faturamento ?? 0),
        variacaoTexto(comp?.variacaoFaturamento) ?? 'OS prontas ou retiradas no período',
        'tendencia',
      ),
    );

    const porLoja = (dados.porLoja ?? []).filter((l) => l.total > 0 || escopoRede);
    const painelLojas = porLoja.length
      ? h(
          'div.pilha',
          {},
          ...porLoja.map((loja) => barraLoja(loja)),
          h('div.legenda', { style: { marginTop: '4px' } }, ...ORDEM_STATUS.map((s) =>
            h(
              'span.legenda__item',
              {},
              h('span.legenda__cor', { style: { background: COR_STATUS[s] } }),
              ROTULOS_STATUS[s],
            ),
          )),
        )
      : estadoVazio({
          icone: 'loja',
          titulo: 'Nenhuma loja com movimento',
          texto: 'Ajuste o período ou cadastre uma loja em Gestão.',
        });

    const financeiro = dados.financeiro;
    const painelFinanceiro = financeiro
      ? h(
          'div',
          {},
          h('div.rotulo-flutuante', { style: { marginBottom: '10px' } }, 'Financeiro do período'),
          h(
            'div.financeiro',
            {},
            cartaoResumo('Faturamento', moeda(financeiro.faturamento ?? 0), `${numero(financeiro.entregas ?? 0)} OS entregues`, 'tendencia'),
            cartaoResumo('Ticket médio', moeda(financeiro.ticketMedio ?? 0), 'por OS entregue', 'caixa'),
            cartaoResumo('Recebido', moeda(financeiro.recebido ?? 0), 'pagamento confirmado', 'check'),
          ),
          financeiro.porFormaPagamento?.length
            ? h(
                'div.card',
                { style: { marginTop: 'var(--esp-4)' } },
                h('div.card__cabecalho', {}, h('h3', {}, 'Formas de pagamento'), h('span.texto-mini.texto-suave', {}, 'OS entregues no período')),
                h(
                  'div.card__corpo.financeiro__lista',
                  {},
                  ...financeiro.porFormaPagamento.map((p) =>
                    h(
                      'div.financeiro__linha',
                      {},
                      h('span', {}, ROTULOS_PAGAMENTO[p.forma] ?? p.forma),
                      h('span', {}, `${numero(p.total)} · `, h('strong', {}, moeda(p.valor))),
                    ),
                  ),
                ),
              )
            : null,
        )
      : null;

    const produtividade = (dados.produtividade ?? []).map((tecnico) =>
      h(
        'div.lista-compacta__item',
        { style: { cursor: 'default' } },
        h('span.avatar', {}, iniciais(tecnico.nome)),
        h(
          'div',
          { style: { flex: '1', minWidth: '0' } },
          h('div.lista-compacta__titulo', {}, tecnico.nome),
          h('div.texto-mini.texto-fraco', {}, tecnico.loja_nome ?? '—'),
        ),
        h(
          'div.texto-central',
          {},
          h('div.texto-forte', {}, numero(tecnico.concluidas_com_data ?? 0)),
          h('div.texto-mini.texto-fraco', {}, 'concluídas'),
        ),
        h(
          'div.texto-central.so-desktop',
          {},
          h('div.texto-forte', {}, moeda(tecnico.faturamento ?? 0)),
          h('div.texto-mini.texto-fraco', {}, 'faturamento'),
        ),
        tecnico.horas_medias != null
          ? h('div.texto-central.so-desktop', {}, h('div.texto-forte', {}, duracao(tecnico.horas_medias)), h('div.texto-mini.texto-fraco', {}, 'média'))
          : null,
      ),
    );

    const serie = (dados.serie ?? []).slice(-14);
    const grafico = serie.length
      ? h(
          'div.grafico',
          {},
          ...serie.map((ponto) =>
            h(
              'div.grafico__coluna',
              {},
              h('div.grafico__barra', {
                style: { height: `${alturaBarra(ponto.entrada, serie)}%` },
                dataset: { valor: `${ponto.entrada} entrada(s) em ${ponto.dia.slice(8)}/${ponto.dia.slice(5, 7)}` },
              }),
              h('div.grafico__eixo', {}, ponto.dia.slice(8)),
            ),
          ),
        )
      : null;

    const recentes = (dados.recentes ?? []).map((os) => cartaoOS(os, { mostrarLoja: escopoRede }));
    const fila = (dados.fila ?? []).map((os) => linhaCompactaOS(os));

    const corpo = [
      indicadores,
      h('div', {}, h('div.rotulo-flutuante', { style: { marginBottom: '10px' } }, 'Resumo do período'), resumoPeriodo),
      painelFinanceiro,
      h(
        'div.grade--lateral.grade',
        {},
        h(
          'div.card',
          {},
          h(
            'div.card__cabecalho',
            {},
            h('h3', {}, 'Ordens por loja'),
            h('span.texto-mini.texto-suave', {}, 'Situação atual + retirados no período'),
          ),
          h('div.card__corpo', {}, painelLojas),
        ),
        h(
          'div.card',
          {},
          h(
            'div.card__cabecalho',
            {},
            h('h3', {}, 'Fila de atendimento'),
            h('a.btn.btn--pequeno.btn--fantasma', { href: '#/fila' }, 'Ver fila', icone('chevronDireita', { tamanho: 14 })),
          ),
          h(
            'div.card__corpo',
            {},
            fila.length
              ? h('div.lista-compacta', {}, ...fila)
              : estadoVazio({ icone: 'check', titulo: 'Fila vazia', texto: 'Nenhum aparelho aguardando atendimento.' }),
          ),
        ),
      ),
      grafico
        ? h(
            'div.card',
            {},
            h('div.card__cabecalho', {}, h('h3', {}, 'Entradas nos últimos dias'), h('span.texto-mini.texto-suave', {}, 'Por dia de entrada')),
            h('div.card__corpo', {}, grafico),
          )
        : null,
      h(
        'div.card',
        {},
        h(
          'div.card__cabecalho',
          {},
          h('h3', {}, 'Produtividade da equipe'),
          h('span.texto-mini.texto-suave', {}, 'Concluídas no período'),
        ),
        h(
          'div.card__corpo',
          {},
          produtividade.length
            ? h('div.lista-compacta', {}, ...produtividade)
            : estadoVazio({ icone: 'ferramenta', titulo: 'Sem conclusões no período', texto: 'Assim que os técnicos finalizarem OS, o ranking aparece aqui.' }),
        ),
      ),
      h(
        'div',
        {},
        h(
          'div.secao__titulo',
          {},
          h('h2', {}, 'Ordens recentes'),
          h('a.btn.btn--pequeno.btn--secundario', { href: '#/ordens' }, 'Ver todas', icone('chevronDireita', { tamanho: 14 })),
        ),
        recentes.length
          ? h('div.grade--2.grade', {}, ...recentes)
          : h('div.card', {}, estadoVazio({ icone: 'caixa', titulo: 'Nenhuma OS no período', texto: 'Troque o período ou registre a primeira entrada.' })),
      ),
    ];

    montar(areaConteudo, ...corpo);
  }
}

function cartaoResumo(rotulo, valor, dica, nomeIcone) {
  return h(
    'div.card',
    {},
    h(
      'div.card__corpo',
      { style: { display: 'grid', gap: '6px' } },
      h(
        'div.linha',
        { style: { gap: '8px' } },
        h('span', { style: { color: 'var(--cor-marca)' } }, icone(nomeIcone, { tamanho: 17 })),
        h('span.rotulo-flutuante', {}, rotulo),
      ),
      h('div', { style: { fontSize: '1.4rem', fontWeight: '700', letterSpacing: '-0.02em' } }, valor),
      h('div.texto-mini.texto-fraco', {}, dica),
    ),
  );
}

function alturaBarra(valor, serie) {
  const maximo = Math.max(1, ...serie.map((p) => p.entrada ?? 0));
  const proporcao = (valor ?? 0) / maximo;
  return Math.max(4, Math.round(proporcao * 100));
}

function barraLoja(loja) {
  const total = ORDEM_STATUS.reduce((soma, s) => soma + (loja[s] ?? 0), 0);
  const segmentos = ORDEM_STATUS.filter((s) => (loja[s] ?? 0) > 0).map((s) =>
    h('div.barra-horizontal__parte', {
      class: `barra-horizontal__parte--${s}`,
      style: { width: total ? `${((loja[s] ?? 0) / total) * 100}%` : '0%' },
      title: `${ROTULOS_STATUS[s]}: ${loja[s]}`,
    }),
  );

  return h(
    'div.barra-horizontal',
    {},
    h(
      'div.barra-horizontal__topo',
      {},
      h(
        'div.linha',
        { style: { gap: '8px', minWidth: '0' } },
        h('span.texto-forte.texto-truncar', {}, loja.nome),
        loja.ativo ? null : h('span.badge.badge--cancelado.badge--sem-ponto', {}, 'desativada'),
      ),
      h('span.texto-pequeno.texto-suave', {}, `${numero(total)} OS`),
    ),
    h('div.barra-horizontal__trilha', {}, segmentos.length ? segmentos : h('div', { style: { width: '100%' } })),
    h(
      'div.texto-mini.texto-fraco.linha',
      { style: { gap: '10px', flexWrap: 'wrap' } },
      h('span', {}, `${loja.aguardando ?? 0} aguardando`),
      h('span', {}, `${loja.em_manutencao ?? 0} em bancada`),
      h('span', {}, `${loja.pronto ?? 0} prontos`),
      h('span', {}, `${loja.retirados_periodo ?? 0} retirados no período`),
      loja.faturamento ? h('span', {}, `Faturamento ${moeda(loja.faturamento)}`) : null,
    ),
  );
}

function irParaOrdens(status) {
  window.location.hash = `/ordens?status=${status}`;
}
