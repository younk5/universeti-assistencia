import { h, montar } from '../dom.js';
import { api, ErroApi } from '../api.js';
import { icone } from '../icons.js';
import { dataHora, quando, telefone as fmtTelefone, moeda } from '../format.js';
import { analisarRota } from '../router.js';
import { DESCRICAO_STATUS } from '../constantes.js';
import { baixarComprovantePublico } from '../comprovante-publico.js';
import { toastSucesso, toastErro, ocupado } from '../ui.js';

/**
 * Portal público de acompanhamento da OS. O cliente abre pelo QR da etiqueta
 * ou pelo link do WhatsApp, sem login. A consulta exige o número da OS + os
 * 4 últimos dígitos do telefone cadastrado.
 */

const PASSOS = [
  { chave: 'aguardando', rotulo: 'Recebido', icone: 'caixa' },
  { chave: 'em_manutencao', rotulo: 'Bancada', icone: 'ferramenta' },
  { chave: 'pronto', rotulo: 'Pronto', icone: 'check' },
  { chave: 'retirado', rotulo: 'Entregue', icone: 'assinatura' },
];

const ICONE_EVENTO = {
  criacao: 'caixa',
  assumir: 'ferramenta',
  finalizar: 'check',
  retirar: 'assinatura',
  orcamento: 'whatsapp',
  orcamento_aprovado: 'check',
  orcamento_recusado: 'x',
};

function indiceStatus(status) {
  if (status === 'cancelado') return -1;
  if (status === 'retirado') return 3;
  if (status === 'aguardando_peca') return 1;
  return PASSOS.findIndex((p) => p.chave === status);
}

