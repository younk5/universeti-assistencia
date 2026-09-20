import { h, montar } from '../dom.js';
import { icone } from '../icons.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { cartaoFoto } from '../components/cartao-os.js';
import { modalFinalizarOS, modalRetirarOS, modalComentar, modalAnexarFoto, modalOrcamento, modalDecisaoOrcamento, copiarLink } from '../components/modais-os.js';
import { qrImagem } from '../qr.js';
import { previewPadrao } from '../padrao.js';
import {
  esqueletoLista,
  faixaErro,
  estadoVazio,
  toastSucesso,
  toastErro,
  ocupado,
  confirmar,
  abrirModal,
  badgeStatus,
  visualizarFotos,
} from '../ui.js';
import { baixarEtiquetaPdf, baixarComprovantePdf } from '../etiqueta.js';
import {
  dataHora,
  quando,
  moeda,
  telefone as formatarTelefone,
  duracao,
} from '../format.js';
import {
  ETAPAS_FLUXO,
  indiceEtapa,
  ROTULOS_TIPO_EVENTO,
  ROTULOS_STATUS,
  DESCRICAO_STATUS,
  CHECKLIST_ITENS,
  ROTULOS_SENHA,
} from '../constantes.js';

const ICONE_EVENTO = {
  criacao: 'caixa',
  status: 'raio',
  assumir: 'ferramenta',
  finalizar: 'check',
  retirar: 'assinatura',
  comentario: 'editar',
  foto: 'imagem',
  edicao: 'editar',
  reabertura: 'recarregar',
  orcamento: 'whatsapp',
  orcamento_aprovado: 'check',
  orcamento_recusado: 'x',
  garantia: 'escudo',
};

const ROTULOS_PAGAMENTO = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  credito: 'Cartão de crédito',
  debito: 'Cartão de débito',
  outro: 'Outro',
};

const ROTULOS_CHECKLIST_DETALHE = Object.fromEntries(CHECKLIST_ITENS.map((item) => [item.chave, item.rotulo]));

function ultimos4(telefone) {
  return String(telefone ?? '').replace(/\D/g, '').slice(-4);
}

function descreverSenha(senha) {
  if (!senha || !senha.valor) return '—';
  const rotulo = ROTULOS_SENHA[senha.tipo] ?? senha.tipo;
  if (senha.tipo === 'padrao') return `${rotulo}: ${String(senha.valor).split('-').join(' → ')}`;
  return `${rotulo}: ${senha.valor}`;
}

function linkRastreio(os) {
  return `${window.location.origin}/#/rastreio/${encodeURIComponent(os.numero_os)}?tel=${ultimos4(os.cliente_telefone)}`;
}

