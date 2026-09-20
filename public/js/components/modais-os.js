import { h, montar } from '../dom.js';
import { icone } from '../icons.js';
import { api } from '../api.js';
import { abrirModal, ocupado, toastSucesso, toastErro, faixaAviso } from '../ui.js';
import { criarCaptura } from './captura.js';
import { criarAssinatura } from '../assinatura.js';
import { recortarAssinatura, formatarBytes } from '../image.js';
import { moeda, telefone as formatarTelefone } from '../format.js';
import { ROTULOS_TIPO_FOTO } from '../constantes.js';
import { qrImagem } from '../qr.js';

function campo(rotulo, elemento, { dica = null, opcional = false } = {}) {
  return h(
    'div.campo',
    {},
    h('label.campo__rotulo', {}, rotulo, opcional ? h('span.campo__opcional', {}, 'opcional') : null),
    elemento,
    dica ? h('span.campo__dica', {}, dica) : null,
  );
}

function linhaErro() {
  return h('div.oculto');
}

async function enviarFoto(ordemId, captura, tipo, legenda) {
  if (!captura?.temFoto()) return null;
  const arquivo = captura.obterArquivo();
  try {
    await api.enviarArquivo(`/api/ordens/${ordemId}/fotos`, arquivo.blob, {
      params: { tipo, legenda: arquivo.legenda ?? legenda },
    });
    return null;
  } catch (erro) {
    return erro.message;
  }
}

/* -------------------------------------------------------------------------- */
/* Finalizar OS                                                               */
/* -------------------------------------------------------------------------- */

export function modalFinalizarOS({ ordem, aoConcluir, garantiaPadrao = 90 }) {
  const servico = h('textarea.area-texto', {
    rows: 3,
    required: true,
    placeholder: 'Ex: Troca de tela OLED + vedação. Testado touch, câmera e face ID.',
  });
  const pecas = h('input.entrada', { placeholder: 'Ex: Tela OLED, adesivo de vedação' });
  const valor = h('input.entrada', { type: 'text', inputMode: 'decimal', placeholder: '480,00', value: ordem.valor ? String(ordem.valor).replace('.', ',') : '' });
  const garantia = h('input.entrada', { type: 'number', min: '0', max: '3650', placeholder: '90', inputMode: 'numeric', value: String(ordem.garantia_dias ?? garantiaPadrao ?? 90) });
  const observacoes = h('textarea.area-texto', { rows: 2, placeholder: 'Observações para o histórico (ex: cliente autorizou o valor por WhatsApp).' });

  const captura = criarCaptura({
    titulo: 'Foto do aparelho pronto',
    dica: 'Evidência do serviço concluído. Aparece no histórico da OS.',
    legendaFoto: 'Aparelho após o reparo',
  });

  const erro = linhaErro();
  const botao = h('button.btn.btn--sucesso', { type: 'button', onclick: () => formulario.requestSubmit() }, icone('check', { tamanho: 16 }), 'Concluir e marcar como pronto');

  const formulario = h(
    'form.pilha',
    {
      novalidate: true,
      onsubmit: async (evento) => {
        evento.preventDefault();
        erro.classList.add('oculto');
        if (servico.value.trim().length < 3) {
          montar(erro, faixaAviso('Descreva o serviço realizado — isso fica no histórico da OS.'));
          erro.classList.remove('oculto');
          servico.focus();
          return;
        }
        ocupado(botao, true, 'Concluindo…');
        try {
          const resposta = await api.post(`/api/ordens/${ordem.id}/finalizar`, {
            servicoRealizado: servico.value.trim(),
            pecasUtilizadas: pecas.value.trim() || null,
            valor: valor.value.trim() ? Number(valor.value.replace(/\./g, '').replace(',', '.')) : null,
            garantiaDias: garantia.value ? Number(garantia.value) : null,
            observacoes: observacoes.value.trim() || null,
          });
          let aviso = null;
          if (captura.temFoto()) {
            montar(erro, faixaAviso('Enviando a foto do aparelho pronto…'));
            erro.classList.remove('oculto');
            aviso = await enviarFoto(ordem.id, captura, 'saida', 'Aparelho após o reparo');
          }
          modal.fechar();
          toastSucesso(resposta.mensagem ?? 'Serviço concluído.', { titulo: 'OS pronta para retirada' });
          if (aviso) toastErro(`A OS foi concluída, mas a foto falhou: ${aviso}`, { titulo: 'Foto não enviada' });
          aoConcluir?.(resposta);
        } catch (e) {
          montar(erro, faixaAviso(e.message));
          erro.classList.remove('oculto');
          toastErro(e.message);
        } finally {
          ocupado(botao, false);
        }
      },
    },
    erro,
    campo('Serviço realizado *', servico, { dica: 'Fica registrado no histórico e no comprovante do cliente.' }),
    campo('Peças utilizadas', pecas, { opcional: true }),
    h(
      'div.formulario__linha.formulario__linha--2',
      {},
      campo('Valor cobrado (R$)', valor, { opcional: true }),
      campo('Garantia (dias)', garantia, { opcional: true, dica: 'Ex: 90 dias para o serviço executado.' }),
    ),
    campo('Observações internas', observacoes, { opcional: true }),
    h('hr.divisor'),
    captura.elemento,
    h('p.texto-mini.texto-fraco', {}, `Técnico responsável: ${ordem.tecnico_nome ?? 'será você (registrado automaticamente)'}.`),
  );

  const modal = abrirModal({
    titulo: 'Concluir serviço',
    descricao: `OS ${ordem.numero_os} · ${ordem.cliente_nome}`,
    corpo: formulario,
    rodape: [
      h('button.btn.btn--secundario', { type: 'button', onclick: () => modal.fechar() }, 'Cancelar'),
      botao,
    ],
  });

  return modal;
}

