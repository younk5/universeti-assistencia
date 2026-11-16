import { h, montar, debounce } from '../dom.js';
import { icone } from '../icons.js';
import { store } from '../store.js';
import { api } from '../api.js';
import {
  abrirModal,
  confirmar,
  esqueletoLista,
  faixaErro,
  estadoVazio,
  toastSucesso,
  toastErro,
  ocupado,
} from '../ui.js';
import { moeda, data, numero } from '../format.js';

/**
 * Inventário de peças (exclusivo do administrador).
 *
 * A aba só aparece no menu para admin (`inventario.gerir`) e o backend repete a
 * checagem em todas as rotas — esconder o link não é autorização.
 */

const ABAS = [
  { id: 'pecas', rotulo: 'Peças', icone: 'pacote' },
  { id: 'fornecedores', rotulo: 'Fornecedores', icone: 'loja' },
];

/** Aceita "1.234,56", "1234,56" e "1234.56". */
function paraNumero(texto) {
  const limpo = String(texto ?? '').trim().replace(/\s/g, '').replace(/^R\$/i, '');
  if (!limpo) return NaN;
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  return Number(normalizado);
}

function campo(rotulo, entrada, { dica = null } = {}) {
  return h(
    'div.campo',
    {},
    h('label.campo__rotulo', {}, rotulo),
    entrada,
    dica ? h('span.campo__dica', {}, dica) : null,
  );
}