export function paginaOSDetalhe(container, params) {
  const osId = Number(params.id);
  const abrirFinalizar = Boolean(params.acao === 'finalizar');

  const areaPrincipal = h('div', {}, esqueletoLista(2));
  montar(container, areaPrincipal);

  let dados = null;

  carregar();

  async function carregar() {
    montar(areaPrincipal, esqueletoLista(2));
    try {
      dados = await api.get(`/api/ordens/${osId}`);
      desenhar();
      if (abrirFinalizar && dados.acoes.podeFinalizar) {
        modalFinalizarOS({ ordem: dados.ordem, garantiaPadrao: dados.garantiaPadraoDias, aoConcluir: () => carregar() });
      }
    } catch (erro) {
      montar(
        areaPrincipal,
        h(
          'div',
          {},
          h(
            'div.pagina-cabecalho',
            {},
            h('a.btn.btn--fantasma', { href: '#/ordens' }, icone('voltar', { tamanho: 16 }), 'Voltar para a lista'),
          ),
          faixaErro(erro.message, { titulo: 'OS indisponível', aoTentar: carregar }),
        ),
      );
    }
  }

  function desenhar() {
    const os = dados.ordem;
    const eventos = dados.eventos ?? [];
    const fotos = dados.fotos ?? [];
    const acoes = dados.acoes ?? {};

    const etapaAtual = indiceEtapa(os.status);

    const passos = h(
      'div.passos',
      {},
      ...ETAPAS_FLUXO.flatMap((etapa, indice) => {
        const feito = indice < etapaAtual;
        const atual = indice === etapaAtual;
        const marcador = h(
          `div.passo${feito ? '.passo--feito' : atual ? '.passo--atual' : ''}`,
          {},
          h('span.passo__bolinha', {}, icone(feito ? 'check' : etapa.icone, { tamanho: 13 })),
          etapa.rotulo,
        );
        if (indice === ETAPAS_FLUXO.length - 1) return [marcador];
        return [marcador, h(`div.passo__linha${indice < etapaAtual ? '.passo__linha--feito' : ''}`)];
      }),
    );

    const cabecalho = h(
      'div.pagina-cabecalho',
      {},
      h(
        'div.pagina-cabecalho__titulo',
        { style: { gap: '6px' } },
        h('a.texto-pequeno.texto-suave.linha', { href: '#/ordens', style: { gap: '4px' } }, icone('voltar', { tamanho: 14 }), 'Todas as ordens'),
        h('h1.texto-mono', { style: { fontSize: '1.3rem' } }, os.numero_os),
        h(
          'div.linha.linha--quebra',
          { style: { gap: '8px', marginTop: '4px' } },
          badgeStatus(os.status),
          h('span.texto-mini.texto-fraco', {}, `Entrada em ${dataHora(os.criado_em)}`),
        ),
      ),
      h(
        'div.pagina-cabecalho__acoes',
        {},
        h(
          'button.btn.btn--secundario',
          { type: 'button', onclick: (evento) => gerarPdf(evento.currentTarget, () => baixarEtiquetaPdf(os), 'Etiqueta') },
          icone('download', { tamanho: 16 }),
          'Etiqueta PDF',
        ),
        h(
          'button.btn.btn--secundario',
          { type: 'button', onclick: (evento) => gerarPdf(evento.currentTarget, () => baixarComprovantePdf(os, eventos, fotos), 'Comprovante') },
          icone('download', { tamanho: 16 }),
          'Comprovante PDF',
        ),
        dados.whatsapp
          ? h(
              'a.btn.btn--secundario',
              {
                href: `https://wa.me/${dados.whatsapp}?text=${encodeURIComponent(mensagemWhatsapp(os))}`,
                target: '_blank',
                rel: 'noopener',
              },
              icone('whatsapp', { tamanho: 16 }),
              'Avisar cliente',
            )
          : null,
      ),
    );

    const painelAcoes = h(
      'div.painel-acoes',
      {},
      acoes.podeAssumir ? botaoAssumir(os) : null,
      acoes.podeFinalizar
        ? h(
            'button.btn.btn--sucesso',
            { type: 'button', onclick: () => modalFinalizarOS({ ordem: os, garantiaPadrao: dados.garantiaPadraoDias, aoConcluir: () => carregar() }) },
            icone('check', { tamanho: 16 }),
            'Finalizar serviço',
          )
        : null,
      acoes.podeRetirar
        ? h(
            'button.btn.btn--primario',
            { type: 'button', onclick: () => modalRetirarOS({ ordem: os, aoConcluir: () => carregar() }) },
            icone('assinatura', { tamanho: 16 }),
            'Registrar retirada',
          )
        : null,
      acoes.podeComentar
        ? h(
            'button.btn.btn--secundario',
            { type: 'button', onclick: () => modalComentar({ ordem: os, tecnico: store.papel === 'tecnico', aoConcluir: () => carregar() }) },
            icone('editar', { tamanho: 16 }),
            'Adicionar anotação',
          )
        : null,
      acoes.podeAnexarFoto
        ? h(
            'button.btn.btn--secundario',
            { type: 'button', onclick: () => modalAnexarFoto({ ordem: os, aoConcluir: () => carregar() }) },
            icone('camera', { tamanho: 16 }),
            'Anexar foto',
          )
        : null,
      acoes.podeCancelar && os.status !== 'cancelado'
        ? h('button.btn.btn--perigo', { type: 'button', onclick: () => cancelarOS(os) }, icone('x', { tamanho: 16 }), 'Cancelar OS')
        : null,
      acoes.podeReabrir
        ? h('button.btn.btn--secundario', { type: 'button', onclick: () => reabrirOS(os) }, icone('recarregar', { tamanho: 16 }), 'Reabrir OS')
        : null,
      acoes.podeGarantia
        ? h('button.btn.btn--secundario', { type: 'button', onclick: () => abrirGarantia(os) }, icone('escudo', { tamanho: 16 }), 'Abrir OS em garantia')
        : null,
      store.ehAdmin
        ? h('button.btn.btn--perigo', { type: 'button', onclick: () => excluirOS(os) }, icone('x', { tamanho: 16 }), 'Excluir OS')
        : null,
    );

    const statusAtual = h(
      'div.card',
      {},
      h(
        'div.card__corpo.pilha--pequena.pilha',
        {},
        h('div.rotulo-flutuante', {}, 'Situação atual'),
        h('div.linha.linha--entre', {}, badgeStatus(os.status), h('span.texto-mini.texto-fraco', {}, `Atualizado ${quando(os.atualizado_em)}`)),
        h('p.texto-pequeno.texto-suave', {}, DESCRICAO_STATUS[os.status] ?? ''),
        passos,
        os.status === 'aguardando_peca'
          ? h('div.faixa-aviso', {}, icone('alerta', { tamanho: 18 }), h('span', {}, 'Reparo pausado aguardando peça. Retome quando a peça chegar.'))
          : null,
      ),
    );

    const colunaEsquerda = h(
      'div.pilha--grande.pilha',
      {},
      os.garantia_de_os_id
        ? h(
            'div.faixa-aviso',
            {},
            icone('escudo', { tamanho: 18 }),
            h('span', { style: { flex: '1' } }, 'Esta OS é um retorno em garantia. Não cobrar novamente o mesmo serviço.'),
          )
        : null,
      statusAtual,
      h(
        'div.card',
        {},
        h('div.card__cabecalho', {}, h('h3', {}, 'Cliente')),
        h(
          'div.card__corpo.kv',
          {},
          h('span.kv__chave', {}, 'Nome'),
          h('span.kv__valor', {}, os.cliente_nome),
          h('span.kv__chave', {}, 'WhatsApp'),
          h('span.kv__valor', {}, formatarTelefone(os.cliente_telefone)),
          h('span.kv__chave', {}, 'Recebido por'),
          h('span.kv__valor', {}, os.recebido_por ?? os.cliente_nome),
        ),
      ),
      h(
        'div.card',
        {},
        h('div.card__cabecalho', {}, h('h3', {}, 'Aparelho')),
        h(
          'div.card__corpo.kv',
          {},
          h('span.kv__chave', {}, 'Tipo'),
          h('span.kv__valor', {}, os.tipo_aparelho),
          h('span.kv__chave', {}, 'Marca / modelo'),
          h('span.kv__valor', {}, `${os.marca} ${os.modelo}`),
          h('span.kv__chave', {}, 'Cor'),
          h('span.kv__valor', {}, os.cor || '—'),
          h('span.kv__chave', {}, 'IMEI / série'),
          h('span.kv__valor.texto-mono', {}, os.imei || '—'),
          h('span.kv__chave', {}, 'Acessórios'),
          h('span.kv__valor', {}, os.acessorios || 'Nenhum registrado'),
        ),
      ),
      h(
        'div.card',
        {},
        h('div.card__cabecalho', {}, h('h3', {}, 'Defeito e estado')),
        h(
          'div.card__corpo.pilha',
          {},
          h('div', {}, h('div.rotulo-flutuante', { style: { marginBottom: '4px' } }, 'Relatado pelo cliente'), h('p', { style: { whiteSpace: 'pre-wrap' } }, os.defeito_relatado)),
          os.estado_aparelho ? h('div', {}, h('div.rotulo-flutuante', { style: { marginBottom: '4px' } }, 'Estado na entrada'), h('p', { style: { whiteSpace: 'pre-wrap' } }, os.estado_aparelho)) : null,
        ),
      ),
      h(
        'div.card',
        {},
        h('div.card__cabecalho', {}, h('h3', {}, 'Serviço e valores')),
        h(
          'div.card__corpo.kv',
          {},
          h('span.kv__chave', {}, 'Loja de entrada'),
          h('span.kv__valor', {}, os.loja_nome),
          h('span.kv__chave', {}, 'Atendente'),
          h('span.kv__valor', {}, os.atendente_nome ?? '—'),
          h('span.kv__chave', {}, 'Técnico'),
          h('span.kv__valor', {}, os.tecnico_nome ?? 'Ainda não assumido'),
          h('span.kv__chave', {}, 'Início do reparo'),
          h('span.kv__valor', {}, os.iniciado_em ? dataHora(os.iniciado_em) : '—'),
          h('span.kv__chave', {}, 'Concluído em'),
          h('span.kv__valor', {}, os.concluido_em ? dataHora(os.concluido_em) : '—'),
          h('span.kv__chave', {}, 'Retirado em'),
          h('span.kv__valor', {}, os.retirado_em ? dataHora(os.retirado_em) : '—'),
          h('span.kv__chave', {}, 'Tempo de reparo'),
          h(
            'span.kv__valor',
            {},
            os.concluido_em
              ? duracao((new Date(os.concluido_em) - new Date(os.criado_em)) / 3600000)
              : 'Em andamento',
          ),
          h('span.kv__chave', {}, 'Valor'),
          h('span.kv__valor.texto-forte', {}, moeda(os.valor)),
          h('span.kv__chave', {}, 'Pagamento'),
          h('span.kv__valor', {}, os.valor_pago ? 'Confirmado' : 'Pendente / não aplicável'),
          os.forma_pagamento ? h('span.kv__chave', {}, 'Forma de pagamento') : null,
          os.forma_pagamento ? h('span.kv__valor', {}, ROTULOS_PAGAMENTO[os.forma_pagamento] ?? os.forma_pagamento) : null,
          os.garantia_ate
            ? h('span.kv__chave', {}, 'Garantia')
            : os.garantia_dias
              ? h('span.kv__chave', {}, 'Garantia')
              : null,
          os.garantia_ate
            ? h('span.kv__valor', {}, `Até ${dataHora(os.garantia_ate).slice(0, 10)} (${os.garantia_dias ?? 90} dias)`)
            : os.garantia_dias
              ? h('span.kv__valor', {}, `${os.garantia_dias} dias a partir da entrega`)
              : null,
        ),
      ),
      cartaoOrcamento(os, dados, carregar),
      cartaoChecklist(os),
      h(
        'div.card',
        {},
        h(
          'div.card__cabecalho',
          {},
          h('h3', {}, 'Fotos e assinatura'),
          h('span.texto-mini.texto-suave', {}, `${fotos.length} anexo(s)`),
        ),
        h(
          'div.card__corpo',
          {},
          fotos.length
            ? h('div.galeria-fotos', {}, ...fotos.map((foto, indice) => cartaoFoto(foto, indice, () => visualizarFotos(fotos, indice), { aoExcluir: store.pode('os.comentar') ? excluirFoto : undefined })))
            : estadoVazio({
                icone: 'camera',
                titulo: 'Nenhuma foto anexada',
                texto: 'Fotos de entrada, saída e retirada dão respaldo ao serviço prestado.',
                acao: acoes.podeAnexarFoto
                  ? h('button.btn.btn--secundario', { type: 'button', onclick: () => modalAnexarFoto({ ordem: os, aoConcluir: () => carregar() }) }, 'Anexar primeira foto')
                  : null,
              }),
        ),
      ),
    );

    const linhaTempo = h(
      'div.card',
      {},
      h(
        'div.card__cabecalho',
        {},
        h('h3', {}, 'Histórico auditável'),
        h('span.texto-mini.texto-suave', {}, `${eventos.length} registro(s)`),
      ),
      h(
        'div.card__corpo',
        {},
        eventos.length ? h('div.timeline', {}, ...eventos.map((evento) => itemTimeline(evento, fotos))) : estadoVazio({ icone: 'relogio', titulo: 'Sem registros' }),
      ),
      h(
        'div.card__rodape',
        {},
        h(
          'p.texto-mini.texto-fraco',
          {},
          'Registros de auditoria não podem ser editados. A exclusão de uma OS (administrador) ou de um anexo é definitiva.',
        ),
      ),
    );

    const colunaDireita = h('div.pilha--grande.pilha', {}, painelAcoes, cartaoRastreio(os, dados.whatsapp), linhaTempo);

    montar(areaPrincipal, cabecalho, h('div.grade--lateral.grade', {}, colunaEsquerda, colunaDireita));
  }

  function itemTimeline(evento, fotos) {
    const classe = `timeline__marcador--${evento.tipo_evento}`;
    const transicao =
      evento.status_anterior && evento.status_novo && evento.status_anterior !== evento.status_novo
        ? h(
            'span.timeline__transicao',
            {},
            ROTULOS_STATUS[evento.status_anterior] ?? evento.status_anterior,
            icone('setaDireita', { tamanho: 12 }),
            h('strong', {}, ROTULOS_STATUS[evento.status_novo] ?? evento.status_novo),
          )
        : null;

    return h(
      'div.timeline__item',
      {},
      h('span.timeline__marcador', { class: classe }, icone(ICONE_EVENTO[evento.tipo_evento] ?? 'info', { tamanho: 15 })),
      h(
        'div.timeline__conteudo',
        {},
        h(
          'div.timeline__titulo',
          {},
          ROTULOS_TIPO_EVENTO[evento.tipo_evento] ?? evento.tipo_evento,
          transicao,
        ),
        h(
          'div.timeline__quando',
          {},
          icone('relogio', { tamanho: 12 }),
          `${dataHora(evento.criado_em)}`,
          evento.usuario_nome ? ` · ${evento.usuario_nome}` : '',
          evento.usuario_papel ? h('span.badge.badge--sem-ponto', { style: { transform: 'scale(0.86)' } }, evento.usuario_papel) : null,
        ),
        evento.descricao ? h('div.timeline__texto', {}, evento.descricao) : null,
      ),
    );
  }

  function botaoAssumir(os) {
    const botao = h('button.btn.btn--primario', { type: 'button' }, icone('ferramenta', { tamanho: 16 }), 'Assumir aparelho');
    botao.addEventListener('click', async () => {
      ocupado(botao, true, 'Assumindo…');
      try {
        const resposta = await api.post(`/api/ordens/${os.id}/assumir`, {});
        toastSucesso(resposta.mensagem, { titulo: 'Aparelho na bancada' });
        await carregar();
      } catch (erro) {
        toastErro(erro.message);
        ocupado(botao, false);
      }
    });
    return botao;
  }

  async function cancelarOS(os) {
    const motivo = await pedirMotivo('Cancelar OS', 'Informe o motivo do cancelamento. Ele fica registrado no histórico.');
    if (motivo === null) return;
    try {
      const resposta = await api.post(`/api/ordens/${os.id}/status`, { status: 'cancelado', descricao: motivo });
      toastSucesso(resposta.mensagem);
      await carregar();
    } catch (erro) {
      toastErro(erro.message);
    }
  }

  async function reabrirOS(os) {
    const confirmado = await confirmar({
      titulo: 'Reabrir OS',
      mensagem: `A OS ${os.numero_os} volta para a fila como "Aguardando". O histórico anterior é preservado.`,
      textoConfirmar: 'Reabrir',
    });
    if (!confirmado) return;
    try {
      const resposta = await api.post(`/api/ordens/${os.id}/status`, { status: 'aguardando', descricao: 'OS reaberta pelo administrador' });
      toastSucesso(resposta.mensagem);
      await carregar();
    } catch (erro) {
      toastErro(erro.message);
    }
  }

  async function abrirGarantia(os) {
    const texto = await pedirObservacao({
      titulo: 'Abrir OS em garantia',
      descricao: `Será criada uma nova OS vinculada à ${os.numero_os}, sem cobrar o mesmo serviço. Garantia até ${dataHora(os.garantia_ate).slice(0, 10)}.`,
      textoConfirmar: 'Abrir em garantia',
    });
    if (texto === null) return;
    try {
      const resposta = await api.post(`/api/ordens/${os.id}/garantia`, { descricao: texto || null });
      toastSucesso(resposta.mensagem, { titulo: 'Garantia aberta' });
      window.location.hash = `/ordens/${resposta.ordem.id}`;
    } catch (erro) {
      toastErro(erro.message, { titulo: 'Não foi possível abrir a garantia' });
    }
  }

  async function gerarPdf(botao, acao, rotulo) {
    ocupado(botao, true, 'Gerando…');
    try {
      await acao();
      toastSucesso(`PDF do ${rotulo.toLowerCase()} gerado.`, { titulo: 'Download iniciado' });
    } catch (erro) {
      toastErro(erro.message, { titulo: 'Não foi possível gerar o PDF' });
    } finally {
      ocupado(botao, false);
    }
  }

  async function excluirOS(os) {
    const confirmado = await confirmar({
      titulo: 'Excluir OS',
      mensagem: `A OS ${os.numero_os} de ${os.cliente_nome} será apagada para sempre, junto com fotos, assinatura e histórico. Não é possível desfazer.`,
      textoConfirmar: 'Excluir definitivamente',
      perigoso: true,
    });
    if (!confirmado) return;
    try {
      const resposta = await api.delete(`/api/ordens/${os.id}`);
      toastSucesso(resposta.mensagem ?? 'OS excluída.', { titulo: 'OS excluída' });
      window.location.hash = '/ordens';
    } catch (erro) {
      toastErro(erro.message, { titulo: 'Não foi possível excluir' });
    }
  }

  async function excluirFoto(foto) {
    const confirmado = await confirmar({
      titulo: 'Excluir anexo',
      mensagem: 'Esta foto/assinatura será apagada definitivamente. Não é possível desfazer.',
      textoConfirmar: 'Excluir',
      perigoso: true,
    });
    if (!confirmado) return;
    try {
      const resposta = await api.delete(`/api/fotos/${foto.id}`);
      toastSucesso(resposta.mensagem ?? 'Foto removida.');
      await carregar();
    } catch (erro) {
      toastErro(erro.message, { titulo: 'Não foi possível excluir' });
    }
  }
}