/* -------------------------------------------------------------------------- */
/* Retirar OS                                                                 */
/* -------------------------------------------------------------------------- */

export function modalRetirarOS({ ordem, aoConcluir }) {
  const recebidoPor = h('input.entrada', { value: ordem.cliente_nome, placeholder: 'Nome de quem está retirando' });
  const observacoes = h('textarea.area-texto', { rows: 2, placeholder: 'Ex: entregue ao filho do cliente com autorização por telefone.' });
  const pagamento = h('select.selecao', {},
    h('option', { value: '1' }, 'Pagamento confirmado'),
    h('option', { value: '0' }, 'Pagamento pendente / a combinar'),
  );
  const formaPagamento = h(
    'select.selecao',
    {},
    h('option', { value: '' }, 'Não informar'),
    h('option', { value: 'pix' }, 'Pix'),
    h('option', { value: 'dinheiro' }, 'Dinheiro'),
    h('option', { value: 'credito' }, 'Cartão de crédito'),
    h('option', { value: 'debito' }, 'Cartão de débito'),
    h('option', { value: 'outro' }, 'Outro'),
    ordem.forma_pagamento ? h('option', { value: ordem.forma_pagamento, selected: true }, 'Manter a anterior') : null,
  );

  const captura = criarCaptura({
    titulo: 'Foto da entrega',
    dica: 'Opcional. Registra o aparelho sendo devolvido ao cliente.',
    legendaFoto: 'Comprovante de entrega',
  });

  const assinatura = criarAssinatura({ rotulo: 'Peça para o cliente assinar aqui' });
  const erro = linhaErro();
  const botao = h('button.btn.btn--primario', { type: 'button', onclick: () => formulario.requestSubmit() }, icone('check', { tamanho: 16 }), 'Confirmar retirada');

  const usaAssinatura = h('input', { type: 'checkbox', id: 'chk-assinatura', checked: true, style: { width: '18px', height: '18px' } });
  const blocoAssinatura = h('div.pilha--pequena.pilha', {}, assinatura.elemento);
  usaAssinatura.addEventListener('change', () => {
    blocoAssinatura.classList.toggle('oculto', !usaAssinatura.checked);
  });

  const formulario = h(
    'form.pilha',
    {
      novalidate: true,
      onsubmit: async (evento) => {
        evento.preventDefault();
        erro.classList.add('oculto');
        ocupado(botao, true, 'Registrando…');
        try {
          const resposta = await api.post(`/api/ordens/${ordem.id}/retirar`, {
            recebidoPor: recebidoPor.value.trim() || ordem.cliente_nome,
            observacoes: observacoes.value.trim() || null,
            valorPago: pagamento.value === '1',
            formaPagamento: formaPagamento.value || null,
          });

          let aviso = null;
          if (usaAssinatura.checked && !assinatura.estaVazio()) {
            const blob = await recortarAssinatura(assinatura.canvas);
            if (blob) {
              try {
                await api.enviarArquivo(`/api/ordens/${ordem.id}/fotos`, blob, {
                  params: { tipo: 'assinatura', legenda: 'Assinatura do cliente na retirada' },
                });
              } catch (e) {
                aviso = e.message;
              }
            }
          }
          const avisoFoto = await enviarFoto(ordem.id, captura, 'retirada', 'Comprovante de entrega');

          modal.fechar();
          toastSucesso(resposta.mensagem ?? 'Retirada registrada.', { titulo: 'OS encerrada' });
          if (aviso || avisoFoto) toastErro(`Registro salvo, mas um anexo falhou: ${aviso ?? avisoFoto}`, { titulo: 'Anexo pendente' });
          aoConcluir?.(resposta);
        } catch (e) {
          montar(erro, faixaAviso(e.message));
          erro.classList.remove('oculto');
          toastErro(e.message);
        } finally {
          ocupado(botao, false);
        }
      },
    },
    erro,
    h(
      'div.card.card--plana',
      {},
      h(
        'div.card__corpo.pilha--pequena.pilha',
        {},
        h('div.linha.linha--entre', {}, h('span.texto-suave', {}, 'Valor do serviço'), h('strong', {}, moeda(ordem.valor))),
        h('div.linha.linha--entre', {}, h('span.texto-suave', {}, 'Cliente'), h('span', {}, ordem.cliente_nome)),
        h('div.linha.linha--entre', {}, h('span.texto-suave', {}, 'Telefone'), h('span', {}, formatarTelefone(ordem.cliente_telefone))),
      ),
    ),
    campo('Quem está retirando', recebidoPor),
    campo('Situação do pagamento', pagamento),
    campo('Forma de pagamento', formaPagamento, { opcional: true }),
    ordem.garantia_dias
      ? h('p.texto-mini.texto-fraco', {}, `Garantia do serviço: ${ordem.garantia_dias} dias a partir da entrega.`)
      : null,
    campo('Observações', observacoes, { opcional: true }),
    h(
      'label.linha',
      { style: { gap: '10px', cursor: 'pointer', alignItems: 'center' } },
      usaAssinatura,
      h('span', { style: { flex: '1' } }, h('span.texto-forte', {}, 'Coletar assinatura do cliente'), h('div.texto-mini.texto-fraco', {}, 'Recomendado para encerrar a OS com segurança jurídica.')),
    ),
    blocoAssinatura,
    h('hr.divisor'),
    captura.elemento,
  );

  const modal = abrirModal({
    titulo: 'Registrar retirada',
    descricao: `OS ${ordem.numero_os} · entrega do aparelho`,
    corpo: formulario,
    rodape: [
      h('button.btn.btn--secundario', { type: 'button', onclick: () => modal.fechar() }, 'Cancelar'),
      botao,
    ],
    aoFechar: () => assinatura.destruir(),
  });

  return modal;
}

