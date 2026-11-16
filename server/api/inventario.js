import {
  listarFornecedores,
  criarFornecedor,
  atualizarFornecedor,
  excluirFornecedor,
  buscarFornecedor,
  listarPecas,
  criarPeca,
  atualizarPeca,
  excluirPeca,
  buscarPeca,
  listarPecasUsadasDaOS,
  gastosPecas,
} from '../services/inventario.js';
import { exigirTexto, exigirNumero } from '../utils.js';
import { exigirAutenticacao, exigirPermissao, acessoTotal } from '../auth.js';
import { semPermissao, invalido } from '../erros.js';

/**
 * Inventário de peças.
 *
 * - CRUD de fornecedores/peças: exclusivo do administrador (`inventario.gerir`).
 * - Leitura das peças: liberada para quem conclui OS (`os.finalizar`), porque é
 *   no modal de conclusão que o técnico escolhe o que foi usado. Nesse caminho
 *   só expomos o necessário para a escolha (nome, modelo, fornecedor, preço,
 *   estoque) — nunca dados de contato do fornecedor.
 * - Relatório de gastos: exclusivo do administrador.
 */

function exigirInventario(usuario) {
  exigirAutenticacao(usuario);
  if (!acessoTotal(usuario) || usuario.papel !== 'admin') {
    throw semPermissao('O inventário de peças é exclusivo do administrador.');
  }
}

function exigirLeituraDepecas(usuario) {
  exigirAutenticacao(usuario);
  if (!acessoTotal(usuario)) throw semPermissao('Seu perfil não pode registrar peças em ordens de serviço.');
}

const textoOpcional = (valor, campo, max = 500) => exigirTexto(valor, campo, { max, opcional: true });

function payloadFornecedor(corpo) {
  return {
    nome: exigirTexto(corpo.nome, 'nome do fornecedor', { min: 2, max: 120 }),
    contato: textoOpcional(corpo.contato, 'contato', 120),
    observacoes: textoOpcional(corpo.observacoes, 'observações', 500),
  };
}

function patchFornecedor(corpo) {
  const dados = {};
  if ('nome' in corpo) dados.nome = exigirTexto(corpo.nome, 'nome do fornecedor', { min: 2, max: 120 });
  if ('contato' in corpo) dados.contato = textoOpcional(corpo.contato, 'contato', 120);
  if ('observacoes' in corpo) dados.observacoes = textoOpcional(corpo.observacoes, 'observações', 500);
  if ('ativo' in corpo) dados.ativo = Boolean(corpo.ativo);
  return dados;
}

/** Estoque opcional: vazio/null = peça sem controle de quantidade. */
function validarEstoque(valor, { opcional = true } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (opcional) return null;
    throw invalido('O campo "quantidade em estoque" é obrigatório.', { campo: 'quantidadeEstoque' });
  }
  const numero = exigirNumero(valor, 'quantidade em estoque', { min: 0, max: 1_000_000 });
  if (!Number.isInteger(numero)) {
    throw invalido('A quantidade em estoque deve ser um número inteiro.', { campo: 'quantidadeEstoque' });
  }
  return numero;
}

function payloadPeca(corpo) {
  return {
    fornecedorId: exigirNumero(corpo.fornecedorId, 'fornecedor', { min: 1, max: 1_000_000, opcional: false }),
    nome: exigirTexto(corpo.nome, 'nome da peça', { min: 2, max: 160 }),
    modelo: textoOpcional(corpo.modelo, 'modelo/aparelho compatível', 160),
    precoCusto: exigirNumero(corpo.precoCusto, 'preço de custo', { min: 0.01, max: 1_000_000, opcional: false }),
    quantidadeEstoque: validarEstoque(corpo.quantidadeEstoque),
  };
}

function patchPeca(corpo) {
  const dados = {};
  if ('fornecedorId' in corpo) {
    dados.fornecedorId = exigirNumero(corpo.fornecedorId, 'fornecedor', { min: 1, max: 1_000_000, opcional: false });
  }
  if ('nome' in corpo) dados.nome = exigirTexto(corpo.nome, 'nome da peça', { min: 2, max: 160 });
  if ('modelo' in corpo) dados.modelo = textoOpcional(corpo.modelo, 'modelo/aparelho compatível', 160);
  if ('precoCusto' in corpo) {
    dados.precoCusto = exigirNumero(corpo.precoCusto, 'preço de custo', { min: 0.01, max: 1_000_000, opcional: false });
  }
  if ('quantidadeEstoque' in corpo) dados.quantidadeEstoque = validarEstoque(corpo.quantidadeEstoque);
  if ('ativo' in corpo) dados.ativo = Boolean(corpo.ativo);
  return dados;
}