function cartaoOrcamento(os, dados, recarregar) {
  const orc = dados.orcamento ?? { status: 'sem_orcamento', rotulo: 'Sem orçamento' };
  const podeEnviar = store.pode('os.finalizar') && !['retirado', 'cancelado'].includes(os.status);
  const classeBadge = {
    pendente: 'badge--aguardando',
    aprovado: 'badge--pronto',
    recusado: 'badge--cancelado',
    sem_orcamento: 'badge--baixa',
  }[orc.status] ?? 'badge--baixa';

  const acoes = [];
  if (podeEnviar) {
    acoes.push(
      h(
        'button.btn.btn--primario.btn--pequeno',
        { type: 'button', onclick: () => modalOrcamento({ ordem: os, garantiaPadrao: dados.garantiaPadraoDias, aoConcluir: recarregar }) },
        icone('whatsapp', { tamanho: 15 }),
        orc.status === 'sem_orcamento' ? 'Enviar orçamento' : 'Reenviar orçamento',
      ),
    );
  }
  if (orc.status === 'pendente') {
    acoes.push(
      h('button.btn.btn--secundario.btn--pequeno', { type: 'button', onclick: () => modalDecisaoOrcamento({ ordem: os, aoConcluir: recarregar }) }, icone('check', { tamanho: 15 }), 'Registrar resposta'),
    );
    if (dados.linkAprovacao) {
      acoes.push(h('button.btn.btn--fantasma.btn--pequeno', { type: 'button', onclick: () => copiarLink(dados.linkAprovacao) }, icone('olho', { tamanho: 15 }), 'Copiar link'));
    }
  }

  return h(
    'div.card',
    {},
    h('div.card__cabecalho', {}, h('h3', {}, 'Orçamento'), h('span.badge.badge--sem-ponto', { class: classeBadge }, orc.rotulo ?? 'Sem orçamento')),
    h(
      'div.card__corpo.pilha',
      {},
      orc.valor != null
        ? h('div.orcamento__valor', {}, moeda(orc.valor))
        : h('p.texto-suave', {}, 'Nenhum orçamento enviado. Lance o valor e mande o link para o cliente aprovar antes de executar o serviço.'),
      orc.observacao ? h('p.texto-pequeno.texto-suave', {}, orc.observacao) : null,
      orc.criadoEm ? h('p.texto-mini.texto-fraco', {}, `Enviado em ${dataHora(orc.criadoEm)}`) : null,
      orc.decididoEm ? h('p.texto-mini.texto-fraco', {}, `Respondido em ${dataHora(orc.decididoEm)}`) : null,
      acoes.length ? h('div.compartilhar', {}, ...acoes) : null,
      dados.linkAprovacao && orc.status === 'pendente'
        ? h('div.qr-caixa', {}, qrImagem(dados.linkAprovacao, { tamanho: 148, alt: 'QR do orçamento' }), h('span.texto-mini.texto-fraco', {}, 'O cliente escaneia e responde.'))
        : null,
    ),
  );
}