/* -------------------------------------------------------------------------- */
/* Anotação técnica                                                           */
/* -------------------------------------------------------------------------- */

export function modalComentar({ ordem, aoConcluir, tecnico = false }) {
  const campoTexto = h('textarea.area-texto', {
    rows: 4,
    required: true,
    placeholder: tecnico
      ? 'Ex: Diagnóstico confirmado — trilha do display rompida. Peça encomendada no fornecedor X, previsão 2 dias.'
      : 'Ex: Cliente ligou pedindo previsão; informado prazo de 3 dias úteis.',
  });
  const botao = h('button.btn.btn--primario', { type: 'button', onclick: () => formulario.requestSubmit() }, icone('check', { tamanho: 16 }), 'Registrar anotação');
  const erro = linhaErro();

  const formulario = h(
    'form.pilha',
    {
      novalidate: true,
      onsubmit: async (evento) => {
        evento.preventDefault();
        if (campoTexto.value.trim().length < 2) return;
        ocupado(botao, true, 'Salvando…');
        try {
          const resposta = await api.post(`/api/ordens/${ordem.id}/comentarios`, { descricao: campoTexto.value.trim() });
          modal.fechar();
          toastSucesso(resposta.mensagem ?? 'Anotação registrada.');
          aoConcluir?.(resposta);
        } catch (e) {
          montar(erro, faixaAviso(e.message));
          erro.classList.remove('oculto');
        } finally {
          ocupado(botao, false);
        }
      },
    },
    erro,
    campo('Anotação', campoTexto, { dica: 'A anotação entra na linha do tempo com seu nome e horário. Não pode ser apagada depois.' }),
  );

  const modal = abrirModal({
    titulo: 'Nova anotação',
    descricao: `OS ${ordem.numero_os}`,
    corpo: formulario,
    rodape: [
      h('button.btn.btn--secundario', { type: 'button', onclick: () => modal.fechar() }, 'Cancelar'),
      botao,
    ],
  });
  return modal;
}

