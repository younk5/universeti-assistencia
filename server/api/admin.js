import { listarLojas, criarLoja, atualizarLoja, desativarLoja, buscarLoja, excluirLoja } from '../services/lojas.js';
import {
  listarUsuarios,
  criarUsuario,
  atualizarUsuario,
  alterarSenha,
  buscarUsuario,
  listarTecnicos,
  excluirUsuario,
} from '../services/usuarios.js';
import { exigirTexto, exigirLogin, exigirTelefone, exigirEnum, exigirNumero } from '../utils.js';
import { exigirAutenticacao, exigirPermissao, escopoRede } from '../auth.js';
import { semPermissao, invalido } from '../erros.js';
import { listarExclusoes, registrarExclusao } from '../services/auditoria.js';
import { exportarBanco, importarBanco } from '../services/backup.js';
import { listarConfiguracoes, definirConfig, CHAVES } from '../services/configuracoes.js';

const PAPEIS = ['atendente', 'tecnico', 'admin'];

function exigirAdmin(usuario) {
  exigirAutenticacao(usuario);
  if (usuario.papel !== 'admin') throw semPermissao('Somente administradores podem gerenciar lojas e usuários.');
}

function payloadLoja(corpo) {
  return {
    nome: exigirTexto(corpo.nome, 'nome da loja', { min: 2, max: 120 }),
    codigo: exigirTexto(corpo.codigo, 'código', { max: 6, opcional: true }),
    endereco: exigirTexto(corpo.endereco, 'endereço', { max: 240, opcional: true }),
    telefone: exigirTelefone(corpo.telefone, 'telefone da loja', { opcional: true }),
  };
}

/** PATCH aceita atualização parcial: só as chaves enviadas são tocadas. */
function patchLoja(corpo) {
  const dados = {};
  if ('nome' in corpo) dados.nome = exigirTexto(corpo.nome, 'nome da loja', { min: 2, max: 120 });
  if ('endereco' in corpo) dados.endereco = exigirTexto(corpo.endereco, 'endereço', { max: 240, opcional: true });
  if ('telefone' in corpo) dados.telefone = exigirTelefone(corpo.telefone, 'telefone da loja', { opcional: true });
  if ('ativo' in corpo) dados.ativo = Boolean(corpo.ativo);
  return dados;
}