export function registrar(rota) {
  /* ------------------------------ Fornecedores ---------------------------- */
  rota.get('/api/inventario/fornecedores', async (ctx) => {
    exigirInventario(ctx.usuario);
    return {
      fornecedores: await listarFornecedores({
        busca: ctx.query.busca ?? null,
        incluirInativos: ctx.query.inativos !== '0',
      }),
    };
  });

  rota.post('/api/inventario/fornecedores', async (ctx) => {
    exigirInventario(ctx.usuario);
    const fornecedor = await criarFornecedor(payloadFornecedor(ctx.corpo));
    ctx.status = 201;
    return { fornecedor, mensagem: `Fornecedor "${fornecedor.nome}" cadastrado.` };
  });

  rota.get('/api/inventario/fornecedores/:id', async (ctx) => {
    exigirInventario(ctx.usuario);
    return { fornecedor: await buscarFornecedor(Number(ctx.params.id)) };
  });

  rota.patch('/api/inventario/fornecedores/:id', async (ctx) => {
    exigirInventario(ctx.usuario);
    const fornecedor = await atualizarFornecedor(Number(ctx.params.id), patchFornecedor(ctx.corpo));
    return { fornecedor, mensagem: `Fornecedor "${fornecedor.nome}" atualizado.` };
  });

  rota.delete('/api/inventario/fornecedores/:id', async (ctx) => {
    exigirInventario(ctx.usuario);
    const fornecedor = await excluirFornecedor(Number(ctx.params.id), ctx.usuario);
    return { mensagem: `Fornecedor "${fornecedor.nome}" excluído.` };
  });

  /* --------------------------------- Peças -------------------------------- */
  rota.get('/api/inventario/pecas', async (ctx) => {
    // Leitura liberada para admin/técnico: é o mesmo caminho usado no modal de
    // conclusão da OS. Os campos de contato do fornecedor são omitidos.
    exigirLeituraDepecas(ctx.usuario);
    const pecas = await listarPecas({
      busca: ctx.query.busca ?? null,
      fornecedorId: ctx.query.fornecedorId ? Number(ctx.query.fornecedorId) : null,
      incluirInativas: ctx.query.inativas === '1',
      somenteDisponiveis: ctx.query.disponiveis === '1',
    });
    const admin = ctx.usuario.papel === 'admin';
    return {
      pecas: admin ? pecas : pecas.map(({ fornecedor_contato, ...resto }) => resto),
    };
  });

  rota.post('/api/inventario/pecas', async (ctx) => {
    exigirInventario(ctx.usuario);
    const peca = await criarPeca(payloadPeca(ctx.corpo));
    ctx.status = 201;
    return { peca, mensagem: `Peça "${peca.nome}" cadastrada.` };
  });

  rota.get('/api/inventario/pecas/:id', async (ctx) => {
    exigirLeituraDepecas(ctx.usuario);
    const peca = await buscarPeca(Number(ctx.params.id));
    if (ctx.usuario.papel !== 'admin') delete peca.fornecedor_contato;
    return { peca };
  });

  rota.patch('/api/inventario/pecas/:id', async (ctx) => {
    exigirInventario(ctx.usuario);
    const peca = await atualizarPeca(Number(ctx.params.id), patchPeca(ctx.corpo));
    return { peca, mensagem: `Peça "${peca.nome}" atualizada.` };
  });

  rota.delete('/api/inventario/pecas/:id', async (ctx) => {
    exigirInventario(ctx.usuario);
    const { peca, desativada, totalUsado } = await excluirPeca(Number(ctx.params.id), ctx.usuario);
    return {
      mensagem: desativada
        ? `A peça "${peca.nome}" já foi usada em ${totalUsado} lançamento(s) e foi desativada (o histórico é preservado).`
        : `Peça "${peca.nome}" excluída.`,
      desativada,
    };
  });

  /* -------------------- Peças usadas / relatório de gastos ---------------- */
  rota.get('/api/inventario/os/:id/pecas', async (ctx) => {
    exigirLeituraDepecas(ctx.usuario);
    return { pecas: await listarPecasUsadasDaOS(Number(ctx.params.id)) };
  });

  rota.get('/api/inventario/gastos', async (ctx) => {
    exigirInventario(ctx.usuario);
    return {
      gastos: await gastosPecas({
        de: ctx.query.de ?? null,
        ate: ctx.query.ate ?? null,
        lojaId: ctx.query.lojaId ? Number(ctx.query.lojaId) : null,
        fornecedorId: ctx.query.fornecedorId ? Number(ctx.query.fornecedorId) : null,
      }),
    };
  });
}