function cartaoChecklist(os) {
  let itens = null;
  try {
    itens = os.checklist ? JSON.parse(os.checklist) : null;
  } catch {
    itens = null;
  }
  if (!itens) {
    return h(
      'div.card',
      {},
      h('div.card__cabecalho', {}, h('h3', {}, 'Checklist técnico')),
      h('div.card__corpo', {}, h('p.texto-suave', {}, 'Nenhum item de vistoria registrado na entrada.')),
    );
  }
  const linhas = Object.keys(ROTULOS_CHECKLIST_DETALHE)
    .filter((chave) => itens[chave] !== undefined)
    .map((chave) =>
      h(
        'div.linha',
        { style: { gap: '8px' } },
        icone(itens[chave] ? 'check' : 'x', { tamanho: 15 }),
        h('span', { class: itens[chave] ? 'checklist__marcado' : 'checklist__nao' }, ROTULOS_CHECKLIST_DETALHE[chave]),
      ),
    );

  return h(
    'div.card',
    {},
    h('div.card__cabecalho', {}, h('h3', {}, 'Checklist técnico'), h('span.texto-mini.texto-suave', {}, 'Vistoria da entrada')),
    h(
      'div.card__corpo.pilha--pequena.pilha',
      {},
      linhas.length ? h('div.checklist__resumo', {}, ...linhas) : null,
      itens.senha
        ? h(
            'div',
            {},
            h('div.rotulo-flutuante', {}, 'Senha do aparelho'),
            itens.senha.tipo === 'padrao'
              ? h(
                  'div.pilha--pequena.pilha',
                  {},
                  previewPadrao(itens.senha.valor, { tamanho: 120 }),
                  h('p.senha-visivel', {}, `Ordem: ${String(itens.senha.valor).split('-').join(' → ')}`),
                )
              : h('p.senha-visivel', {}, descreverSenha(itens.senha)),
          )
        : null,
      itens.itensDeixados ? h('div', {}, h('div.rotulo-flutuante', {}, 'Itens deixados'), h('p', {}, itens.itensDeixados)) : null,
      itens.observacoes ? h('div', {}, h('div.rotulo-flutuante', {}, 'Observações'), h('p', {}, itens.observacoes)) : null,
    ),
  );
}

