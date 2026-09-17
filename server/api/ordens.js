import {
  STATUS,
  STATUS_VALIDOS,
  ROTULOS_STATUS,
  criarOS,
  buscarOS,
  buscarOSPorNumero,
  listarOS,
  listarEventos,
  listarFotos,
  alterarStatus,
  registrarEvento,
  validarTransicao,
  excluirOS,
} from '../services/ordens.js';
import { transacao, consultar, consultarUm } from '../db.js';
import { salvarFoto, buscarFoto, lerArquivoFoto, TIPOS_FOTO, excluirFoto } from '../services/fotos.js';
import {
  exigirTexto,
  exigirTelefone,
  exigirEnum,
  exigirNumero,
  lerCorpoBinario,
  agoraISO,
  telefoneParaWhatsapp,
} from '../utils.js';
import { exigirAutenticacao, exigirPermissao, pode } from '../auth.js';
import { ErroApp, invalido, naoEncontrado, semPermissao } from '../erros.js';

export const TIPO_APARELHO = 'Celular';

function normalizarPayloadOS(corpo) {
  return {
    clienteNome: exigirTexto(corpo.clienteNome, 'nome do cliente', { min: 2, max: 120 }),
    clienteTelefone: exigirTelefone(corpo.clienteTelefone, 'telefone do cliente'),
    tipoAparelho: TIPO_APARELHO,
    marca: exigirTexto(corpo.marca, 'marca', { max: 60 }),
    modelo: exigirTexto(corpo.modelo, 'modelo', { max: 80 }),
    cor: exigirTexto(corpo.cor, 'cor', { max: 40, opcional: true }),
    imei: exigirTexto(corpo.imei, 'IMEI / número de série', { max: 60, opcional: true }),
    acessorios: exigirTexto(corpo.acessorios, 'acessórios deixados', { max: 300, opcional: true }),
    defeitoRelatado: exigirTexto(corpo.defeitoRelatado, 'defeito relatado', { min: 3, max: 2000 }),
    estadoAparelho: exigirTexto(corpo.estadoAparelho, 'estado do aparelho', { max: 1000, opcional: true }),
    valorEstimado: exigirNumero(corpo.valorEstimado, 'valor estimado', { min: 0, max: 999999 }),
  };
}