/* -------------------------------------------------------------------------- */
/* Anexar foto avulsa                                                         */
/* -------------------------------------------------------------------------- */

export function modalAnexarFoto({ ordem, aoConcluir }) {
  const tipos = ['entrada', 'saida', 'retirada'];
  const tipo = h('select.selecao', {}, ...tipos.map((t) => h('option', { value: t }, ROTULOS_TIPO_FOTO[t])));
  const legenda = h('input.entrada', { placeholder: 'Ex: detalhe do conector oxidado' });
  const captura = criarCaptura({ titulo: 'Escolher ou tirar foto', dica: 'A imagem é comprimida antes do envio.' });
  const erro = linhaErro();
  const botao = h('button.btn.btn--primario', { type: 'button', onclick: () => formulario.requestSubmit() }, icone('check', { tamanho: 16 }), 'Anexar na OS');
  const info = h('div.texto-mini.texto-fraco');

  captura.elemento.addEventListener('change', () => {
    const arquivo = captura.obterArquivo();
    if (arquivo) info.textContent = `Tamanho final: ${formatarBytes(arquivo.bytes)}`;
  });

  const formulario = h(
    'form.pilha',
    {
      novalidate: true,
      onsubmit: async (evento) => {
        evento.preventDefault();
        if (!captura.temFoto()) {
          montar(erro, faixaAviso('Selecione uma foto antes de anexar.'));
          erro.classList.remove('oculto');
          return;
        }
        ocupado(botao, true, 'Enviando…');
        try {
          const falha = await enviarFoto(ordem.id, captura, tipo.value, legenda.value.trim() || null);
          if (falha) throw new Error(falha);
          modal.fechar();
          toastSucesso('Foto anexada ao histórico.');
          aoConcluir?.();
        } catch (e) {
          montar(erro, faixaAviso(e.message));
          erro.classList.remove('oculto');
        } finally {
          ocupado(botao, false);
        }
      },
    },
    erro,
    campo('Classificação da foto', tipo, { dica: 'Entrada, saída (após reparo) ou retirada (entrega).' }),
    campo('Legenda', legenda, { opcional: true }),
    captura.elemento,
    info,
  );

  const modal = abrirModal({
    titulo: 'Anexar foto',
    descricao: `OS ${ordem.numero_os}`,
    corpo: formulario,
    rodape: [
      h('button.btn.btn--secundario', { type: 'button', onclick: () => modal.fechar() }, 'Cancelar'),
      botao,
    ],
  });
  return modal;
}

