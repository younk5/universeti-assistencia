import { h, montar } from '../dom.js';
import { icone } from '../icons.js';
import { api } from '../api.js';
import { abrirModal, ocupado, toastSucesso, toastErro, faixaAviso } from '../ui.js';
import { criarCaptura } from './captura.js';
import { criarAssinatura } from '../assinatura.js';
import { recortarAssinatura, formatarBytes } from '../image.js';
import { moeda, telefone as formatarTelefone } from '../format.js';
import { ROTULOS_TIPO_FOTO } from '../constantes.js';

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

export function modalFinalizarOS({ ordem, aoConcluir }) {
  const servico = h('textarea.area-texto', {
    rows: 3,
    required: true,
    placeholder: 'Ex: Troca de tela OLED + vedação. Testado touch, câmera e face ID.',
  });
  const pecas = h('input.entrada', { placeholder: 'Ex: Tela OLED, adesivo de vedação' });
  const valor = h('input.entrada', { type: 'text', inputMode: 'decimal', placeholder: '480,00', value: ordem.valor ? String(ordem.valor).replace('.', ',') : '' });
  const garantia = h('input.entrada', { type: 'number', min: '0', max: '3650', placeholder: '90', inputMode: 'numeric' });
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

export { enviarFoto };