export async function paginaInventario(container) {
  if (!store.pode('inventario.gerir')) {
    montar(
      container,
      h(
        'div.card',
        {},
        h(
          'div.card__corpo',
          {},
          estadoVazio({
            icone: 'cadeado',
            titulo: 'Área restrita',
            texto: 'O inventário de peças, os custos e o relatório de gastos por fornecedor são exclusivos do administrador.',
          }),
        ),
      ),
    );
    return;
  }

  let abaAtiva = 'pecas';
  const estado = {
    pecas: [],
    fornecedores: [],
    carregando: true,
    erro: null,
  };
  const filtros = { busca: '', fornecedorId: '' };

  const areaAbas = h('div.abas', { role: 'tablist' });
  const areaConteudo = h('div', {}, esqueletoLista(2));

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
          h('h1', {}, 'Inventário'),
          h('p.pagina-cabecalho__desc', {}, 'Fornecedores, peças e custo real de cada serviço'),
        ),
      ),
      areaAbas,
      areaConteudo,
    ),
  );

  await carregar();

  async function carregar() {
    estado.carregando = true;
    estado.erro = null;
    desenhar();
    try {
      const [fornecedores, pecas] = await Promise.all([
        api.get('/api/inventario/fornecedores'),
        api.get('/api/inventario/pecas', {
          busca: filtros.busca || undefined,
          fornecedorId: filtros.fornecedorId || undefined,
          inativas: '1',
        }),
      ]);
      estado.fornecedores = fornecedores.fornecedores ?? [];
      estado.pecas = pecas.pecas ?? [];
    } catch (erro) {
      estado.erro = erro.message;
    } finally {
      estado.carregando = false;
      desenhar();
    }
  }

  /** Recarrega só a lista de peças (busca/filtro), mantendo os fornecedores. */
  async function carregarPecas() {
    try {
      const resposta = await api.get('/api/inventario/pecas', {
        busca: filtros.busca || undefined,
        fornecedorId: filtros.fornecedorId || undefined,
        inativas: '1',
      });
      estado.pecas = resposta.pecas ?? [];
    } catch (erro) {
      toastErro(erro.message, { titulo: 'Não foi possível filtrar' });
    }
    desenhar();
  }

  function desenhar() {
    montar(
      areaAbas,
      ...ABAS.map((aba) =>
        h(
          'button.aba',
          {
            type: 'button',
            role: 'tab',
            'aria-selected': abaAtiva === aba.id ? 'true' : 'false',
            onclick: () => {
              abaAtiva = aba.id;
              desenhar();
            },
          },
          aba.rotulo,
          aba.id === 'pecas' ? ` (${estado.pecas.length})` : ` (${estado.fornecedores.length})`,
        ),
      ),
    );

    if (estado.carregando) {
      montar(areaConteudo, esqueletoLista(2));
      return;
    }
    if (estado.erro) {
      montar(areaConteudo, faixaErro(estado.erro, { aoTentar: carregar }));
      return;
    }
    montar(areaConteudo, abaAtiva === 'pecas' ? renderPecas() : renderFornecedores());
  }

  /* --------------------------------- Peças -------------------------------- */

  function renderPecas() {
    const botaoNova = h(
      'button.btn.btn--primario',
      { type: 'button', onclick: () => modalPeca(null) },
      icone('pacote', { tamanho: 16 }),
      'Nova peça',
    );

    const busca = h('input.entrada', {
      type: 'search',
      value: filtros.busca,
      placeholder: 'Buscar por peça, modelo ou fornecedor',
      'aria-label': 'Buscar peça',
    });
    busca.addEventListener(
      'input',
      debounce(() => {
        filtros.busca = busca.value.trim();
        carregarPecas();
      }, 320),
    );

    const filtroFornecedor = h(
      'select.selecao',
      {
        'aria-label': 'Filtrar por fornecedor',
        onchange: (evento) => {
          filtros.fornecedorId = evento.currentTarget.value;
          carregarPecas();
        },
      },
      h('option', { value: '', selected: !filtros.fornecedorId }, 'Todos os fornecedores'),
      ...estado.fornecedores.map((fornecedor) =>
        h(
          'option',
          { value: String(fornecedor.id), selected: String(filtros.fornecedorId) === String(fornecedor.id) },
          fornecedor.nome,
        ),
      ),
    );

    const areaFiltros = h(
      'div.filtros',
      {},
      h('div', { style: { gridColumn: '1 / -1' } }, campo('Buscar', busca)),
      h('div', {}, h('label.campo__rotulo', {}, 'Fornecedor'), filtroFornecedor),
      h(
        'div',
        {},
        h('label.campo__rotulo', {}, '\u00a0'),
        h(
          'button.btn.btn--secundario.btn--bloco',
          {
            type: 'button',
            onclick: () => {
              filtros.busca = '';
              filtros.fornecedorId = '';
              carregarPecas();
            },
          },
          icone('filtroX', { tamanho: 16 }),
          'Limpar filtros',
        ),
      ),
    );

    if (!estado.pecas.length) {
      return h(
        'div.pilha',
        {},
        areaFiltros,
        h(
          'div.card',
          {},
          estadoVazio({
            icone: 'pacote',
            titulo: filtros.busca || filtros.fornecedorId ? 'Nenhuma peça encontrada' : 'Inventário vazio',
            texto:
              filtros.busca || filtros.fornecedorId
                ? 'Ajuste a busca ou o filtro de fornecedor.'
                : 'Cadastre as peças com preço de custo e fornecedor para acompanhar quanto cada loja gasta em serviços.',
            acao: botaoNova,
          }),
        ),
      );
    }

    const totalCustoEstoque = estado.pecas.reduce(
      (soma, peca) => soma + (peca.quantidade_estoque ?? 0) * peca.preco_custo,
      0,
    );

    return h(
      'div.pilha',
      {},
      h('div.linha.linha--entre.linha--quebra', { style: { gap: '10px' } }, h('h2', {}, 'Peças'), botaoNova),
      areaFiltros,
      h(
        'div.texto-pequeno.texto-suave',
        {},
        `${estado.pecas.length} peça(s) · valor em estoque ${moeda(totalCustoEstoque)}`,
      ),
      h(
        'div.tabela-wrapper',
        {},
        h(
          'table.tabela',
          {},
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', {}, 'Peça'),
              h('th', {}, 'Fornecedor'),
              h('th', {}, 'Custo'),
              h('th', {}, 'Estoque'),
              h('th', {}, 'Usada'),
              h('th', {}, 'Ações'),
            ),
          ),
          h(
            'tbody',
            {},
            ...estado.pecas.map((peca) =>
              h(
                'tr',
                {},
                h(
                  'td',
                  {},
                  h('div.texto-forte', {}, peca.nome),
                  h(
                    'div.texto-mini.texto-fraco',
                    {},
                    peca.modelo || 'Modelo não informado',
                    peca.ativo ? '' : ' · desativada',
                  ),
                ),
                h('td', {}, peca.fornecedor_nome),
                h('td', {}, moeda(peca.preco_custo)),
                h(
                  'td',
                  {},
                  peca.controla_estoque
                    ? h(
                        'span.badge.badge--sem-ponto' + (peca.quantidade_estoque > 0 ? '.badge--pronto' : '.badge--cancelado'),
                        {},
                        `${numero(peca.quantidade_estoque)} un.`,
                      )
                    : h('span.texto-mini.texto-fraco', {}, 'sem controle'),
                ),
                h('td.texto-pequeno', {}, `${numero(peca.total_usado)} un.`),
                h(
                  'td',
                  {},
                  h(
                    'div.linha',
                    { style: { gap: '4px', flexWrap: 'wrap' } },
                    h(
                      'button.btn.btn--pequeno.btn--secundario',
                      { type: 'button', onclick: () => modalPeca(peca) },
                      icone('editar', { tamanho: 14 }),
                      'Editar',
                    ),
                    peca.ativo
                      ? h(
                          'button.btn.btn--pequeno.btn--fantasma',
                          { type: 'button', onclick: () => alternarAtivoPeca(peca) },
                          'Desativar',
                        )
                      : h(
                          'button.btn.btn--pequeno.btn--secundario',
                          { type: 'button', onclick: () => alternarAtivoPeca(peca) },
                          'Reativar',
                        ),
                    h(
                      'button.btn.btn--pequeno.btn--perigo',
                      { type: 'button', onclick: () => excluirPeca(peca) },
                      icone('x', { tamanho: 14 }),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      h(
        'p.texto-mini.texto-fraco',
        {},
        'O preço usado em um serviço fica congelado no momento da conclusão da OS: reajustes aqui não alteram relatórios antigos.',
      ),
    );
  }

  function modalPeca(peca) {
    const editando = Boolean(peca);
    const nome = h('input.entrada', { value: peca?.nome ?? '', placeholder: 'Ex: Tela iPhone 13' });
    const modelo = h('input.entrada', { value: peca?.modelo ?? '', placeholder: 'Ex: iPhone 13 / A2633' });
    const preco = h('input.entrada', {
      value: peca ? String(peca.preco_custo).replace('.', ',') : '',
      inputMode: 'decimal',
      placeholder: '0,00',
    });
    const fornecedor = h(
      'select.selecao',
      {},
      h('option', { value: '' }, 'Selecione o fornecedor'),
      ...estado.fornecedores
        .filter((f) => f.ativo || String(f.id) === String(peca?.fornecedor_id))
        .map((f) =>
          h('option', { value: String(f.id), selected: String(peca?.fornecedor_id) === String(f.id) }, f.nome),
        ),
    );
    const estoque = h('input.entrada', {
      type: 'number',
      min: '0',
      step: '1',
      inputMode: 'numeric',
      value: peca?.quantidade_estoque === null || peca?.quantidade_estoque === undefined ? '' : String(peca.quantidade_estoque),
      placeholder: 'Deixe vazio para não controlar',
    });

    const erro = h('div.oculto');
    const botao = h(
      'button.btn.btn--primario',
      { type: 'button', onclick: () => formulario.requestSubmit() },
      icone('check', { tamanho: 16 }),
      editando ? 'Salvar alterações' : 'Cadastrar peça',
    );

    function mostrarErro(mensagem) {
      montar(
        erro,
        h(
          'div.faixa-erro',
          {},
          icone('alerta', { tamanho: 20 }),
          h('div', {}, h('div.faixa-erro__titulo', {}, 'Revise os dados'), h('div.faixa-erro__texto', {}, mensagem)),
        ),
      );
      erro.classList.remove('oculto');
    }

    const formulario = h(
      'form.pilha',
      {
        novalidate: true,
        onsubmit: async (evento) => {
          evento.preventDefault();
          erro.classList.add('oculto');

          if (nome.value.trim().length < 2) return mostrarErro('Informe o nome da peça (mínimo 2 caracteres).');
          if (!fornecedor.value) return mostrarErro('Selecione o fornecedor da peça.');
          const valorPreco = paraNumero(preco.value);
          if (!Number.isFinite(valorPreco) || valorPreco <= 0) {
            return mostrarErro('Informe um preço de custo numérico maior que zero (ex: 350,00).');
          }
          const valorEstoque = estoque.value.trim();
          if (valorEstoque !== '') {
            const quantidade = Number(valorEstoque);
            if (!Number.isInteger(quantidade) || quantidade < 0) {
              return mostrarErro('A quantidade em estoque deve ser um número inteiro (0 ou mais).');
            }
          }

          const corpo = {
            nome: nome.value.trim(),
            modelo: modelo.value.trim() || null,
            precoCusto: valorPreco,
            fornecedorId: Number(fornecedor.value),
            quantidadeEstoque: valorEstoque === '' ? null : Number(valorEstoque),
          };

          ocupado(botao, true, 'Salvando…');
          try {
            const resposta = editando
              ? await api.patch(`/api/inventario/pecas/${peca.id}`, corpo)
              : await api.post('/api/inventario/pecas', corpo);
            modal.fechar();
            toastSucesso(resposta.mensagem);
            await carregar();
          } catch (e) {
            mostrarErro(e.message);
          } finally {
            ocupado(botao, false);
          }
        },
      },
      erro,
      campo('Nome da peça *', nome, { dica: 'Como você reconhece a peça no balcão.' }),
      campo('Modelo / aparelho compatível', modelo),
      campo('Preço de custo (R$) *', preco, { dica: 'Use vírgula para centavos. Ex: 600,00' }),
      campo('Fornecedor *', fornecedor, { dica: 'Quem vende a peça. É por ele que o relatório agrupa os gastos.' }),
      campo('Quantidade em estoque', estoque, {
        dica: 'Opcional. Com estoque controlado, a conclusão da OS dá baixa automática e bloqueia peça sem saldo.',
      }),
    );

    const modal = abrirModal({
      titulo: editando ? 'Editar peça' : 'Nova peça',
      descricao: editando ? 'Alterar o preço não muda o custo de serviços já concluídos.' : null,
      corpo: formulario,
      rodape: [botao],
    });
  }

  async function alternarAtivoPeca(peca) {
    try {
      const resposta = await api.patch(`/api/inventario/pecas/${peca.id}`, { ativo: !peca.ativo });
      toastSucesso(resposta.mensagem);
      await carregar();
    } catch (erro) {
      toastErro(erro.message, { titulo: 'Não foi possível alterar' });
    }
  }

  async function excluirPeca(peca) {
    const ok = await confirmar({
      titulo: 'Excluir peça',
      mensagem: `"${peca.nome}" será removida do inventário. Peças já usadas em OS não são apagadas: elas são desativadas para preservar o histórico e os relatórios.`,
      textoConfirmar: 'Excluir',
      perigoso: true,
    });
    if (!ok) return;
    try {
      const resposta = await api.delete(`/api/inventario/pecas/${peca.id}`);
      toastSucesso(resposta.mensagem, { titulo: resposta.desativada ? 'Peça desativada' : 'Peça excluída' });
      await carregar();
    } catch (erro) {
      toastErro(erro.message, { titulo: 'Não foi possível excluir' });
    }
  }

  /* ------------------------------ Fornecedores ---------------------------- */

  function renderFornecedores() {
    const botaoNovo = h(
      'button.btn.btn--primario',
      { type: 'button', onclick: () => modalFornecedor(null) },
      icone('loja', { tamanho: 16 }),
      'Novo fornecedor',
    );

    if (!estado.fornecedores.length) {
      return h(
        'div.card',
        {},
        estadoVazio({
          icone: 'loja',
          titulo: 'Nenhum fornecedor',
          texto: 'Cadastre quem vende as peças. Cada peça pertence a um fornecedor — é essa ligação que permite saber quanto foi gasto com cada um.',
          acao: botaoNovo,
        }),
      );
    }

    return h(
      'div.pilha',
      {},
      h('div.linha.linha--entre', {}, h('h2', {}, 'Fornecedores'), botaoNovo),
      ...estado.fornecedores.map((fornecedor) =>
        h(
          'div.card',
          {},
          h(
            'div.card__corpo',
            { style: { display: 'grid', gap: '10px' } },
            h(
              'div.linha.linha--entre.linha--topo.linha--quebra',
              { style: { gap: '10px' } },
              h(
                'div',
                { style: { minWidth: '0' } },
                h(
                  'div.linha',
                  { style: { gap: '8px', flexWrap: 'wrap' } },
                  h('span.texto-forte', {}, fornecedor.nome),
                  h(
                    'span.badge.badge--acento.badge--sem-ponto',
                    {},
                    `${numero(fornecedor.pecas_ativas)} peça(s)`,
                  ),
                  fornecedor.ativo ? null : h('span.badge.badge--cancelado.badge--sem-ponto', {}, 'desativado'),
                ),
                h(
                  'div.texto-mini.texto-suave',
                  { style: { marginTop: '3px' } },
                  fornecedor.contato || 'Contato não informado',
                ),
                fornecedor.observacoes
                  ? h('div.texto-mini.texto-fraco', { style: { marginTop: '2px' } }, fornecedor.observacoes)
                  : null,
              ),
              h(
                'div.linha',
                { style: { gap: '6px', flexWrap: 'wrap' } },
                h(
                  'button.btn.btn--pequeno.btn--secundario',
                  { type: 'button', onclick: () => modalFornecedor(fornecedor) },
                  icone('editar', { tamanho: 14 }),
                  'Editar',
                ),
                h(
                  'button.btn.btn--pequeno.btn--fantasma',
                  { type: 'button', onclick: () => alternarAtivoFornecedor(fornecedor) },
                  fornecedor.ativo ? 'Desativar' : 'Reativar',
                ),
                h(
                  'button.btn.btn--pequeno.btn--perigo',
                  { type: 'button', onclick: () => excluirFornecedor(fornecedor) },
                  icone('x', { tamanho: 14 }),
                  'Excluir',
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function modalFornecedor(fornecedor) {
    const editando = Boolean(fornecedor);
    const nome = h('input.entrada', { value: fornecedor?.nome ?? '', placeholder: 'Ex: Astro Distribuidora' });
    const contato = h('input.entrada', {
      value: fornecedor?.contato ?? '',
      placeholder: 'Telefone, WhatsApp ou e-mail',
    });
    const observacoes = h('textarea.area-texto', {
      rows: 3,
      placeholder: 'Prazo de entrega, garantia, condições de pagamento…',
    });
    observacoes.value = fornecedor?.observacoes ?? '';

    const erro = h('div.oculto');
    const botao = h(
      'button.btn.btn--primario',
      { type: 'button', onclick: () => formulario.requestSubmit() },
      icone('check', { tamanho: 16 }),
      editando ? 'Salvar alterações' : 'Cadastrar fornecedor',
    );

    function mostrarErro(mensagem) {
      montar(
        erro,
        h(
          'div.faixa-erro',
          {},
          icone('alerta', { tamanho: 20 }),
          h('div', {}, h('div.faixa-erro__titulo', {}, 'Revise os dados'), h('div.faixa-erro__texto', {}, mensagem)),
        ),
      );
      erro.classList.remove('oculto');
    }

    const formulario = h(
      'form.pilha',
      {
        novalidate: true,
        onsubmit: async (evento) => {
          evento.preventDefault();
          erro.classList.add('oculto');
          if (nome.value.trim().length < 2) return mostrarErro('Informe o nome do fornecedor (mínimo 2 caracteres).');

          const corpo = {
            nome: nome.value.trim(),
            contato: contato.value.trim() || null,
            observacoes: observacoes.value.trim() || null,
          };

          ocupado(botao, true, 'Salvando…');
          try {
            const resposta = editando
              ? await api.patch(`/api/inventario/fornecedores/${fornecedor.id}`, corpo)
              : await api.post('/api/inventario/fornecedores', corpo);
            modal.fechar();
            toastSucesso(resposta.mensagem);
            await carregar();
          } catch (e) {
            mostrarErro(e.message);
          } finally {
            ocupado(botao, false);
          }
        },
      },
      erro,
      campo('Nome do fornecedor *', nome),
      campo('Contato', contato),
      campo('Observações', observacoes),
    );

    const modal = abrirModal({
      titulo: editando ? 'Editar fornecedor' : 'Novo fornecedor',
      corpo: formulario,
      rodape: [botao],
    });
  }

  async function alternarAtivoFornecedor(fornecedor) {
    try {
      const resposta = await api.patch(`/api/inventario/fornecedores/${fornecedor.id}`, { ativo: !fornecedor.ativo });
      toastSucesso(resposta.mensagem);
      await carregar();
    } catch (erro) {
      toastErro(erro.message, { titulo: 'Não foi possível alterar' });
    }
  }

  async function excluirFornecedor(fornecedor) {
    const ok = await confirmar({
      titulo: 'Excluir fornecedor',
      mensagem: `"${fornecedor.nome}" será removido definitivamente. Só é possível excluir fornecedores sem peças cadastradas e sem peças usadas em OS — caso contrário, desative.`,
      textoConfirmar: 'Excluir definitivamente',
      perigoso: true,
    });
    if (!ok) return;
    try {
      const resposta = await api.delete(`/api/inventario/fornecedores/${fornecedor.id}`);
      toastSucesso(resposta.mensagem, { titulo: 'Fornecedor excluído' });
      await carregar();
    } catch (erro) {
      toastErro(erro.message, { titulo: 'Não foi possível excluir' });
    }
  }
}