/* -------------------------------------------------------------------------- */
/* Orçamento — envio e decisão                                                */
/* -------------------------------------------------------------------------- */

export function modalOrcamento({ ordem, aoConcluir, garantiaPadrao = 90 }) {
  const valor = h('input.entrada', { type: 'text', inputMode: 'decimal', placeholder: 'Ex: 380,00', value: ordem.orcamento_valor ? String(ordem.orcamento_valor).replace('.', ',') : ordem.valor ? String(ordem.valor).replace('.', ',') : '' });
  const pecas = h('input.entrada', { placeholder: 'Ex: Tela OLED, adesivo de vedação' });
  const observacao = h('textarea.area-texto', { rows: 2, placeholder: 'Ex: valor válido por 7 dias; se aparecer outro defeito avisamos antes.' });
  const erro = linhaErro();
  const corpo = h('div');
  const botao = h('button.btn.btn--primario', { type: 'button', onclick: () => formulario.requestSubmit() }, icone('check', { tamanho: 16 }), 'Gerar link de aprovação');

  const formulario = h(
    'form.pilha',
    {
      novalidate: true,
      onsubmit: async (evento) => {
        evento.preventDefault();
        erro.classList.add('oculto');
        const numero = valor.value.trim() ? Number(valor.value.replace(/\./g, '').replace(',', '.')) : NaN;
        if (!Number.isFinite(numero) || numero < 0) {
          montar(erro, faixaAviso('Informe um valor válido para o orçamento.'));
          erro.classList.remove('oculto');
          valor.focus();
          return;
        }
        ocupado(botao, true, 'Gerando…');
        try {
          const resposta = await api.post(`/api/ordens/${ordem.id}/orcamento`, {
            valor: numero,
            pecas: pecas.value.trim() || null,
            observacao: observacao.value.trim() || null,
          });
          toastSucesso(resposta.mensagem ?? 'Orçamento enviado.');
          aoConcluir?.(resposta);
          mostrarResultado(resposta);
        } catch (e) {
          montar(erro, faixaAviso(e.message));
          erro.classList.remove('oculto');
          toastErro(e.message);
        } finally {
          ocupado(botao, false);
        }
      },
    },
    erro,
    campo('Valor do orçamento (R$) *', valor, { dica: 'O cliente responde aprovar ou recusar pelo link.' }),
    campo('Peças previstas', pecas, { opcional: true }),
    campo('Observação para o cliente', observacao, { opcional: true }),
  );

  function mostrarResultado(resposta) {
    const caixaLink = h('div.link-copiavel', {}, resposta.link);
    botao.classList.add('oculto');
    montar(
      corpo,
      h(
        'div.pilha',
        {},
        h('div.faixa-sucesso', {}, icone('check', { tamanho: 20 }), h('div', {}, h('div.faixa-erro__titulo', {}, 'Orçamento pronto para enviar'), h('div.faixa-erro__texto', {}, `R$ ${Number(resposta.orcamento?.valor ?? 0).toFixed(2)} · aguardando resposta do cliente`))),
        h('div.qr-caixa', {}, qrImagem(resposta.link, { tamanho: 168, alt: 'QR do orçamento' }), h('span.texto-mini.texto-fraco', {}, 'O cliente pode escanear para responder.')),
        caixaLink,
        h(
          'div.compartilhar',
          {},
          h('button.btn.btn--secundario', { type: 'button', onclick: () => copiarLink(caixaLink.textContent) }, icone('olho', { tamanho: 16 }), 'Copiar link'),
          resposta.whatsapp
            ? h(
                'a.btn.btn--primario',
                {
                  href: `https://wa.me/${resposta.whatsapp}?text=${encodeURIComponent(mensagemOrcamento(ordem, resposta.orcamento?.valor, resposta.link))}`,
                  target: '_blank',
                  rel: 'noopener',
                },
                icone('whatsapp', { tamanho: 16 }),
                'Enviar no WhatsApp',
              )
            : null,
        ),
      ),
    );
  }

  montar(corpo, formulario);

  const modal = abrirModal({
    titulo: ordem.orcamento_status === 'pendente' ? 'Reenviar orçamento' : 'Enviar orçamento ao cliente',
    descricao: `OS ${ordem.numero_os} · ${ordem.cliente_nome}`,
    corpo,
    rodape: [h('button.btn.btn--secundario', { type: 'button', onclick: () => modal.fechar() }, 'Fechar'), botao],
  });
  void garantiaPadrao;
  return modal;
}