export function registrar(rota) {
  /* ----------------------------- Catálogos ------------------------------- */
  rota.get('/api/meta', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    const lojas = (await consultar(
      'SELECT id, nome, codigo, endereco, telefone, ativo FROM lojas ORDER BY nome COLLATE NOCASE',
    )).filter((l) => ctx.usuario.papel === 'admin' || l.id === ctx.usuario.lojaId);
    const tecnicos = await consultar(
      `SELECT u.id, u.nome, u.loja_id, u.papel FROM usuarios u
        WHERE u.ativo = 1 AND u.papel IN ('tecnico','admin')
          ${ctx.usuario.papel === 'admin' ? '' : 'AND u.loja_id = ?'}
        ORDER BY u.nome COLLATE NOCASE`,
      ...(ctx.usuario.papel === 'admin' ? [] : [ctx.usuario.lojaId]),
    );
    return {
      lojas,
      tecnicos,
      status: STATUS_VALIDOS.map((s) => ({ valor: s, rotulo: ROTULOS_STATUS[s] })),
      tiposFoto: TIPOS_FOTO,
      permissoes: ctx.usuario.papel,
    };
  });

  /* ------------------------------- Listagem ------------------------------ */
  rota.get('/api/ordens', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    exigirPermissao(ctx.usuario, 'os.ver');
    const q = ctx.query;
    return listarOS({
      usuario: ctx.usuario,
      lojaId: q.lojaId,
      status: q.status,
      tecnicoId: q.tecnicoId,
      busca: q.busca,
      de: q.de,
      ate: q.ate,
      ordenar: q.ordenar,
      limite: q.limite,
      offset: q.offset,
    });
  });

  rota.get('/api/ordens/por-numero/:numero', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    return { ordem: await buscarOSPorNumero(ctx.params.numero, ctx.usuario) };
  });

  /* -------------------------------- Criação ------------------------------ */
  rota.post('/api/ordens', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    exigirPermissao(ctx.usuario, 'os.criar');
    const dados = normalizarPayloadOS(ctx.corpo);

    let lojaId = ctx.usuario.lojaId;
    if (ctx.usuario.papel === 'admin') {
      lojaId = ctx.corpo.lojaId ? Number(ctx.corpo.lojaId) : ctx.usuario.lojaId;
      if (!lojaId) throw invalido('Selecione a loja de entrada.', { campo: 'lojaId' });
    }
    const loja = await consultarUm('SELECT id, nome, ativo FROM lojas WHERE id = ?', lojaId);
    if (!loja) throw invalido('Loja de entrada inválida.', { campo: 'lojaId' });
    if (!loja.ativo) throw invalido('Esta loja está desativada e não pode receber novas OS.', { campo: 'lojaId' });

    const osId = await criarOS(ctx.usuario, { ...dados, lojaNome: loja.nome }, lojaId);
    const os = await buscarOS(osId, ctx.usuario);
    ctx.status = 201;
    return { ordem: os, mensagem: `OS ${os.numero_os} criada com sucesso.` };
  });

  /* -------------------------------- Detalhe ------------------------------ */
  rota.get('/api/ordens/:id', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    const os = await buscarOS(Number(ctx.params.id), ctx.usuario);
    const [eventos, fotos] = await Promise.all([listarEventos(os.id), listarFotos(os.id)]);
    return {
      ordem: os,
      eventos,
      fotos,
      transicoes: transicoesPermitidas(os, ctx.usuario),
      acoes: acoesDisponiveis(os, ctx.usuario),
      whatsapp: telefoneParaWhatsapp(os.cliente_telefone),
    };
  });

  /* -------------------------------- Excluir ------------------------------ */
  rota.delete('/api/ordens/:id', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    if (ctx.usuario.papel !== 'admin') {
      throw semPermissao('Somente o administrador pode excluir uma OS.');
    }
    const os = await excluirOS(Number(ctx.params.id), ctx.usuario);
    return { mensagem: `OS ${os.numero_os} excluída definitivamente.` };
  });

  /* -------------------------------- Assumir ------------------------------ */
  rota.post('/api/ordens/:id/assumir', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    exigirPermissao(ctx.usuario, 'os.assumir');
    const os = await buscarOS(Number(ctx.params.id), ctx.usuario);
    const tecnicoId = ctx.usuario.papel === 'admin' && ctx.corpo.tecnicoId ? Number(ctx.corpo.tecnicoId) : ctx.usuario.id;
    const tecnico = await consultarUm('SELECT id, nome, papel, loja_id FROM usuarios WHERE id = ? AND ativo = 1', tecnicoId);
    if (!tecnico || !['tecnico', 'admin'].includes(tecnico.papel)) {
      throw invalido('Técnico inválido.', { campo: 'tecnicoId' });
    }
    if (ctx.usuario.papel !== 'admin' && Number(tecnico.loja_id) !== Number(ctx.usuario.lojaId)) {
      throw semPermissao('Você só pode assumir OS da sua loja.');
    }
    const atualizada = await alterarStatus(os.id, ctx.usuario, STATUS.EM_MANUTENCAO, {
      descricao: `Aparelho assumido por ${tecnico.nome}`,
      campos: { tecnico_id: tecnico.id, iniciado_em: os.iniciado_em ?? agoraISO() },
      tiposEvento: { [STATUS.EM_MANUTENCAO]: 'assumir' },
    });
    return { ordem: atualizada, mensagem: `${tecnico.nome} assumiu a OS ${os.numero_os}.` };
  });

  /* --------------------------- Mudança de status ------------------------- */
  rota.post('/api/ordens/:id/status', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    const os = await buscarOS(Number(ctx.params.id), ctx.usuario);
    const novoStatus = exigirEnum(ctx.corpo.status, 'status', STATUS_VALIDOS);
    const descricao = exigirTexto(ctx.corpo.descricao, 'descrição', { max: 600, opcional: true });

    const regras = {
      [STATUS.EM_MANUTENCAO]: 'os.assumir',
      [STATUS.AGUARDANDO_PECA]: 'os.assumir',
      [STATUS.PRONTO]: 'os.finalizar',
      [STATUS.RETIRADO]: 'os.retirar',
      [STATUS.AGUARDANDO]: 'os.reabrir',
      [STATUS.CANCELADO]: 'os.reabrir',
    };
    exigirPermissao(ctx.usuario, regras[novoStatus] ?? 'os.ver');

    const campos = {};
    const tiposEvento = {};
    if (novoStatus === STATUS.EM_MANUTENCAO) {
      campos.tecnico_id = ctx.corpo.tecnicoId ? Number(ctx.corpo.tecnicoId) : os.tecnico_id ?? ctx.usuario.id;
      campos.iniciado_em = os.iniciado_em ?? agoraISO();
      tiposEvento[novoStatus] = 'assumir';
    }
    if ([STATUS.AGUARDANDO, STATUS.CANCELADO].includes(novoStatus) && ctx.usuario.papel !== 'admin') {
      throw semPermissao('Apenas o administrador pode reabrir ou cancelar uma OS.');
    }
    if (novoStatus === STATUS.CANCELADO && !descricao) {
      throw invalido('Informe o motivo do cancelamento.', { campo: 'descricao' });
    }

    const atualizada = await alterarStatus(os.id, ctx.usuario, novoStatus, { descricao, campos, tiposEvento });
    return { ordem: atualizada, mensagem: `Status alterado para "${ROTULOS_STATUS[novoStatus]}".` };
  });

  /* ------------------------------- Finalizar ----------------------------- */
  rota.post('/api/ordens/:id/finalizar', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    exigirPermissao(ctx.usuario, 'os.finalizar');
    const os = await buscarOS(Number(ctx.params.id), ctx.usuario);
    if (os.status === STATUS.RETIRADO) {
      throw new ErroApp('Esta OS já foi retirada pelo cliente.', { status: 409, codigo: 'conflito' });
    }

    const servicoRealizado = exigirTexto(ctx.corpo.servicoRealizado, 'serviço realizado', { min: 3, max: 2000 });
    const pecas = exigirTexto(ctx.corpo.pecasUtilizadas, 'peças utilizadas', { max: 1000, opcional: true });
    const valor = exigirNumero(ctx.corpo.valor, 'valor cobrado', { min: 0, max: 999999, opcional: true });
    const garantiaDias = exigirNumero(ctx.corpo.garantiaDias, 'garantia (dias)', { min: 0, max: 3650, opcional: true });
    const observacoes = exigirTexto(ctx.corpo.observacoes, 'observações', { max: 1000, opcional: true });

    if (os.status === STATUS.AGUARDANDO) {
      validarTransicao(os, STATUS.EM_MANUTENCAO);
    }

    const partes = [`Serviço realizado: ${servicoRealizado}`];
    if (pecas) partes.push(`Peças: ${pecas}`);
    if (valor !== null) partes.push(`Valor: R$ ${valor.toFixed(2)}`);
    if (garantiaDias) partes.push(`Garantia: ${garantiaDias} dias`);
    if (observacoes) partes.push(`Obs.: ${observacoes}`);

    const concluidoEm = await transacao(async (conexao) => {
      const registro = await conexao.get('SELECT * FROM ordens_servico WHERE id = ?', [os.id]);
      const agora = agoraISO();

      if (registro.status === STATUS.AGUARDANDO) {
        await conexao.run(
          'UPDATE ordens_servico SET status = ?, tecnico_id = ?, iniciado_em = ?, atualizado_em = ? WHERE id = ?',
          [STATUS.EM_MANUTENCAO, registro.tecnico_id ?? ctx.usuario.id, registro.iniciado_em ?? agora, agora, os.id],
        );
        await registrarEvento(conexao, {
          osId: os.id,
          tipoEvento: 'assumir',
          statusAnterior: STATUS.AGUARDANDO,
          statusNovo: STATUS.EM_MANUTENCAO,
          descricao: `Fluxo iniciado por ${ctx.usuario.nome}`,
          usuarioId: ctx.usuario.id,
        });
      }

      await conexao.run(
        `UPDATE ordens_servico
            SET status = ?, concluido_em = ?, valor = COALESCE(?, valor), tecnico_id = COALESCE(tecnico_id, ?),
                atualizado_em = ?
          WHERE id = ?`,
        [STATUS.PRONTO, agora, valor, ctx.usuario.id, agora, os.id],
      );

      await registrarEvento(conexao, {
        osId: os.id,
        tipoEvento: 'finalizar',
        statusAnterior: STATUS.EM_MANUTENCAO,
        statusNovo: STATUS.PRONTO,
        descricao: partes.join(' | '),
        usuarioId: ctx.usuario.id,
      });

      return agora;
    });

    return {
      ordem: await buscarOS(os.id, ctx.usuario),
      concluidoEm,
      mensagem: `OS ${os.numero_os} concluída e pronta para retirada.`,
      cliente: { nome: os.cliente_nome, telefone: os.cliente_telefone },
      whatsapp: telefoneParaWhatsapp(os.cliente_telefone),
    };
  });

  /* -------------------------------- Retirada ----------------------------- */
  rota.post('/api/ordens/:id/retirar', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    exigirPermissao(ctx.usuario, 'os.retirar');
    const os = await buscarOS(Number(ctx.params.id), ctx.usuario);
    const recebidoPor = exigirTexto(ctx.corpo.recebidoPor, 'quem retirou', { max: 120, opcional: true });
    const observacoes = exigirTexto(ctx.corpo.observacoes, 'observações', { max: 500, opcional: true });
    const valorPago = ctx.corpo.valorPago === undefined ? null : ctx.corpo.valorPago ? 1 : 0;

    const atualizada = await alterarStatus(os.id, ctx.usuario, STATUS.RETIRADO, {
      descricao: [
        `Entrega registrada por ${ctx.usuario.nome}`,
        recebidoPor ? `Recebido por: ${recebidoPor}` : null,
        valorPago === null ? null : valorPago ? 'Pagamento confirmado' : 'Pagamento pendente',
        observacoes,
      ]
        .filter(Boolean)
        .join(' | '),
      campos: {
        retirado_em: agoraISO(),
        recebido_por: recebidoPor ?? os.cliente_nome,
        valor_pago: valorPago ?? os.valor_pago,
      },
      tiposEvento: { [STATUS.RETIRADO]: 'retirar' },
    });
    return { ordem: atualizada, mensagem: `OS ${os.numero_os} marcada como retirada.` };
  });

  /* ------------------------------ Comentários ---------------------------- */
  rota.post('/api/ordens/:id/comentarios', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    exigirPermissao(ctx.usuario, 'os.comentar');
    const os = await buscarOS(Number(ctx.params.id), ctx.usuario);
    const texto = exigirTexto(ctx.corpo.descricao, 'anotação', { min: 2, max: 2000 });
    await transacao(async (conexao) => {
      await registrarEvento(conexao, {
        osId: os.id,
        tipoEvento: 'comentario',
        descricao: texto,
        usuarioId: ctx.usuario.id,
      });
      await conexao.run('UPDATE ordens_servico SET atualizado_em = ? WHERE id = ?', [agoraISO(), os.id]);
    });
    ctx.status = 201;
    return { eventos: await listarEventos(os.id), mensagem: 'Anotação registrada no histórico.' };
  });

  /* --------------------------------- Fotos ------------------------------- */
  rota.post('/api/ordens/:id/fotos', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    const os = await buscarOS(Number(ctx.params.id), ctx.usuario);
    const tipo = exigirEnum(ctx.query.tipo ?? ctx.corpo?.tipo, 'tipo da foto', TIPOS_FOTO);
    if (tipo === 'entrada') exigirPermissao(ctx.usuario, 'os.criar');
    else exigirPermissao(ctx.usuario, 'os.ver');

    const legenda = ctx.query.legenda ? String(ctx.query.legenda).slice(0, 200) : null;
    const buffer = await lerCorpoBinario(ctx.req);
    const mime = ctx.req.headers['content-type'] ?? 'image/jpeg';
    const foto = await salvarFoto({ os, usuario: ctx.usuario, tipo, buffer, mime, legenda });
    ctx.status = 201;
    return {
      foto: { id: foto.id, tipo: foto.tipo, criado_em: foto.criado_em, legenda: foto.legenda },
      mensagem: 'Foto anexada com sucesso.',
    };
  });

  rota.get('/api/fotos/:id/raw', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    const foto = await buscarFoto(Number(ctx.params.id));
    const os = await consultarUm('SELECT id, loja_id FROM ordens_servico WHERE id = ?', foto.os_id);
    if (!os) throw naoEncontrado('OS da foto não encontrada.');
    if (ctx.usuario.papel !== 'admin' && Number(os.loja_id) !== Number(ctx.usuario.lojaId)) {
      throw semPermissao('Esta foto pertence a outra loja.');
    }
    // A imagem vem do disco ou do Blob, mas só depois da checagem de sessão
    // e de loja — nunca é exposta diretamente.
    ctx.arquivo = await lerArquivoFoto(foto);
    return null;
  });

  rota.delete('/api/fotos/:id', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    exigirPermissao(ctx.usuario, 'os.comentar');
    const foto = await buscarFoto(Number(ctx.params.id));
    const os = await consultarUm('SELECT id, loja_id FROM ordens_servico WHERE id = ?', foto.os_id);
    if (!os) throw naoEncontrado('OS da foto não encontrada.');
    if (ctx.usuario.papel !== 'admin' && Number(os.loja_id) !== Number(ctx.usuario.lojaId)) {
      throw semPermissao('Esta foto pertence a outra loja.');
    }
    await excluirFoto(Number(ctx.params.id));
    return { mensagem: 'Foto removida definitivamente.' };
  });

  /* ------------------------------ Exportação ----------------------------- */
  rota.get('/api/relatorios/ordens.csv', async (ctx) => {
    exigirAutenticacao(ctx.usuario);
    exigirPermissao(ctx.usuario, 'relatorios');
    const { itens } = await listarOS({
      usuario: ctx.usuario,
      lojaId: ctx.query.lojaId,
      status: ctx.query.status,
      tecnicoId: ctx.query.tecnicoId,
      busca: ctx.query.busca,
      de: ctx.query.de,
      ate: ctx.query.ate,
      ordenar: 'recentes',
      limite: 5000,
      offset: 0,
    });
    const cabecalhos = [
      'numero_os', 'loja', 'status', 'cliente', 'telefone', 'marca', 'modelo',
      'cor', 'imei', 'defeito_relatado', 'tecnico', 'valor', 'criado_em', 'iniciado_em', 'concluido_em', 'retirado_em',
    ];
    const linhas = itens.map((o) => [
      o.numero_os, o.loja_nome, ROTULOS_STATUS[o.status] ?? o.status, o.cliente_nome, o.cliente_telefone,
      o.marca, o.modelo, o.cor ?? '', o.imei ?? '', o.defeito_relatado, o.tecnico_nome ?? '',
      o.valor ?? '', o.criado_em, o.iniciado_em ?? '', o.concluido_em ?? '', o.retirado_em ?? '',
    ]);
    const csv = [cabecalhos, ...linhas].map((linha) => linha.map(celulaCsv).join(';')).join('\r\n');
    return {
      __csv: true,
      conteudo: `\uFEFF${csv}`,
      nomeArquivo: `ordens-servico-${new Date().toISOString().slice(0, 10)}.csv`,
    };
  });
}

