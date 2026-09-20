import { h, montar } from '../dom.js';
import { api, ErroApi } from '../api.js';
import { icone } from '../icons.js';
import { dataHora, moeda } from '../format.js';

/**
 * Página pública de aprovação de orçamento. O cliente recebe o link no WhatsApp,
 * vê o valor e decide — sem login. A decisão é gravada na trilha de auditoria.
 * Usa a mesma casca visual do rastreio (painel de marca à esquerda no desktop).
 */
export async function montarAprovacao(params = {}) {
  const raiz = document.getElementById('app');
  const conteudo = h('div.pilha--grande.pilha');
  montar(raiz, casca(conteudo));

  const token = params.token;
  if (!token) {
    montar(conteudo, cartao('Link inválido', 'O link de aprovação está incompleto. Peça um novo à loja.'));
    return;
  }

  montar(conteudo, h('p.texto-suave', {}, 'Carregando orçamento…'));

  let dados;
  try {
    dados = (await api.get(`/api/publico/orcamento/${encodeURIComponent(token)}`)).orcamento;
  } catch (erro) {
    const texto = erro instanceof ErroApi ? erro.message : 'Não foi possível carregar o orçamento.';
    montar(conteudo, cartao('Não encontramos este orçamento', texto));
    return;
  }

  montar(conteudo, cartaoOrcamento(token, dados, conteudo));
}

function casca(conteudo) {
  return h(
    'div.publico',
    {},
    h(
      'header.publico__hero',
      {},
      h(
        'div.publico__marca',
        {},
        h('span', {}, 'UT'),
        h('div', {}, h('strong', {}, 'UniverseTI Assistência'), h('small', {}, 'Aprovação de orçamento')),
      ),
      h('h1.publico__hero-titulo', {}, 'Aprovar o orçamento do seu reparo'),
      h('p.publico__hero-texto', {}, 'Confira o valor abaixo e responda com um toque. A loja é avisada na hora.'),
      h(
        'ul.publico__beneficios',
        {},
        beneficio('Você decide antes do serviço começar'),
        beneficio('Sem cadastro e sem senha'),
        beneficio('A resposta fica registrada'),
      ),
    ),
    h(
      'div.publico__lado',
      {},
      h('main.publico__conteudo', {}, conteudo),
      h('p.publico__rodape', {}, 'É da equipe da loja? ', h('a', { href: '#/login' }, 'Entrar no sistema')),
    ),
  );
}

function beneficio(texto) {
  return h('li', {}, icone('check', { tamanho: 14 }), h('span', {}, texto));
}

function cartao(titulo, texto) {
  return h('div.rastreio__painel', {}, h('div.pilha', {}, h('h2.rastreio__painel-titulo', {}, 'ORÇAMENTO'), h('h1.publico__titulo', {}, titulo), h('p.texto-suave', {}, texto)));
}

function cartaoOrcamento(token, orc, container) {
  const decidido = orc.status !== 'pendente';
  const areaAcao = h('div.pilha');
  const observacao = h('textarea.entrada', {
    rows: 2,
    maxlength: 300,
    placeholder: 'Observação (opcional) — ex.: pode trocar só a tela',
  });

  if (decidido) {
    areaAcao.append(
      banner(
        orc.status === 'aprovado'
          ? 'Você aprovou este orçamento. A loja já foi avisada.'
          : 'Você recusou este orçamento. A loja entrará em contato.',
        orc.status === 'aprovado' ? 'sucesso' : 'erro',
      ),
    );
    if (orc.decididoEm) areaAcao.append(h('p.texto-suave', {}, `Respondido em ${dataHora(orc.decididoEm)}`));
  } else {
    const decidir = async (decisao) => {
      try {
        await api.post(`/api/publico/orcamento/${encodeURIComponent(token)}`, {
          decisao,
          observacao: observacao.value.trim() || null,
        });
        montar(container, cartaoOrcamento(token, { ...orc, status: decisao, decididoEm: new Date().toISOString() }, container));
      } catch (erro) {
        const texto = erro instanceof ErroApi ? erro.message : 'Não foi possível registrar sua resposta.';
        areaAcao.append(banner(texto, 'erro'));
      }
    };

    areaAcao.append(
      h('label.campo', {}, h('span.campo__rotulo', {}, 'Quer deixar um recado? (opcional)'), observacao),
      h(
        'div.rastreio__acoes',
        {},
        h('button.btn.btn--sucesso.btn--grande.btn--bloco', { type: 'button', onclick: () => decidir('aprovado') }, icone('check', { tamanho: 18 }), 'Aprovar orçamento'),
        h('button.btn.btn--perigo.btn--bloco', { type: 'button', onclick: () => decidir('recusado') }, icone('x', { tamanho: 16 }), 'Recusar'),
      ),
    );
  }

  return h(
    'div.rastreio__painel',
    {},
    h('h2.rastreio__painel-titulo', {}, 'ORÇAMENTO'),
    h(
      'div.rastreio__aparelho',
      {},
      h('span.rastreio__aparelho-avatar', {}, icone('dispositivo', { tamanho: 20 })),
      h(
        'div.rastreio__aparelho-info',
        {},
        h('strong', {}, `${orc.marca ?? ''} ${orc.modelo ?? ''}`.trim() || 'Seu aparelho'),
        h('span', {}, `OS ${orc.numeroOS} · ${orc.lojaNome ?? ''}`),
      ),
    ),
    h('div.orcamento__valor', {}, moeda(orc.valor)),
    orc.observacao ? h('p.texto-pequeno.texto-suave', {}, `Observação da loja: ${orc.observacao}`) : null,
    h('p.texto-mini.texto-fraco', {}, `Enviado em ${dataHora(orc.criadoEm)}`),
    h('hr.divisor'),
    areaAcao,
    h(
      'p.publico__rodape',
      {},
      'Dúvidas? ',
      orc.lojaTelefone ? h('span', {}, `Ligue para ${orc.lojaTelefone}.`) : 'Fale com a loja.',
    ),
  );
}

function banner(texto, tipo = 'erro') {
  const sucesso = tipo === 'sucesso';
  return h(
    `div.${sucesso ? 'faixa-sucesso' : 'faixa-erro'}`,
    { role: 'alert' },
    icone(sucesso ? 'check' : 'alerta', { tamanho: 20 }),
    h(
      'div',
      {},
      h('div.faixa-erro__titulo', {}, sucesso ? 'Resposta registrada' : 'Atenção'),
      h('div.faixa-erro__texto', {}, texto),
    ),
  );
}