function cartaoRastreio(os, whatsapp) {
  const link = linkRastreio(os);
  return h(
    'div.card',
    {},
    h('div.card__cabecalho', {}, h('h3', {}, 'Acompanhamento do cliente'), h('span.texto-mini.texto-suave', {}, 'QR e link')),
    h(
      'div.card__corpo.pilha',
      {},
      h('div.qr-caixa', {}, qrImagem(link, { tamanho: 148, alt: 'QR de rastreio da OS' }), h('span.texto-mini.texto-fraco', {}, 'O cliente escaneia e acompanha o status sem ligar.')),
      h('div.link-copiavel', {}, link),
      h(
        'div.compartilhar',
        {},
        h('button.btn.btn--secundario.btn--pequeno', { type: 'button', onclick: () => copiarLink(link) }, icone('olho', { tamanho: 15 }), 'Copiar link'),
        whatsapp
          ? h(
              'a.btn.btn--primario.btn--pequeno',
              {
                href: `https://wa.me/${whatsapp}?text=${encodeURIComponent(`Olá, ${String(os.cliente_nome).split(' ')[0]}! Acompanhe sua OS ${os.numero_os} por aqui: ${link}`)}`,
                target: '_blank',
                rel: 'noopener',
              },
              icone('whatsapp', { tamanho: 15 }),
              'Enviar link',
            )
          : null,
      ),
    ),
  );
}

