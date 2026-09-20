import { h, montar } from '../dom.js';
import { icone } from '../icons.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { criarCaptura } from '../components/captura.js';
import { abrirModal, ocupado, toastErro, toastSucesso, faixaErro, badgeStatus } from '../ui.js';
import { baixarEtiquetaPdf } from '../etiqueta.js';
import { telefone as formatarTelefone } from '../format.js';
import { criarAssinatura } from '../assinatura.js';
import { recortarAssinatura } from '../image.js';
import { CHECKLIST_ITENS, ROTULOS_SENHA } from '../constantes.js';
import { criarPadrao } from '../padrao.js';

const RASCUNHO = 'tecnoflow.rascunho-os';

function mascararTelefone(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '').slice(0, 11);
  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 6) return `(${digitos.slice(0, 2)}) ${digitos.slice(2)}`;
  if (digitos.length <= 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
}

export function paginaNovaOS(container) {
  const lojas = store.meta?.lojas ?? [];

  const campos = {
    clienteNome: h('input.entrada', { id: 'campo-cliente-nome', type: 'text', autocomplete: 'name', required: true, placeholder: 'Nome completo do cliente' }),
    clienteTelefone: h('input.entrada', { id: 'campo-cliente-telefone', type: 'tel', inputMode: 'tel', autocomplete: 'tel', required: true, placeholder: '(11) 91234-5678' }),
    marca: h('input.entrada', { id: 'campo-marca', type: 'text', required: true, placeholder: 'Apple, Samsung, Motorola…' }),
    modelo: h('input.entrada', { id: 'campo-modelo', type: 'text', required: true, placeholder: 'iPhone 13, Galaxy A54…' }),
    cor: h('input.entrada', { id: 'campo-cor', type: 'text', placeholder: 'Preto, Branco, Azul…' }),
    imei: h('input.entrada', { id: 'campo-imei', type: 'text', inputMode: 'numeric', placeholder: 'Opcional' }),
    acessorios: h('input.entrada', { id: 'campo-acessorios', type: 'text', placeholder: 'Ex: carregador, capa, cartão SIM' }),
    defeitoRelatado: h('textarea.area-texto', { id: 'campo-defeito', required: true, rows: 3, placeholder: 'O que o cliente relatou? Ex: "caiu e a tela trincou, o touch parou de funcionar no canto direito".' }),
    estadoAparelho: h('textarea.area-texto', { id: 'campo-estado', rows: 2, placeholder: 'Ex: tela trincada, traseira riscada, aparelho liga e desliga.' }),
    valorEstimado: h('input.entrada', { id: 'campo-valor-estimado', type: 'text', inputMode: 'decimal', placeholder: 'Ex: 350,00' }),
    lojaId: null,
  };

  if (store.ehAdmin && lojas.length) {
    campos.lojaId = h(
      'select.selecao',
      { required: true },
      ...lojas.filter((l) => l.ativo).map((l) => h('option', { value: String(l.id) }, l.nome)),
    );
  }

  /* ------------------------- Checklist técnico --------------------------- */
  const CHAVES_CHECKLIST = CHECKLIST_ITENS.map((item) => item.chave);

  const checklist = {};
  const itensChecklist = CHECKLIST_ITENS.map((item) => {
    const input = h('input', { type: 'checkbox' });
    checklist[item.chave] = input;
    return h('label.checklist__item', {}, input, h('span', {}, item.rotulo));
  });
  campos.checklistItens = h('input.entrada', { type: 'text', placeholder: 'Ex: capinha, chip, cartão de memória' });
  campos.checklistObs = h('textarea.area-texto', { rows: 2, placeholder: 'Ex: traseira com risco profundo na câmera.' });

  /* ------------------------ Senha do aparelho ---------------------------- */
  const tipoSenha = h(
    'select.selecao',
    {},
    ...Object.entries(ROTULOS_SENHA).map(([valor, rotulo]) => h('option', { value: valor }, rotulo)),
  );
  campos.senhaValor = h('input.entrada', { type: 'text', placeholder: 'Digite a senha informada pelo cliente', autocomplete: 'off', spellcheck: false });
  const padrao = criarPadrao();
  const blocoSenhaTexto = h('div.campo', {}, h('label.campo__rotulo', {}, 'Senha informada'), campos.senhaValor);
  const blocoSenhaPadrao = h('div.campo', {}, h('label.campo__rotulo', {}, 'Desenho do padrão'), padrao.elemento);
  const senhaBox = h(
    'div.senha-box.pilha',
    {},
    h('div.campo', {}, h('label.campo__rotulo', {}, 'Tipo de senha'), tipoSenha),
    blocoSenhaTexto,
    blocoSenhaPadrao,
  );
  const valorSenha = () => (tipoSenha.value === 'padrao' ? padrao.valor() : campos.senhaValor.value.trim());
  const sincronizarSenha = () => {
    const visivel = checklist.senhaInformada.checked;
    senhaBox.classList.toggle('oculto', !visivel);
    const ehPadrao = tipoSenha.value === 'padrao';
    blocoSenhaTexto.classList.toggle('oculto', ehPadrao);
    blocoSenhaPadrao.classList.toggle('oculto', !ehPadrao);
    if (visivel && ehPadrao) setTimeout(() => padrao.ajustar(), 30);
  };
  tipoSenha.addEventListener('change', sincronizarSenha);
  checklist.senhaInformada.addEventListener('change', sincronizarSenha);

  const capturaEntrada = criarCaptura({
    titulo: 'Foto do aparelho na entrada (obrigatória)',
    dica: 'Registre o estado em que o aparelho chegou. Sem esta foto não é possível registrar a OS.',
    legendaFoto: 'Estado do aparelho na entrada',
  });

  const assinaturaEntrada = criarAssinatura({ rotulo: 'Peça para o cliente assinar o termo de entrada' });

  const areaErro = h('div.oculto');
  const botaoSalvar = h('button.btn.btn--primario.btn--grande', { type: 'submit' }, icone('check', { tamanho: 18 }), 'Registrar entrada');

  const formulario = h(
    'form.pilha--grande.pilha',
    {
      novalidate: true,
      onsubmit: async (evento) => {
        evento.preventDefault();
        await salvar();
      },
    },
    areaErro,
    h(
      'div.card',
      {},
      h(
        'div.card__cabecalho',
        {},
        h('h3', {}, 'Cliente'),
        h('span.texto-mini.texto-suave', {}, 'Quem está deixando o aparelho'),
      ),
      h(
        'div.card__corpo.formulario',
        {},
        h(
          'div.formulario__linha.formulario__linha--2',
          {},
          h('div.campo', {}, h('label.campo__rotulo', {}, 'Nome do cliente *'), campos.clienteNome),
          h(
            'div.campo',
            {},
            h('label.campo__rotulo', {}, 'Telefone / WhatsApp *'),
            campos.clienteTelefone,
            h('span.campo__dica', {}, 'Usamos este número para avisar quando o aparelho ficar pronto.'),
          ),
        ),
      ),
    ),
    h(
      'div.card',
      {},
      h(
        'div.card__cabecalho',
        {},
        h('h3', {}, 'Aparelho'),
        h('span.texto-mini.texto-suave', {}, 'Identificação para a bancada'),
      ),
      h(
        'div.card__corpo.formulario',
        {},
        h(
          'div.formulario__linha.formulario__linha--2',
          {},
          h('div.campo', {}, h('label.campo__rotulo', {}, 'Marca *'), campos.marca),
          h('div.campo', {}, h('label.campo__rotulo', {}, 'Modelo *'), campos.modelo),
        ),
        h(
          'div.formulario__linha.formulario__linha--3',
          {},
          h('div.campo', {}, h('label.campo__rotulo', {}, 'Cor'), campos.cor),
          h(
            'div.campo',
            {},
            h('label.campo__rotulo', {}, 'IMEI / nº de série', h('span.campo__opcional', {}, 'opcional')),
            campos.imei,
          ),
          h(
            'div.campo',
            {},
            h('label.campo__rotulo', {}, 'Acessórios deixados', h('span.campo__opcional', {}, 'opcional')),
            campos.acessorios,
          ),
        ),
      ),
    ),
    h(
      'div.card',
      {},
      h(
        'div.card__cabecalho',
        {},
        h('h3', {}, 'Estado e defeito'),
        h('span.texto-mini.texto-suave', {}, 'Quanto mais detalhe, menos discussão depois'),
      ),
      h(
        'div.card__corpo.formulario',
        {},
        h(
          'div.campo',
          {},
          h('label.campo__rotulo', {}, 'Defeito relatado pelo cliente *'),
          campos.defeitoRelatado,
        ),
        h(
          'div.campo',
          {},
          h('label.campo__rotulo', {}, 'Observações sobre o estado do aparelho'),
          campos.estadoAparelho,
        ),
        h(
          'div.campo',
          {},
          h('label.campo__rotulo', {}, 'Orçamento estimado', h('span.campo__opcional', {}, 'opcional')),
          campos.valorEstimado,
          h('span.campo__dica', {}, 'Apenas uma referência — pode ser ajustado na conclusão.'),
        ),
        store.ehAdmin && lojas.length
          ? h(
              'div.campo',
              {},
              h('label.campo__rotulo', {}, 'Loja de entrada *'),
              campos.lojaId,
            )
          : null,
      ),
    ),
    h(
      'div.card',
      {},
      h(
        'div.card__cabecalho',
        {},
        h('h3', {}, 'Checklist técnico'),
        h('span.texto-mini.texto-suave', {}, 'Marcas e avarias na entrada'),
      ),
      h(
        'div.card__corpo.formulario',
        {},
        h('div.checklist', {}, itensChecklist),
        h(
          'div.formulario__linha.formulario__linha--2',
          {},
          h('div.campo', {}, h('label.campo__rotulo', {}, 'Itens deixados com o aparelho'), campos.checklistItens),
          h('div.campo', {}, h('label.campo__rotulo', {}, 'Outras observações da vistoria'), campos.checklistObs),
        ),
        senhaBox,
      ),
    ),
    h(
      'div.card',
      {},
      h(
        'div.card__cabecalho',
        {},
        h('h3', {}, 'Foto de entrada'),
        h('span.texto-mini.texto-suave', {}, 'Evidência do estado inicial'),
      ),
      h('div.card__corpo', {}, capturaEntrada.elemento),
    ),
    h(
      'div.card',
      {},
      h(
        'div.card__cabecalho',
        {},
        h('h3', {}, 'Termo de entrada'),
        h('span.texto-mini.texto-suave', {}, 'Assinatura do cliente'),
      ),
      h(
        'div.card__corpo.pilha',
        {},
        h(
          'p.texto-pequeno.texto-suave',
          {},
          'O cliente declara que entrega o aparelho no estado registrado acima e autoriza o diagnóstico. Guarde este termo no comprovante.',
        ),
        assinaturaEntrada.elemento,
      ),
    ),
    h(
      'div.grupo-botoes.grupo-botoes--bloco',
      {},
      botaoSalvar,
      h('button.btn.btn--secundario.btn--grande', { type: 'button', onclick: () => formulario.reset() }, 'Limpar'),
    ),
    h('p.texto-mini.texto-fraco.texto-central', {}, 'Ao registrar, a OS recebe um número único e passa a fazer parte do histórico auditável.'),
  );

  campos.clienteTelefone.addEventListener('input', (evento) => {
    evento.target.value = mascararTelefone(evento.target.value);
  });

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
          h('h1', {}, 'Nova ordem de serviço'),
          h('p.pagina-cabecalho__desc', {}, store.ehAdmin ? 'Escolha a loja de entrada e registre o aparelho.' : `Entrada em ${store.usuario.lojaNome ?? 'sua loja'}`),
        ),
        h('a.btn.btn--fantasma', { href: '#/painel' }, icone('voltar', { tamanho: 16 }), 'Voltar'),
      ),
      formulario,
    ),
  );

  restaurarRascunho();
  sincronizarSenha();

  function montarChecklist() {
    const saida = {};
    for (const chave of CHAVES_CHECKLIST) {
      if (checklist[chave].checked) saida[chave] = true;
    }
    const itens = campos.checklistItens.value.trim();
    const obs = campos.checklistObs.value.trim();
    if (itens) saida.itensDeixados = itens;
    if (obs) saida.observacoes = obs;
    if (checklist.senhaInformada.checked) {
      const valor = valorSenha();
      if (valor) saida.senha = { tipo: tipoSenha.value, valor };
    }
    return Object.keys(saida).length ? saida : null;
  }

  async function salvar() {
    areaErro.classList.add('oculto');
    const nome = campos.clienteNome.value.trim();
    const telefone = campos.clienteTelefone.value.trim();
    const defeito = campos.defeitoRelatado.value.trim();

    const faltando = [];
    if (nome.length < 2) faltando.push('nome do cliente');
    if (telefone.replace(/\D/g, '').length < 10) faltando.push('telefone válido com DDD');
    if (!campos.marca.value.trim()) faltando.push('marca');
    if (!campos.modelo.value.trim()) faltando.push('modelo');
    if (defeito.length < 3) faltando.push('defeito relatado');
    if (!capturaEntrada.temFoto()) faltando.push('foto de entrada');
    if (assinaturaEntrada.estaVazio()) faltando.push('assinatura do cliente no termo');
    if (checklist.senhaInformada.checked && !valorSenha()) faltando.push('a senha do aparelho (marcou que o cliente informou)');

    if (faltando.length) {
      mostrarErro(`Confira antes de salvar: informe ${faltando.join(', ')}.`);
      return;
    }

    ocupado(botaoSalvar, true, 'Registrando…');
    try {
      const corpo = {
        clienteNome: nome,
        clienteTelefone: telefone,
        marca: campos.marca.value.trim(),
        modelo: campos.modelo.value.trim(),
        cor: campos.cor.value.trim() || null,
        imei: campos.imei.value.trim() || null,
        acessorios: campos.acessorios.value.trim() || null,
        defeitoRelatado: defeito,
        estadoAparelho: campos.estadoAparelho.value.trim() || null,
        checklist: montarChecklist(),
        valorEstimado: campos.valorEstimado.value.trim() ? Number(campos.valorEstimado.value.replace(',', '.')) : null,
        lojaId: campos.lojaId ? Number(campos.lojaId.value) : undefined,
      };

      const resposta = await api.post('/api/ordens', corpo);
      const ordem = resposta.ordem;

      let avisoFoto = null;
      if (capturaEntrada.temFoto()) {
        montar(areaErro, h('div.faixa-aviso', {}, icone('alerta', { tamanho: 18 }), h('span', {}, 'Salvando foto de entrada…')));
        areaErro.classList.remove('oculto');
        try {
          const arquivo = capturaEntrada.obterArquivo();
          await api.enviarArquivo(`/api/ordens/${ordem.id}/fotos`, arquivo.blob, {
            params: { tipo: 'entrada', legenda: arquivo.legenda ?? 'Estado do aparelho na entrada' },
          });
        } catch (erroFoto) {
          avisoFoto = erroFoto.message;
        }
        areaErro.classList.add('oculto');
      }

      // Termo assinado na entrada: vai como anexo do tipo assinatura.
      if (!assinaturaEntrada.estaVazio()) {
        try {
          const blob = await recortarAssinatura(assinaturaEntrada.canvas);
          if (blob) {
            await api.enviarArquivo(`/api/ordens/${ordem.id}/fotos`, blob, {
              params: { tipo: 'assinatura', legenda: 'Assinatura do cliente no termo de entrada' },
            });
          }
        } catch (erroAssinatura) {
          avisoFoto = avisoFoto ? `${avisoFoto}; ${erroAssinatura.message}` : erroAssinatura.message;
        }
      }

      limparRascunho();
      abrirSucesso(ordem, avisoFoto);
    } catch (erro) {
      mostrarErro(erro.message);
      toastErro(erro.message, { titulo: 'Não foi possível registrar' });
    } finally {
      ocupado(botaoSalvar, false);
    }
  }

  function mostrarErro(mensagem) {
    montar(areaErro, faixaErro(mensagem, { titulo: 'Faltam informações' }));
    areaErro.classList.remove('oculto');
    areaErro.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function abrirSucesso(ordem, avisoFoto) {
    const corpo = h(
      'div.pilha',
      {},
      avisoFoto
        ? h('div.faixa-aviso', {}, icone('alerta', { tamanho: 18 }), h('span', {}, `A OS foi salva, mas a foto falhou: ${avisoFoto}. Abra a OS e anexe a foto novamente.`))
        : null,
      h(
        'div.card.card--plana',
        {},
        h(
          'div.card__corpo.pilha--pequena.pilha',
          {},
          h(
            'div.linha.linha--entre',
            {},
            h('span.texto-mono.texto-forte', { style: { fontSize: '1.05rem' } }, ordem.numero_os),
            badgeStatus(ordem.status),
          ),
          h('div.texto-forte', {}, ordem.cliente_nome),
          h('div.texto-pequeno.texto-suave', {}, `${ordem.tipo_aparelho} ${ordem.marca} ${ordem.modelo}${ordem.cor ? ` · ${ordem.cor}` : ''}`),
          h('div.texto-pequeno.texto-suave.linha', { style: { gap: '6px' } }, icone('local', { tamanho: 14 }), ordem.loja_nome),
          h('div.texto-pequeno.texto-suave.linha', { style: { gap: '6px' } }, icone('telefone', { tamanho: 14 }), formatarTelefone(ordem.cliente_telefone)),
        ),
      ),
      h('p.texto-pequeno.texto-suave', {}, 'Cole a etiqueta no aparelho e entregue o comprovante ao cliente.'),
    );

    const modal = abrirModal({
      titulo: 'Entrada registrada',
      descricao: 'A OS já está na fila da loja',
      corpo,
      rodape: [
        h(
          'button.btn.btn--secundario',
          {
            type: 'button',
            onclick: () => {
              modal.fechar();
              window.location.hash = '/nova';
              window.location.reload();
            },
          },
          'Nova entrada',
        ),
        h(
          'button.btn.btn--secundario',
          { type: 'button', onclick: (evento) => gerarEtiqueta(evento.currentTarget, ordem) },
          icone('download', { tamanho: 16 }),
          'Etiqueta PDF',
        ),
        h(
          'a.btn.btn--primario',
          { href: `#/ordens/${ordem.id}`, onclick: () => modal.fechar() },
          'Abrir OS',
        ),
      ],
    });
  }

  async function gerarEtiqueta(botao, ordem) {
    ocupado(botao, true, 'Gerando…');
    try {
      await baixarEtiquetaPdf(ordem);
      toastSucesso('PDF da etiqueta gerado.', { titulo: 'Download iniciado' });
    } catch (erro) {
      toastErro(erro.message, { titulo: 'Não foi possível gerar o PDF' });
    } finally {
      ocupado(botao, false);
    }
  }

  function salvarRascunho() {
    try {
      localStorage.setItem(
        RASCUNHO,
        JSON.stringify({
          clienteNome: campos.clienteNome.value,
          clienteTelefone: campos.clienteTelefone.value,
          marca: campos.marca.value,
          modelo: campos.modelo.value,
          cor: campos.cor.value,
          imei: campos.imei.value,
          acessorios: campos.acessorios.value,
          defeitoRelatado: campos.defeitoRelatado.value,
          estadoAparelho: campos.estadoAparelho.value,
          checklistItens: campos.checklistItens.value,
          checklistObs: campos.checklistObs.value,
          checklist: Object.fromEntries(CHAVES_CHECKLIST.map((c) => [c, checklist[c].checked])),
          valorEstimado: campos.valorEstimado.value,
        }),
      );
    } catch {
      /* sem persistência disponível */
    }
  }

  function restaurarRascunho() {
    try {
      const salvo = JSON.parse(localStorage.getItem(RASCUNHO) ?? 'null');
      if (!salvo) return;
      for (const [chave, valor] of Object.entries(salvo)) {
        if (campos[chave] && typeof valor === 'string') campos[chave].value = valor;
      }
      if (salvo.checklist && typeof salvo.checklist === 'object') {
        for (const chave of CHAVES_CHECKLIST) {
          if (checklist[chave]) checklist[chave].checked = Boolean(salvo.checklist[chave]);
        }
      }
    } catch {
      /* rascunho inválido: ignora */
    }
  }

  function limparRascunho() {
    try {
      localStorage.removeItem(RASCUNHO);
    } catch {
      /* ignora */
    }
  }

  const aoPerderFoco = () => salvarRascunho();
  for (const chave of ['clienteNome', 'clienteTelefone', 'marca', 'modelo', 'cor', 'imei', 'acessorios', 'defeitoRelatado', 'estadoAparelho', 'valorEstimado', 'checklistItens', 'checklistObs']) {
    campos[chave].addEventListener('blur', aoPerderFoco);
  }
  for (const chave of CHAVES_CHECKLIST) checklist[chave].addEventListener('change', aoPerderFoco);

  setTimeout(() => campos.clienteNome.focus(), 60);
}
