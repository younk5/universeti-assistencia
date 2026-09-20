import { h, montar } from '../dom.js';
import { icone } from '../icons.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { cartaoOS } from '../components/cartao-os.js';
import { esqueletoLista, faixaErro, estadoVazio, toastSucesso, toastErro, ocupado } from '../ui.js';
import { quando } from '../format.js';

const ABAS = [
  { status: 'aguardando', rotulo: 'Aguardando', vazio: 'Nenhum aparelho na fila de entrada.' },
  { status: 'em_manutencao', rotulo: 'Em bancada', vazio: 'Ninguém está com aparelho aberto neste momento.' },
  { status: 'aguardando_peca', rotulo: 'Aguardando peça', vazio: 'Nenhuma OS pausada por falta de peça.' },
];

export async function paginaFila(container) {
  let abaAtiva = 'aguardando';
  let dados = { aguardando: [], em_manutencao: [], aguardando_peca: [] };
  let carregando = true;
  let erro = null;

  const areaAbas = h('div.faixa-chips');
  const areaLista = h('div');

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
          h('h1', {}, 'Fila de atendimento'),
          h('p.pagina-cabecalho__desc', {}, `Bancada de ${store.usuario.lojaNome ?? 'sua loja'} · atualizado ${quando(new Date().toISOString())}`),
        ),
        h(
          'div.pagina-cabecalho__acoes',
          {},
          h(
            'button.btn.btn--secundario',
            { type: 'button', onclick: () => carregar() },
            icone('recarregar', { tamanho: 16 }),
            'Atualizar',
          ),
        ),
      ),
      areaAbas,
      areaLista,
    ),
  );

  await carregar();

  async function carregar() {
    carregando = true;
    erro = null;
    desenhar();
    try {
      const resposta = await api.get('/api/ordens', {
        status: 'aguardando,em_manutencao,aguardando_peca',
        limite: 200,
      });
      dados = {
        aguardando: resposta.itens.filter((o) => o.status === 'aguardando'),
        em_manutencao: resposta.itens.filter((o) => o.status === 'em_manutencao'),
        aguardando_peca: resposta.itens.filter((o) => o.status === 'aguardando_peca'),
      };
    } catch (e) {
      erro = e.message;
    } finally {
      carregando = false;
      desenhar();
    }
  }

  function desenhar() {
    montar(
      areaAbas,
      ...ABAS.map((aba) =>
        h(
          'button.chip',
          {
            type: 'button',
            'aria-pressed': abaAtiva === aba.status ? 'true' : 'false',
            onclick: () => {
              abaAtiva = aba.status;
              desenhar();
            },
          },
          aba.rotulo,
          h('span.chip__contador', {}, String(dados[aba.status]?.length ?? 0)),
        ),
      ),
    );

    if (carregando) {
      montar(areaLista, esqueletoLista(3));
      return;
    }
    if (erro) {
      montar(areaLista, faixaErro(erro, { aoTentar: carregar }));
      return;
    }

    const lista = dados[abaAtiva] ?? [];
    const config = ABAS.find((a) => a.status === abaAtiva);

    if (!lista.length) {
      montar(
        areaLista,
        h(
          'div.card',
          {},
          estadoVazio({
            icone: abaAtiva === 'aguardando' ? 'check' : 'ferramenta',
            titulo: 'Nada por aqui',
            texto: config.vazio,
          }),
        ),
      );
      return;
    }

    montar(
      areaLista,
      h(
        'div.grade--2.grade',
        {},
        ...lista.map((ordem) =>
          h(
            'div.pilha--pequena.pilha',
            { style: { alignContent: 'start' } },
            cartaoOS(ordem, { mostrarLoja: store.escopoRede }),
            acoesDaOS(ordem),
          ),
        ),
      ),
    );
  }

  function acoesDaOS(ordem) {
    const botoes = [];

    if (ordem.status === 'aguardando' && store.pode('os.assumir')) {
      const botao = h(
        'button.btn.btn--primario.btn--bloco',
        { type: 'button' },
        icone('ferramenta', { tamanho: 16 }),
        'Assumir aparelho',
      );
      botao.addEventListener('click', async () => {
        ocupado(botao, true, 'Assumindo…');
        try {
          const resposta = await api.post(`/api/ordens/${ordem.id}/assumir`, {});
          toastSucesso(resposta.mensagem, { titulo: 'Aparelho na bancada' });
          await carregar();
        } catch (e) {
          toastErro(e.message);
          ocupado(botao, false);
        }
      });
      botoes.push(botao);
    }

    if (ordem.status === 'aguardando_peca' && store.pode('os.assumir')) {
      const botao = h(
        'button.btn.btn--secundario.btn--bloco',
        { type: 'button' },
        icone('recarregar', { tamanho: 16 }),
        'Peça chegou · retomar',
      );
      botao.addEventListener('click', async () => {
        ocupado(botao, true, 'Retomando…');
        try {
          const resposta = await api.post(`/api/ordens/${ordem.id}/status`, {
            status: 'em_manutencao',
            descricao: 'Peça recebida — reparo retomado',
          });
          toastSucesso(resposta.mensagem);
          await carregar();
        } catch (e) {
          toastErro(e.message);
          ocupado(botao, false);
        }
      });
      botoes.push(botao);
    }

    if (['em_manutencao', 'aguardando_peca'].includes(ordem.status) && store.pode('os.finalizar')) {
      botoes.push(
        h(
          'a.btn.btn--sucesso.btn--bloco',
          { href: `#/ordens/${ordem.id}/finalizar` },
          icone('check', { tamanho: 16 }),
          'Finalizar serviço',
        ),
      );
    }

    botoes.push(
      h(
        'a.btn.btn--secundario.btn--bloco',
        { href: `#/ordens/${ordem.id}` },
        icone('lista', { tamanho: 16 }),
        'Ver detalhes',
      ),
    );

    if (ordem.cliente_telefone) {
      const link = h(
        'a.btn.btn--fantasma.btn--bloco',
        {
          href: `https://wa.me/55${ordem.cliente_telefone.replace(/\D/g, '')}`,
          target: '_blank',
          rel: 'noopener',
        },
        icone('whatsapp', { tamanho: 16 }),
        `Falar com ${ordem.cliente_nome.split(' ')[0]}`,
      );
      botoes.push(link);
    }

    return h('div.painel-acoes', {}, ...botoes);
  }
}