function celulaCsv(valor) {
  const texto = String(valor ?? '');
  if (/[";\r\n]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

function transicoesPermitidas(os, usuario) {
  const permitidas = {
    [STATUS.AGUARDANDO]: [STATUS.EM_MANUTENCAO, STATUS.CANCELADO],
    [STATUS.EM_MANUTENCAO]: [STATUS.AGUARDANDO_PECA, STATUS.PRONTO],
    [STATUS.AGUARDANDO_PECA]: [STATUS.EM_MANUTENCAO, STATUS.PRONTO],
    [STATUS.PRONTO]: [STATUS.RETIRADO],
    [STATUS.RETIRADO]: [],
    [STATUS.CANCELADO]: [],
  }[os.status] ?? [];

  const regras = {
    [STATUS.EM_MANUTENCAO]: 'os.assumir',
    [STATUS.AGUARDANDO_PECA]: 'os.assumir',
    [STATUS.PRONTO]: 'os.finalizar',
    [STATUS.RETIRADO]: 'os.retirar',
    [STATUS.CANCELADO]: 'os.reabrir',
  };
  return permitidas
    .filter((s) => pode(usuario, regras[s] ?? 'os.ver'))
    .map((s) => ({ valor: s, rotulo: ROTULOS_STATUS[s] }));
}

function acoesDisponiveis(os, usuario) {
  return {
    podeAssumir: os.status === STATUS.AGUARDANDO && pode(usuario, 'os.assumir'),
    podeFinalizar:
      [STATUS.EM_MANUTENCAO, STATUS.AGUARDANDO_PECA, STATUS.AGUARDANDO].includes(os.status) &&
      pode(usuario, 'os.finalizar'),
    podeRetirar: os.status === STATUS.PRONTO && pode(usuario, 'os.retirar'),
    podeComentar: pode(usuario, 'os.comentar') && os.status !== STATUS.RETIRADO,
    podeAnexarFoto: os.status !== STATUS.RETIRADO,
    podeCancelar: os.status !== STATUS.RETIRADO && usuario.papel === 'admin',
    podeReabrir: os.status === STATUS.CANCELADO && usuario.papel === 'admin',
    tecnicoDesignado: os.tecnico_id ? os.tecnico_nome : null,
  };
}