function pedirObservacao({ titulo, descricao, textoConfirmar = 'Confirmar' }) {
  return new Promise((resolve) => {
    const campoTexto = h('textarea.area-texto', { rows: 3, placeholder: 'Descreva o que voltou com problema (opcional).' });
    const botao = h('button.btn.btn--primario', { type: 'button' }, icone('escudo', { tamanho: 16 }), textoConfirmar);
    const formulario = h(
      'form.pilha',
      {
        novalidate: true,
        onsubmit: (evento) => {
          evento.preventDefault();
          resolve(campoTexto.value.trim());
          modal.fechar();
        },
      },
      h('div.campo', {}, h('label.campo__rotulo', {}, 'Motivo do retorno'), campoTexto),
    );
    botao.addEventListener('click', () => formulario.requestSubmit());
    const modal = abrirModal({
      titulo,
      descricao,
      corpo: formulario,
      rodape: [h('button.btn.btn--secundario', { type: 'button', onclick: () => modal.fechar() }, 'Cancelar'), botao],
      aoFechar: () => resolve(null),
    });
  });
}

function pedirMotivo(titulo, descricao) {
  return new Promise((resolve) => {
    const campoTexto = h('textarea.area-texto', { rows: 3, required: true, placeholder: 'Ex: cliente recusou o orçamento de R$ 480,00.' });
    const botao = h('button.btn.btn--perigo', { type: 'button' }, 'Confirmar cancelamento');
    const formulario = h(
      'form.pilha',
      {
      novalidate: true,
        onsubmit: (evento) => {
          evento.preventDefault();
          if (campoTexto.value.trim().length < 3) {
            campoTexto.focus();
            return;
          }
          resolve(campoTexto.value.trim());
          modal.fechar();
        },
      },
      h('div.campo', {}, h('label.campo__rotulo', {}, 'Motivo'), campoTexto),
    );
    botao.addEventListener('click', () => formulario.requestSubmit());
    const modal = abrirModal({
      titulo,
      descricao,
      corpo: formulario,
      rodape: [h('button.btn.btn--secundario', { type: 'button', onclick: () => modal.fechar() }, 'Voltar'), botao],
      aoFechar: () => resolve(null),
    });
  });
}

function mensagemWhatsapp(os) {
  if (os.status === 'pronto') {
    return `Olá, ${os.cliente_nome.split(' ')[0]}! Seu aparelho ${os.marca} ${os.modelo} já está pronto para retirada na ${os.loja_nome}. OS ${os.numero_os}.`;
  }
  if (os.status === 'retirado') {
    return `Olá, ${os.cliente_nome.split(' ')[0]}! Obrigado pela preferência. Qualquer dúvida sobre o serviço da OS ${os.numero_os}, é só chamar.`;
  }
  return `Olá, ${os.cliente_nome.split(' ')[0]}! Sobre a OS ${os.numero_os} (${os.marca} ${os.modelo}) na ${os.loja_nome}:`;
}