export function montarRastreio(params = {}) {
  const raiz = document.getElementById('app');
  const query = analisarRota().query;
  const numeroInicial = params.numero ?? '';
  const telInicial = query.get('tel') ?? '';

  const campoNumero = h('input.entrada', {
    type: 'text',
    name: 'numero',
    placeholder: 'Ex.: GUA-0001',
    autocomplete: 'off',
    autocapitalize: 'characters',
    value: numeroInicial,
  });

  const campoTel = h('input.entrada', {
    type: 'tel',
    name: 'tel',
    inputmode: 'numeric',
    maxlength: 4,
    placeholder: '4 últimos dígitos',
    autocomplete: 'off',
    value: telInicial,
  });

  const areaResultado = h('div.rastreio__resultado');
  const botao = h('button.btn.btn--primario.btn--bloco.btn--grande', { type: 'submit' }, icone('busca', { tamanho: 17 }), 'Acompanhar meu aparelho');

  /* ----------------------------- Peças da tela ---------------------------- */

  const formulario = h(
    'form.rastreio__form',
    {
      onsubmit: async (evento) => {
        evento.preventDefault();
        await consultar();
      },
    },
    h(
      'label.campo',
      {},
      h('span.campo__rotulo', {}, 'Número da OS'),
      h('div.campo-com-icone', {}, h('span.campo-com-icone__icone', {}, icone('caixa', { tamanho: 17 })), campoNumero),
    ),
    h(
      'label.campo',
      {},
      h('span.campo__rotulo', {}, '4 últimos dígitos do WhatsApp'),
      h('div.campo-com-icone', {}, h('span.campo-com-icone__icone', {}, icone('telefone', { tamanho: 17 })), campoTel),
    ),
    botao,
  );

  const painelBusca = h(
    'section.rastreio__painel',
    {},
    h('h2.rastreio__painel-titulo', {}, 'Consultar OS'),
    formulario,
  );

  const comoFunciona = h(
    'section.publico__como',
    {},
    h('h2.publico__como-titulo', {}, 'Como funciona'),
    h(
      'ol.publico__passos',
      {},
      passo('caixa', 'Tenha a OS em mãos', 'O número está na etiqueta e no comprovante.'),
      passo('telefone', 'Confirme o telefone', 'Os 4 últimos dígitos do número cadastrado.'),
      passo('relogio', 'Acompanhe cada etapa', 'Recebido, bancada, pronto e entregue.'),
    ),
  );

  const topo = h(
    'header.publico__hero',
    {},
    h(
      'div.publico__marca',
      {},
      h('span', {}, 'UT'),
      h('div', {}, h('strong', {}, 'UniverseTI Assistência'), h('small', {}, 'Assistência técnica de celulares')),
    ),
    h('h1.publico__hero-titulo', {}, 'Acompanhe seu reparo em tempo real'),
    h('p.publico__hero-texto', {}, 'Sem precisar ligar na loja: veja em qual etapa o seu aparelho está e a previsão de retirada.'),
    h(
      'ul.publico__beneficios',
      {},
      beneficio('Status atualizado a cada etapa'),
      beneficio('Histórico completo do reparo'),
      beneficio('Sem filas, sem ligações'),
    ),
  );

  const areaPrincipal = h('main.publico__conteudo', {}, painelBusca, comoFunciona, areaResultado);

  function mostrarBusca() {
    painelBusca.classList.remove('oculto');
    comoFunciona.classList.remove('oculto');
    areaPrincipal.classList.remove('publico__conteudo--topo');
    montar(areaResultado);
    campoNumero.value = '';
    campoTel.value = '';
    campoNumero.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ------------------------------ Consulta -------------------------------- */

  async function consultar() {
    const numero = campoNumero.value.trim().toUpperCase();
    const tel = campoTel.value.replace(/\D/g, '');
    if (!numero) {
      montar(areaResultado, aviso('Informe o número da OS que está na etiqueta ou no comprovante.', 'aviso'));
      campoNumero.focus();
      return;
    }
    if (tel.length < 4) {
      montar(areaResultado, aviso('Informe os 4 últimos dígitos do telefone cadastrado na loja.', 'aviso'));
      campoTel.focus();
      return;
    }
    botao.disabled = true;
    montar(botao, icone('busca', { tamanho: 17 }), 'Procurando…');
    montar(areaResultado, esqueleto());
    painelBusca.classList.add('oculto');
    comoFunciona.classList.add('oculto');
    areaPrincipal.classList.add('publico__conteudo--topo');
    try {
      const dados = await api.get(`/api/publico/os/${encodeURIComponent(numero)}`, { tel });
      montar(areaResultado, cartaoResultado(dados, mostrarBusca));
      window.history.replaceState(null, '', `#/rastreio/${encodeURIComponent(numero)}?tel=${tel}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (erro) {
      const texto = erro instanceof ErroApi ? erro.message : 'Não foi possível consultar agora.';
      painelBusca.classList.remove('oculto');
      comoFunciona.classList.remove('oculto');
      montar(areaResultado, aviso(texto, 'erro'));
    } finally {
      botao.disabled = false;
      montar(botao, icone('busca', { tamanho: 17 }), 'Acompanhar meu aparelho');
    }
  }

  montar(
    raiz,
    h(
      'div.publico',
      {},
      topo,
      h(
        'div.publico__lado',
        {},
        areaPrincipal,
        h('p.publico__rodape', {}, 'É da equipe da loja? ', h('a', { href: '#/login' }, 'Entrar no sistema')),
      ),
    ),
  );

  if (numeroInicial && telInicial.length >= 4) consultar();
  else campoNumero.focus();
}

function passo(nomeIcone, titulo, texto) {
  return h(
    'li.publico__passo',
    {},
    h('span.publico__passo-icone', {}, icone(nomeIcone, { tamanho: 17 })),
    h('div.publico__passo-texto', {}, h('strong', {}, titulo), h('span', {}, texto)),
  );
}

function beneficio(texto) {
  return h('li', {}, icone('check', { tamanho: 14 }), h('span', {}, texto));
}

function cartaoResultado({ ordem, linhaDoTempo }, aoLimpar) {
  const eventos = [...(linhaDoTempo ?? [])].reverse();
  const ultimo = eventos[0];
  const idx = indiceStatus(ordem.status);
  const cancelado = ordem.status === 'cancelado';

  const stepper = h(
    'ol.rastreio__stepper',
    {},
    PASSOS.map((passo, i) => {
      const feito = !cancelado && i < idx;
      const atual = !cancelado && i === idx;
      return h(
        `li.rastreio__etapa${feito ? '.rastreio__etapa--feito' : ''}${atual ? '.rastreio__etapa--atual' : ''}`,
        {},
        h('span.rastreio__etapa-icone', {}, icone(feito ? 'check' : passo.icone, { tamanho: 15 })),
        h('span.rastreio__etapa-rotulo', {}, passo.rotulo),
      );
    }),
  );

  const aparelho = h(
    'div.rastreio__aparelho',
    {},
    h('span.rastreio__aparelho-avatar', {}, icone('dispositivo', { tamanho: 20 })),
    h(
      'div.rastreio__aparelho-info',
      {},
      h('strong', {}, `${ordem.marca ?? ''} ${ordem.modelo ?? ''}`.trim() || 'Aparelho'),
      h('span', {}, [ordem.cor, ordem.lojaNome].filter(Boolean).join(' · ')),
    ),
    ordem.garantiaAte
      ? h(
          'span.rastreio__selo-garantia',
          { title: `Garantia até ${dataHora(ordem.garantiaAte).slice(0, 10)}` },
          icone('escudo', { tamanho: 14 }),
          'Garantia',
        )
      : null,
  );

  const alertaOrcamento =
    ordem.orcamentoStatus === 'pendente'
      ? aviso(`Orçamento de ${moeda(ordem.orcamentoValor)} aguardando sua aprovação.`, 'aviso')
      : ordem.orcamentoStatus === 'aprovado'
        ? aviso(`Orçamento aprovado: ${moeda(ordem.orcamentoValor)}.`, 'sucesso')
        : ordem.orcamentoStatus === 'recusado'
          ? aviso('Orçamento recusado. A loja entrará em contato.', 'erro')
          : null;

  const previsao = ordem.previsaoRetirada
    ? h(
        'div.rastreio__previsao',
        {},
        icone('relogio', { tamanho: 18 }),
        h('div', {}, h('strong', {}, 'Previsão de retirada'), h('span', {}, dataHora(ordem.previsaoRetirada).slice(0, 10))),
      )
    : null;

  const eventosUi = eventos.length
    ? h(
        'ol.rastreio__linha',
        {},
        eventos.map((e) =>
          h(
            `li.rastreio__evento.rastreio__evento--${e.tipo}`,
            {},
            h('span.rastreio__evento-ponto', {}, icone(ICONE_EVENTO[e.tipo] ?? 'info', { tamanho: 12 })),
            h(
              'div.rastreio__evento-texto',
              {},
              h('span.rastreio__evento-rotulo', {}, e.rotulo),
              h('span.rastreio__evento-hora', {}, dataHora(e.quando)),
            ),
          ),
        ),
      )
    : h('p.texto-suave', {}, 'Sem movimentações registradas ainda.');

  const acoes = h(
    'div.rastreio__botoes',
    {},
    ordem.lojaTelefone
      ? h(
          'a.btn.btn--secundario.btn--bloco',
          { href: `tel:${String(ordem.lojaTelefone).replace(/\D/g, '')}` },
          icone('telefone', { tamanho: 16 }),
          'Ligar para a loja',
        )
      : null,
    h(
      'button.btn.btn--secundario.btn--bloco',
      { type: 'button', onclick: (evento) => gerarComprovante(evento.currentTarget, ordem, linhaDoTempo) },
      icone('download', { tamanho: 16 }),
      'Baixar comprovante (PDF)',
    ),
    h('button.btn.btn--fantasma.btn--bloco', { type: 'button', onclick: aoLimpar }, icone('busca', { tamanho: 16 }), 'Consultar outra OS'),
  );

  return h(
    'article.rastreio__cartao',
    {},
    h(
      `header.rastreio__faixa.rastreio__faixa--${ordem.status}`,
      {},
      h('span.rastreio__faixa-numero', {}, ordem.numeroOS),
      h('div.rastreio__faixa-status', {}, ordem.statusRotulo),
      ultimo ? h('div.rastreio__faixa-atualizado', {}, icone('relogio', { tamanho: 12 }), `Atualizado ${quando(ultimo.quando)}`) : null,
    ),
    h(
      'div.rastreio__corpo',
      {},
      aparelho,
      cancelado
        ? aviso('Esta OS foi cancelada. Fale com a loja para mais detalhes.', 'erro')
        : h('div.rastreio__progresso', {}, stepper, h('p.rastreio__progresso-desc', {}, DESCRICAO_STATUS[ordem.status] ?? '')),
      alertaOrcamento,
      previsao,
      h(
        'dl.rastreio__dados',
        {},
        linha('Loja', ordem.lojaNome ?? '—'),
        linha('Aberta em', dataHora(ordem.criadoEm)),
        ordem.concluidoEm ? linha('Concluída em', dataHora(ordem.concluidoEm)) : null,
        ordem.retiradoEm ? linha('Retirada em', dataHora(ordem.retiradoEm)) : null,
        ordem.garantiaAte ? linha('Garantia até', dataHora(ordem.garantiaAte).slice(0, 10)) : null,
        ordem.lojaTelefone ? linha('Telefone da loja', fmtTelefone(ordem.lojaTelefone)) : null,
      ),
      h(
        'div.rastreio__secao',
        {},
        h('h3.rastreio__secao-titulo', {}, icone('relogio', { tamanho: 15 }), 'Histórico'),
        eventosUi,
      ),
      acoes,
    ),
  );
}

function linha(rotulo, valor) {
  return h('div.rastreio__dado', {}, h('dt', {}, rotulo), h('dd', {}, valor));
}

async function gerarComprovante(botao, ordem, linhaDoTempo) {
  ocupado(botao, true, 'Gerando…');
  try {
    await baixarComprovantePublico(ordem, linhaDoTempo);
    toastSucesso('Comprovante gerado.', { titulo: 'Download iniciado' });
  } catch (erro) {
    toastErro(erro.message, { titulo: 'Não foi possível gerar o PDF' });
  } finally {
    ocupado(botao, false);
  }
}

function aviso(texto, tipo = 'aviso') {
  if (tipo === 'sucesso') {
    return h(
      'div.faixa-sucesso.rastreio__aviso',
      {},
      icone('check', { tamanho: 18 }),
      h('div', {}, h('div.faixa-erro__titulo', {}, 'Tudo certo'), h('div.faixa-erro__texto', {}, texto)),
    );
  }
  if (tipo === 'erro') {
    return h(
      'div.faixa-erro.rastreio__aviso',
      { role: 'alert' },
      icone('alerta', { tamanho: 20 }),
      h('div', {}, h('div.faixa-erro__titulo', {}, 'Não foi possível localizar'), h('div.faixa-erro__texto', {}, texto)),
    );
  }
  return h(
    'div.faixa-aviso.rastreio__aviso',
    {},
    icone('alerta', { tamanho: 18 }),
    h('span', { style: { flex: '1' } }, texto),
  );
}

function esqueleto() {
  return h(
    'div.card.rastreio__esqueleto',
    {},
    h(
      'div.card__corpo.pilha',
      {},
      h('div.esqueleto', { style: { height: '18px', width: '40%' } }),
      h('div.esqueleto', { style: { height: '12px', width: '82%' } }),
      h('div.esqueleto', { style: { height: '12px', width: '64%' } }),
    ),
  );
}