export function registrar(rota) {
  /* ---------------------------- Configurações ---------------------------- */
  rota.get('/api/admin/configuracoes', async (ctx) => {
    exigirAdmin(ctx.usuario);
    return { configuracoes: await listarConfiguracoes() };
  });

  rota.patch('/api/admin/configuracoes', async (ctx) => {
    exigirAdmin(ctx.usuario);
    const garantia = exigirNumero(ctx.corpo.garantiaDiasPadrao, 'garantia padrão (dias)', { min: 0, max: 3650 });
    const prazo = exigirNumero(ctx.corpo.prazoDiasPadrao, 'prazo padrão (dias)', { min: 0, max: 365 });
    if (garantia !== null) await definirConfig(CHAVES.GARANTIA_DIAS, garantia);
    if (prazo !== null) await definirConfig(CHAVES.PRAZO_DIAS, prazo);
    return { configuracoes: await listarConfiguracoes(), mensagem: 'Configurações salvas.' };
  });

  /* --------------------------------- Lojas ------------------------------- */
  rota.get('/api/lojas', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    const lojas = await listarLojas({ apenasAtivas: ctx.query.ativas === '1' });
    return {
      lojas: escopoRede(ctx.usuario) ? lojas : lojas.filter((l) => l.id === ctx.usuario.lojaId),
      tecnicos: await listarTecnicos(escopoRede(ctx.usuario) ? null : ctx.usuario.lojaId),
    };
  });

  rota.post('/api/lojas', async (ctx) => {
    exigirAdmin(ctx.usuario);
    const loja = await criarLoja(payloadLoja(ctx.corpo));
    ctx.status = 201;
    return { loja, mensagem: `Loja "${loja.nome}" cadastrada.` };
  });

  rota.patch('/api/lojas/:id', async (ctx) => {
    exigirAdmin(ctx.usuario);
    const id = Number(ctx.params.id);
    const dados = patchLoja(ctx.corpo);
    if (dados.ativo === false) {
      const loja = await desativarLoja(id);
      return { loja, mensagem: `Loja "${loja.nome}" desativada.` };
    }
    const loja = await atualizarLoja(id, dados);
    return { loja, mensagem: `Loja "${loja.nome}" atualizada.` };
  });

  rota.get('/api/lojas/:id', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    const id = Number(ctx.params.id);
    if (ctx.usuario.papel !== 'admin' && id !== ctx.usuario.lojaId) throw semPermissao();
    return { loja: await buscarLoja(id) };
  });

  rota.delete('/api/lojas/:id', async (ctx) => {
    exigirAdmin(ctx.usuario);
    const loja = await excluirLoja(Number(ctx.params.id), ctx.usuario);
    return { mensagem: `Loja "${loja.nome}" excluída definitivamente.` };
  });

  /* ------------------------------- Usuários ------------------------------ */
  rota.get('/api/usuarios', async (ctx) => {
    exigirAdmin(ctx.usuario);
    return {
      usuarios: await listarUsuarios({
        lojaId: ctx.query.lojaId,
        papel: ctx.query.papel,
        apenasAtivos: ctx.query.ativos === '1',
      }),
      tecnicos: await listarTecnicos(ctx.query.lojaId ? Number(ctx.query.lojaId) : null),
    };
  });

  rota.post('/api/usuarios', async (ctx) => {
    exigirAdmin(ctx.usuario);
    const usuario = await criarUsuario({
      nome: exigirTexto(ctx.corpo.nome, 'nome', { min: 2, max: 120 }),
      email: exigirLogin(ctx.corpo.email),
      senha: ctx.corpo.senha,
      papel: exigirEnum(ctx.corpo.papel, 'papel', PAPEIS),
      lojaId: ctx.corpo.lojaId ? Number(ctx.corpo.lojaId) : null,
      telefone: exigirTelefone(ctx.corpo.telefone, 'telefone', { opcional: true }),
    });
    ctx.status = 201;
    return { usuario, mensagem: `Usuário "${usuario.nome}" criado.` };
  });

  rota.patch('/api/usuarios/:id', async (ctx) => {
    exigirAdmin(ctx.usuario);
    const id = Number(ctx.params.id);
    const alvo = await buscarUsuario(id);
    const usuario = await atualizarUsuario(id, {
      nome: exigirTexto(ctx.corpo.nome, 'nome', { min: 2, max: 120, opcional: true }),
      email: ctx.corpo.email ? exigirLogin(ctx.corpo.email) : undefined,
      papel: ctx.corpo.papel ? exigirEnum(ctx.corpo.papel, 'papel', PAPEIS) : undefined,
      lojaId: ctx.corpo.lojaId === undefined ? undefined : ctx.corpo.lojaId === null ? null : Number(ctx.corpo.lojaId),
      telefone: exigirTelefone(ctx.corpo.telefone, 'telefone', { opcional: true }),
      ativo: ctx.corpo.ativo,
    });
    return { usuario, mensagem: `Usuário "${alvo.nome}" atualizado.` };
  });

  rota.post('/api/usuarios/:id/senha', async (ctx) => {
    exigirAdmin(ctx.usuario);
    const id = Number(ctx.params.id);
    const alvo = await buscarUsuario(id);
    if (!ctx.corpo.novaSenha) throw invalido('Informe a nova senha.', { campo: 'novaSenha' });
    await alterarSenha(id, ctx.corpo.novaSenha);
    return { ok: true, mensagem: `Senha de "${alvo.nome}" redefinida. Sessões ativas foram encerradas.` };
  });

  rota.delete('/api/usuarios/:id', async (ctx) => {
    exigirAdmin(ctx.usuario);
    const id = Number(ctx.params.id);
    if (id === ctx.usuario.id) throw invalido('Você não pode excluir a sua própria conta.');
    const usuario = await excluirUsuario(id, ctx.usuario);
    return { mensagem: `Usuário "${usuario.nome}" excluído definitivamente.` };
  });

  /* -------------------------- Auditoria e backup -------------------------- */
  rota.get('/api/admin/exclusoes', async (ctx) => {
    exigirAdmin(ctx.usuario);
    return { exclusoes: await listarExclusoes({ limite: ctx.query.limite }) };
  });

  rota.get('/api/admin/backup', async (ctx) => {
    exigirAdmin(ctx.usuario);
    return { backup: await exportarBanco() };
  });

  rota.post('/api/admin/backup', async (ctx) => {
    exigirAdmin(ctx.usuario);
    const resumo = await importarBanco(ctx.corpo?.backup ?? ctx.corpo);
    await registrarExclusao({
      tipo: 'backup',
      referencia: 'Restauração de backup',
      detalhes: `Lojas ${resumo.lojas ?? 0} · Usuários ${resumo.usuarios ?? 0} · OS ${resumo.ordens_servico ?? 0}`,
      usuario: ctx.usuario,
    });
    return { resumo, mensagem: 'Backup restaurado. Todas as sessões foram encerradas.' };
  });
}