export function modalDecisaoOrcamento({ ordem, aoConcluir }) {
  const observacao = h('textarea.area-texto', { rows: 2, placeholder: 'Ex: cliente respondeu por telefone às 14h.' });
  const erro = linhaErro();
  const botao = h('button.btn.btn--sucesso', { type: 'button' }, icone('check', { tamanho: 16 }), 'Registrar resposta');

  const decidir = async (decisao) => {
    erro.classList.add('oculto');
    ocupado(botao, true, 'Registrando…');
    try {
      const resposta = await api.post(`/api/ordens/${ordem.id}/orcamento/decisao`, {
        decisao,
        observacao: observacao.value.trim() || null,
      });
      modal.fechar();
      toastSucesso(resposta.mensagem ?? 'Resposta registrada.');
      aoConcluir?.(resposta);
    } catch (e) {
      montar(erro, faixaAviso(e.message));
      erro.classList.remove('oculto');
      toastErro(e.message);
    } finally {
      ocupado(botao, false);
    }
  };

  const escolha = h(
    'div.rastreio__acoes',
    {},
    h('button.btn.btn--sucesso.btn--bloco', { type: 'button', onclick: () => decidir('aprovado') }, icone('check', { tamanho: 16 }), 'Cliente aprovou'),
    h('button.btn.btn--perigo.btn--bloco', { type: 'button', onclick: () => decidir('recusado') }, icone('x', { tamanho: 16 }), 'Cliente recusou'),
  );

  const modal = abrirModal({
    titulo: 'Registrar resposta do cliente',
    descricao: `OS ${ordem.numero_os} · orçamento de ${moeda(ordem.orcamento_valor)}`,
    corpo: h(
      'div.pilha',
      {},
      erro,
      faixaAviso('Use quando o cliente responder por telefone ou no balcão. A decisão fica no histórico.'),
      campo('Observação', observacao, { opcional: true }),
      escolha,
    ),
    rodape: [h('button.btn.btn--secundario', { type: 'button', onclick: () => modal.fechar() }, 'Cancelar')],
  });
  void botao;
  return modal;
}

function mensagemOrcamento(ordem, valor, link) {
  const primeiro = String(ordem.cliente_nome ?? '').split(' ')[0];
  return (
    `Olá, ${primeiro}! Fizemos o orçamento do seu ${ordem.marca} ${ordem.modelo} (OS ${ordem.numero_os}).\n` +
    `Valor: ${moeda(valor)}.\n` +
    `Para aprovar ou recusar, é só abrir o link: ${link}`
  );
}

export async function copiarLink(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    toastSucesso('Link copiado.', { titulo: 'Pronto' });
  } catch {
    toastErro('Não foi possível copiar automaticamente. Toque e segure o link para copiar.', { titulo: 'Copie manualmente' });
  }
}

export { enviarFoto };
