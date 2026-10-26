import { h, montar } from '../dom.js';
import { icone } from '../icons.js';
import { api } from '../api.js';
import { store } from '../store.js';
import { abrirModal, ocupado, toastSucesso, toastErro, faixaAviso } from '../ui.js';
import { criarCaptura } from './captura.js';
import { criarAssinatura } from '../assinatura.js';
import { recortarAssinatura, formatarBytes } from '../image.js';
import { enviarAnexo } from '../anexos.js';
import { moeda, telefone as formatarTelefone, mascararTelefone } from '../format.js';
import { ROTULOS_TIPO_FOTO, ehVideoMime, CHECKLIST_ITENS, ROTULOS_SENHA, ROTULOS_STATUS } from '../constantes.js';
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

/** Envia o anexo escolhido na captura (foto comprimida ou vídeo direto). */
async function enviarFoto(ordemId, captura, tipo, legenda) {
  const arquivo = captura?.obterArquivo?.();
  if (!arquivo) return null;
  return enviarAnexo(ordemId, arquivo, { tipo, legenda: arquivo.legenda ?? legenda });
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
    titulo: 'Foto ou vídeo do aparelho pronto',
    dica: 'Evidência do serviço concluído. Pode gravar um vídeo curto mostrando o aparelho funcionando.',
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
          if (captura.temArquivo()) {
            montar(erro, faixaAviso('Enviando o anexo do aparelho pronto…'));
            erro.classList.remove('oculto');
            aviso = await enviarFoto(ordem.id, captura, 'saida', 'Aparelho após o reparo');
          }
          modal.fechar();
          toastSucesso(resposta.mensagem ?? 'Serviço concluído.', { titulo: 'OS pronta para retirada' });
          if (aviso) toastErro(`A OS foi concluída, mas o anexo falhou: ${aviso}`, { titulo: 'Anexo não enviado' });
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
    titulo: 'Foto ou vídeo da entrega',
    dica: 'Opcional. Registra o aparelho sendo devolvido ao cliente — pode ser um vídeo curto.',
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
  const captura = criarCaptura({
    titulo: 'Foto ou vídeo do aparelho',
    dica: 'Tire uma foto, grave um vídeo curto ou escolha um arquivo da galeria.',
  });
  const erro = linhaErro();
  const botao = h('button.btn.btn--primario', { type: 'button', onclick: () => formulario.requestSubmit() }, icone('check', { tamanho: 16 }), 'Anexar na OS');
  const info = h('div.texto-mini.texto-fraco');

  captura.elemento.addEventListener('change', () => {
    const arquivo = captura.obterArquivo();
    if (!arquivo) return;
    info.textContent = ehVideoMime(arquivo.mime)
      ? `Vídeo: ${formatarBytes(arquivo.bytes)} · sem compressão`
      : `Tamanho final: ${formatarBytes(arquivo.bytes)}`;
  });

  const formulario = h(
    'form.pilha',
    {
      novalidate: true,
      onsubmit: async (evento) => {
        evento.preventDefault();
        if (!captura.temArquivo()) {
          montar(erro, faixaAviso('Selecione uma foto ou vídeo antes de anexar.'));
          erro.classList.remove('oculto');
          return;
        }
        ocupado(botao, true, 'Enviando…');
        try {
          const falha = await enviarFoto(ordem.id, captura, tipo.value, legenda.value.trim() || null);
          if (falha) throw new Error(falha);
          modal.fechar();
          toastSucesso('Anexo salvo no histórico da OS.');
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
    campo('Classificação do anexo', tipo, { dica: 'Entrada, saída (após reparo) ou retirada (entrega).' }),
    campo('Legenda', legenda, { opcional: true }),
    captura.elemento,
    info,
  );

  const modal = abrirModal({
    titulo: 'Anexar foto ou vídeo',
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
/* Editar dados da OS                                                         */
/* -------------------------------------------------------------------------- */

/** "2026-10-26T14:30" (hora local) para o input datetime-local. */
function dataLocalParaInput(iso) {
  if (!iso) return '';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  const dois = (numero) => String(numero).padStart(2, '0');
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}T${dois(data.getHours())}:${dois(data.getMinutes())}`;
}

/** "2026-10-26" (data local) para o input date. */
function dataParaInput(iso) {
  if (!iso) return '';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  const dois = (numero) => String(numero).padStart(2, '0');
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}`;
}

function checklistDeOrigem(bruto) {
  if (!bruto) return {};
  try {
    const objeto = typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
    return objeto && typeof objeto === 'object' ? objeto : {};
  } catch {
    return {};
  }
}

function mesmaEstrutura(a, b) {
  const normalizar = (valor) =>
    JSON.stringify(
      valor && typeof valor === 'object'
        ? Object.keys(valor)
            .sort()
            .reduce((saida, chave) => ({ ...saida, [chave]: valor[chave] }), {})
        : valor,
    );
  return normalizar(a) === normalizar(b);
}

/**
 * Correção completa dos dados da OS (admin/técnico): cliente, aparelho, loja,
 * número, status, técnico, prioridade, datas, valores, garantia e checklist.
 * Cada mudança real vira um registro "antes → depois" na linha do tempo.
 * Número e data de criação não mudam (são o registro de auditoria da entrada).
 *
 * @param {object} opcoes
 * @param {Array<{valor: string, rotulo: string}>} opcoes.transicoes status para
 *   os quais a OS pode ir agora (vem da API, com as permissões do usuário).
 */
export function modalEditarOS({ ordem, aoConcluir, transicoes = [] }) {
  const lojas = store.meta?.lojas ?? [];
  const tecnicos = store.meta?.tecnicos ?? [];
  const checklistOrigem = checklistDeOrigem(ordem.checklist);

  /* ------------------------------ Entrada ------------------------------- */

  const seletorLoja = lojas.length
    ? h(
        'select.selecao',
        { dataset: { campo: 'loja' } },
        ...lojas.map((l) =>
          h(
            'option',
            { value: String(l.id), selected: Number(l.id) === Number(ordem.loja_id) },
            l.ativo ? l.nome : `${l.nome} (desativada)`,
          ),
        ),
      )
    : null;

  const numero = h('input.entrada', {
    value: ordem.numero_os ?? '',
    maxLength: 20,
    style: { textTransform: 'uppercase' },
    placeholder: 'Ex: GUA-0007',
    spellcheck: false,
  });

  const clienteNome = h('input.entrada', { value: ordem.cliente_nome ?? '', required: true });
  const clienteTelefone = h('input.entrada', { type: 'tel', inputMode: 'tel', value: ordem.cliente_telefone ?? '', required: true });
  const recebidoPor = h('input.entrada', { value: ordem.recebido_por ?? '', placeholder: 'Quem entregou o aparelho' });

  /* ------------------------------ Aparelho ------------------------------ */

  const tipo = h('input.entrada', { value: ordem.tipo_aparelho ?? 'Celular', list: 'tipos-aparelho' });
  const tipos = h(
    'datalist',
    { id: 'tipos-aparelho' },
    ...['Celular', 'Tablet', 'Notebook', 'Smartwatch', 'Console', 'Outro'].map((valor) => h('option', { value: valor })),
  );
  const marca = h('input.entrada', { value: ordem.marca ?? '', required: true });
  const modelo = h('input.entrada', { value: ordem.modelo ?? '', required: true });
  const cor = h('input.entrada', { value: ordem.cor ?? '', placeholder: 'Opcional' });
  const imei = h('input.entrada', { value: ordem.imei ?? '', placeholder: 'Opcional' });
  const acessorios = h('input.entrada', { value: ordem.acessorios ?? '', placeholder: 'Ex: carregador, capa, cartão SIM' });
  const defeitoRelatado = h('textarea.area-texto', { rows: 3, required: true, value: ordem.defeito_relatado ?? '' });
  const estadoAparelho = h('textarea.area-texto', { rows: 2, placeholder: 'Ex: tela trincada, traseira riscada.' });
  estadoAparelho.value = ordem.estado_aparelho ?? '';

  clienteTelefone.addEventListener('input', (evento) => {
    evento.target.value = mascararTelefone(evento.target.value);
  });

  /* ------------------------------- Reparo ------------------------------- */

  const status = h(
    'select.selecao',
    { dataset: { campo: 'status' } },
    h('option', { value: ordem.status, selected: true }, `${ROTULOS_STATUS[ordem.status] ?? ordem.status} (atual)`),
    ...transicoes
      .filter((transicao) => transicao.valor !== ordem.status)
      .map((transicao) => h('option', { value: transicao.valor }, `${transicao.rotulo} — mudar agora`)),
  );

  const tecnico = h(
    'select.selecao',
    { dataset: { campo: 'tecnico' } },
    h('option', { value: '' }, 'Sem responsável'),
    ...tecnicos.map((t) => h('option', { value: String(t.id), selected: Number(t.id) === Number(ordem.tecnico_id) }, t.nome)),
  );

  const prioridade = h(
    'select.selecao',
    { dataset: { campo: 'prioridade' } },
    ...[
      ['baixa', 'Baixa'],
      ['normal', 'Normal'],
      ['alta', 'Alta'],
    ].map(([valor, rotulo]) => h('option', { value: valor, selected: (ordem.prioridade ?? 'normal') === valor }, rotulo)),
  );

  const inicio = h('input.entrada', { type: 'datetime-local', value: dataLocalParaInput(ordem.iniciado_em) });
  const conclusao = h('input.entrada', { type: 'datetime-local', value: dataLocalParaInput(ordem.concluido_em) });
  const retirada = h('input.entrada', { type: 'datetime-local', value: dataLocalParaInput(ordem.retirado_em) });

  /* ------------------------------ Financeiro ----------------------------- */

  const valor = h('input.entrada', {
    type: 'text',
    inputMode: 'decimal',
    placeholder: 'Ex: 350,00',
    value: ordem.valor != null ? String(ordem.valor).replace('.', ',') : '',
  });
  const pagou = h('input', { type: 'checkbox', checked: Number(ordem.valor_pago) === 1, style: { width: '18px', height: '18px' } });
  const forma = h(
    'select.selecao',
    { dataset: { campo: 'formaPagamento' } },
    h('option', { value: '' }, 'Não informar'),
    ...[
      ['pix', 'Pix'],
      ['dinheiro', 'Dinheiro'],
      ['credito', 'Cartão de crédito'],
      ['debito', 'Cartão de débito'],
      ['outro', 'Outro'],
    ].map(([valorForma, rotulo]) => h('option', { value: valorForma, selected: ordem.forma_pagamento === valorForma }, rotulo)),
  );
  const garantiaDias = h('input.entrada', {
    type: 'number',
    min: '0',
    max: '3650',
    inputMode: 'numeric',
    placeholder: '90',
    value: ordem.garantia_dias != null ? String(ordem.garantia_dias) : '',
  });
  const garantiaAte = h('input.entrada', { type: 'date', value: dataParaInput(ordem.garantia_ate) });
  const garantiaAteInicial = garantiaAte.value;

  /* ------------------------------ Checklist ------------------------------ */

  const marcacoes = Object.fromEntries(
    CHECKLIST_ITENS.map((item) => [
      item.chave,
      h('input', { type: 'checkbox', checked: Boolean(checklistOrigem[item.chave]) }),
    ]),
  );
  const itensDeixados = h('input.entrada', {
    value: checklistOrigem.itensDeixados ?? '',
    placeholder: 'Ex: capinha, chip, cartão de memória',
  });
  const observacoesChecklist = h('textarea.area-texto', {
    rows: 2,
    placeholder: 'Ex: traseira com risco profundo na câmera.',
  });
  observacoesChecklist.value = checklistOrigem.observacoes ?? '';

  const tipoSenha = h(
    'select.selecao',
    { dataset: { campo: 'tipoSenha' } },
    ...Object.entries(ROTULOS_SENHA).map(([valorTipo, rotulo]) =>
      h('option', { value: valorTipo, selected: (checklistOrigem.senha?.tipo ?? 'numerica') === valorTipo }, rotulo),
    ),
  );
  const senhaValor = h('input.entrada', {
    value: checklistOrigem.senha?.valor ?? '',
    autocomplete: 'off',
    spellcheck: false,
    placeholder: 'Senha informada pelo cliente',
  });

  const marcouSenha = Boolean(checklistOrigem.senha?.valor);
  const temSenha = h('input', { type: 'checkbox', checked: marcouSenha, style: { width: '18px', height: '18px' } });
  const blocoSenha = h(
    'div.pilha--pequena.pilha',
    {},
    h(
      'div.formulario__linha.formulario__linha--2',
      {},
      campo('Tipo de senha', tipoSenha),
      campo('Senha', senhaValor),
    ),
  );
  const sincronizarSenha = () => blocoSenha.classList.toggle('oculto', !temSenha.checked);
  temSenha.addEventListener('change', sincronizarSenha);
  sincronizarSenha();

  function montarChecklist() {
    const saida = {};
    for (const item of CHECKLIST_ITENS) if (marcacoes[item.chave].checked) saida[item.chave] = true;
    const itens = itensDeixados.value.trim();
    const obs = observacoesChecklist.value.trim();
    if (itens) saida.itensDeixados = itens;
    if (obs) saida.observacoes = obs;
    if (temSenha.checked && senhaValor.value.trim()) {
      saida.senha = { tipo: tipoSenha.value, valor: senhaValor.value.trim() };
    }
    return Object.keys(saida).length ? saida : null;
  }

  /* ------------------------------- Envio -------------------------------- */

  const erro = linhaErro();
  const botao = h('button.btn.btn--primario', { type: 'button', onclick: () => formulario.requestSubmit() }, icone('check', { tamanho: 16 }), 'Salvar alterações');

  const secao = (titulo) => h('div.rotulo-flutuante', { style: { marginTop: '6px' } }, titulo);

  function textoOuNulo(elemento) {
    const texto = elemento.value.trim();
    return texto || null;
  }

  function dataIso(elemento, inicial) {
    if (elemento.value === inicial) return undefined;
    if (!elemento.value) return null;
    const data = new Date(elemento.value);
    return Number.isNaN(data.getTime()) ? null : data.toISOString();
  }

  const formulario = h(
    'form.pilha',
    {
      novalidate: true,
      onsubmit: async (evento) => {
        evento.preventDefault();
        erro.classList.add('oculto');
        if (clienteNome.value.trim().length < 2 || !marca.value.trim() || !modelo.value.trim() || defeitoRelatado.value.trim().length < 3) {
          montar(erro, faixaAviso('Confira os campos obrigatórios: nome do cliente, marca, modelo e defeito relatado.'));
          erro.classList.remove('oculto');
          return;
        }
        if (String(clienteTelefone.value).replace(/\D/g, '').length < 10) {
          montar(erro, faixaAviso('Informe um telefone válido com DDD.'));
          erro.classList.remove('oculto');
          clienteTelefone.focus();
          return;
        }
        const numeroDigitado = numero.value.trim().toUpperCase();
        const numeroMudou = numeroDigitado !== String(ordem.numero_os);
        if (numeroMudou && !/^[A-Z0-9]{2,6}-\d{3,6}$/.test(numeroDigitado)) {
          montar(erro, faixaAviso('Número da OS inválido. Use o formato CODIGO-0000 (ex.: GUA-0007).'));
          erro.classList.remove('oculto');
          numero.focus();
          return;
        }

        ocupado(botao, true, 'Salvando…');
        try {
          const corpo = {
            clienteNome: clienteNome.value.trim(),
            clienteTelefone: clienteTelefone.value.trim(),
            recebidoPor: textoOuNulo(recebidoPor),
            tipoAparelho: tipo.value.trim() || 'Celular',
            marca: marca.value.trim(),
            modelo: modelo.value.trim(),
            cor: textoOuNulo(cor),
            imei: textoOuNulo(imei),
            acessorios: textoOuNulo(acessorios),
            defeitoRelatado: defeitoRelatado.value.trim(),
            estadoAparelho: textoOuNulo(estadoAparelho),
            prioridade: prioridade.value,
            tecnicoId: tecnico.value ? Number(tecnico.value) : null,
            valor: valor.value.trim() ? Number(valor.value.replace(/\./g, '').replace(',', '.')) : null,
            valorPago: pagou.checked,
            formaPagamento: forma.value || null,
            garantiaDias: garantiaDias.value.trim() ? Number(garantiaDias.value) : null,
            lojaId: seletorLoja ? Number(seletorLoja.value) : undefined,
          };
          if (numeroMudou) corpo.numeroOS = numeroDigitado;
          if (status.value !== ordem.status) corpo.status = status.value;
          if (garantiaAte.value !== garantiaAteInicial) corpo.garantiaAte = garantiaAte.value || null;

          const inicioIso = dataIso(inicio, dataLocalParaInput(ordem.iniciado_em));
          if (inicioIso !== undefined) corpo.iniciadoEm = inicioIso;
          const conclusaoIso = dataIso(conclusao, dataLocalParaInput(ordem.concluido_em));
          if (conclusaoIso !== undefined) corpo.concluidoEm = conclusaoIso;
          const retiradaIso = dataIso(retirada, dataLocalParaInput(ordem.retirado_em));
          if (retiradaIso !== undefined) corpo.retiradoEm = retiradaIso;

          const checklistNovo = montarChecklist();
          if (!mesmaEstrutura(checklistNovo ?? {}, checklistOrigem)) corpo.checklist = checklistNovo;

          const resposta = await api.patch(`/api/ordens/${ordem.id}`, corpo);
          modal.fechar();
          toastSucesso(resposta.mensagem ?? 'Dados atualizados.', { titulo: 'OS atualizada' });
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
    faixaAviso('Cada alteração fica registrada no histórico com o valor anterior e o novo. A data de entrada e quem lançou a OS não mudam; ao trocar de loja, o número da OS acompanha a loja de destino.'),
    secao('Cliente'),
    h(
      'div.formulario__linha.formulario__linha--2',
      {},
      campo('Nome do cliente *', clienteNome),
      campo('WhatsApp *', clienteTelefone),
    ),
    campo('Recebido por', recebidoPor, { opcional: true, dica: 'Quem entregou o aparelho no balcão (pode ser diferente do cliente).' }),
    secao('Entrada'),
    h(
      'div.formulario__linha.formulario__linha--2',
      {},
      seletorLoja
        ? campo('Loja de entrada *', seletorLoja, {
            dica: 'Ao trocar a loja, o número da OS passa para a numeração da loja de destino (ex.: GUA-0001 → CUM-0006) e o número antigo fica no histórico.',
          })
        : h('div'),
      campo('Número da OS', numero, { dica: 'Só altere para corrigir um erro de digitação. O número antigo continua valendo no rastreio do cliente.' }),
    ),
    secao('Aparelho'),
    h(
      'div.formulario__linha.formulario__linha--3',
      {},
      campo('Tipo', tipo),
      campo('Marca *', marca),
      campo('Modelo *', modelo),
    ),
    h(
      'div.formulario__linha.formulario__linha--3',
      {},
      campo('Cor', cor, { opcional: true }),
      campo('IMEI / nº de série', imei, { opcional: true }),
      campo('Acessórios', acessorios, { opcional: true }),
    ),
    campo('Defeito relatado *', defeitoRelatado, { dica: 'Corrija aqui se a descrição foi digitada errada na entrada.' }),
    campo('Estado do aparelho', estadoAparelho, { opcional: true }),
    secao('Reparo'),
    h(
      'div.formulario__linha.formulario__linha--3',
      {},
      campo('Status', status, { dica: 'A edição anda dentro do fluxo normal — não pula etapa.' }),
      campo('Técnico responsável', tecnico),
      campo('Prioridade', prioridade),
    ),
    h(
      'div.formulario__linha.formulario__linha--3',
      {},
      campo('Início do reparo', inicio, { opcional: true }),
      campo('Conclusão', conclusao, { opcional: true }),
      campo('Retirada', retirada, { opcional: true }),
    ),
    secao('Serviço e pagamento'),
    h(
      'div.formulario__linha.formulario__linha--2',
      {},
      campo('Valor do serviço (R$)', valor, { opcional: true }),
      campo('Forma de pagamento', forma, { opcional: true }),
    ),
    h(
      'label.linha',
      { style: { gap: '10px', cursor: 'pointer', alignItems: 'center' } },
      pagou,
      h('span', { style: { flex: '1' } }, h('span.texto-forte', {}, 'Pagamento confirmado'), h('div.texto-mini.texto-fraco', {}, 'Marque quando o cliente já pagou o serviço.')),
    ),
    h(
      'div.formulario__linha.formulario__linha--2',
      {},
      campo('Garantia (dias)', garantiaDias, { opcional: true, dica: 'Alterar os dias recalcula a data-limite a partir da retirada.' }),
      campo('Garantia até', garantiaAte, { opcional: true }),
    ),
    secao('Checklist técnico'),
    h('div.checklist', {}, ...CHECKLIST_ITENS.map((item) => h('label.checklist__item', {}, marcacoes[item.chave], h('span', {}, item.rotulo)))),
    campo('Itens deixados com o aparelho', itensDeixados, { opcional: true }),
    campo('Observações da vistoria', observacoesChecklist, { opcional: true }),
    h(
      'label.linha',
      { style: { gap: '10px', cursor: 'pointer', alignItems: 'center' } },
      temSenha,
      h('span', { style: { flex: '1' } }, h('span.texto-forte', {}, 'Cliente informou a senha do aparelho'), h('div.texto-mini.texto-fraco', {}, 'A senha fica na OS, mas nunca é copiada para o histórico.'))),
    blocoSenha,
    tipos,
  );

  const modal = abrirModal({
    titulo: 'Editar dados da OS',
    descricao: `OS ${ordem.numero_os} · ${ordem.loja_nome ?? ''}`,
    corpo: formulario,
    largura: '760px',
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
