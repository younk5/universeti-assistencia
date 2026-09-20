import { h, montar } from '../dom.js';
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
import { numero, data, dataHora, iniciais, iniciaisPapel, telefone as formatarTelefone } from '../format.js';

const ABAS = [
  { id: 'lojas', rotulo: 'Lojas', icone: 'loja' },
  { id: 'usuarios', rotulo: 'Usuários', icone: 'usuarios' },
  { id: 'config', rotulo: 'Regras', icone: 'engrenagem' },
  { id: 'auditoria', rotulo: 'Auditoria', icone: 'escudo' },
];

export async function paginaAdmin(container) {
  if (!store.ehAdmin) {
    montar(
      container,
      h('div.card', {}, h('div.card__corpo', {}, estadoVazio({ icone: 'cadeado', titulo: 'Área restrita', texto: 'Somente administradores acessam a gestão de lojas e usuários.' }))),
    );
    return;
  }

  let abaAtiva = 'lojas';
  const estado = { lojas: [], usuarios: [], exclusoes: [], config: {}, carregando: true, erro: null };

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
          h('h1', {}, 'Gestão'),
          h('p.pagina-cabecalho__desc', {}, 'Lojas, usuários, permissões e rastreabilidade do sistema'),
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
      const [lojas, usuarios, exclusoes, config] = await Promise.all([
        api.get('/api/lojas'),
        api.get('/api/usuarios'),
        api.get('/api/admin/exclusoes', { limite: 100 }),
        api.get('/api/admin/configuracoes'),
      ]);
      estado.lojas = lojas.lojas ?? [];
      estado.usuarios = usuarios.usuarios ?? [];
      estado.exclusoes = exclusoes.exclusoes ?? [];
      estado.config = config.configuracoes ?? {};
      await store.carregarMeta();
    } catch (erro) {
      estado.erro = erro.message;
    } finally {
      estado.carregando = false;
      desenhar();
    }
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
          aba.id === 'lojas' ? ` (${estado.lojas.length})` : aba.id === 'usuarios' ? ` (${estado.usuarios.length})` : '',
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

    if (abaAtiva === 'lojas') montar(areaConteudo, renderLojas());
    else if (abaAtiva === 'usuarios') montar(areaConteudo, renderUsuarios());
    else if (abaAtiva === 'config') montar(areaConteudo, renderConfig());
    else montar(areaConteudo, renderAuditoria());
  }

  /* -------------------------------- Lojas -------------------------------- */

  function renderLojas() {
    const botaoNova = h(
      'button.btn.btn--primario',
      { type: 'button', onclick: () => modalLoja(null) },
      icone('nova', { tamanho: 16 }),
      'Nova loja',
    );

    const lista = estado.lojas.length
      ? h(
          'div.pilha',
          {},
          ...estado.lojas.map((loja) =>
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
                    h('div.linha', { style: { gap: '8px', flexWrap: 'wrap' } },
                      h('span.texto-forte', {}, loja.nome),
                      h('span.badge.badge--acento.badge--sem-ponto', {}, loja.codigo),
                      loja.ativo ? null : h('span.badge.badge--cancelado.badge--sem-ponto', {}, 'desativada'),
                    ),
                    h('div.texto-mini.texto-suave', { style: { marginTop: '3px' } }, loja.endereco || 'Endereço não informado'),
                    loja.telefone ? h('div.texto-mini.texto-fraco.linha', { style: { gap: '5px', marginTop: '2px' } }, icone('telefone', { tamanho: 12 }), formatarTelefone(loja.telefone)) : null,
                  ),
                  h(
                    'div.linha',
                    { style: { gap: '6px', flexWrap: 'wrap' } },
                    h('button.btn.btn--pequeno.btn--secundario', { type: 'button', onclick: () => modalLoja(loja) }, icone('editar', { tamanho: 14 }), 'Editar'),
                    loja.ativo
                      ? h(
                          'button.btn.btn--pequeno.btn--perigo',
                          {
                            type: 'button',
                            onclick: async () => {
                              const ok = await confirmar({
                                titulo: 'Desativar loja',
                                mensagem: `A loja "${loja.nome}" deixa de aparecer para novas entradas. Só é possível desativar lojas sem OS em aberto.`,
                                textoConfirmar: 'Desativar',
                                perigoso: true,
                              });
                              if (!ok) return;
                              try {
                                const resposta = await api.patch(`/api/lojas/${loja.id}`, { ativo: false });
                                toastSucesso(resposta.mensagem);
                                await carregar();
                              } catch (erro) {
                                toastErro(erro.message);
                              }
                            },
                          },
                          'Desativar',
                        )
                      : h(
                          'button.btn.btn--pequeno.btn--secundario',
                          {
                            type: 'button',
                            onclick: async () => {
                              try {
                                const resposta = await api.patch(`/api/lojas/${loja.id}`, { ativo: true });
                                toastSucesso(resposta.mensagem);
                                await carregar();
                              } catch (erro) {
                                toastErro(erro.message);
                              }
                            },
                          },
                          'Reativar',
                        ),
                    h(
                      'button.btn.btn--pequeno.btn--perigo',
                      { type: 'button', onclick: () => excluirLoja(loja) },
                      icone('x', { tamanho: 14 }),
                      'Excluir',
                    ),
                  ),
                ),
                h(
                  'div.linha.linha--quebra.texto-mini.texto-fraco',
                  { style: { gap: '14px' } },
                  h('span', {}, `${numero(loja.total_usuarios)} usuário(s)`),
                  h('span', {}, `${numero(loja.total_os)} OS no total`),
                  h('span', {}, `${numero(loja.os_abertas)} em aberto`),
                ),
              ),
            ),
          ),
        )
      : h('div.card', {}, estadoVazio({ icone: 'loja', titulo: 'Nenhuma loja cadastrada', texto: 'Cadastre a primeira loja para começar a receber aparelhos.', acao: botaoNova }));

    return h(
      'div.pilha',
      {},
      h('div.linha.linha--entre', {}, h('h2', {}, 'Lojas da rede'), estado.lojas.length ? botaoNova : null),
      lista,
    );
  }

  function modalLoja(loja) {
    const editando = Boolean(loja);
    const nome = h('input.entrada', { required: true, value: loja?.nome ?? '', placeholder: 'Ex: Loja Centro' });
    const codigo = h('input.entrada', {
      value: loja?.codigo ?? '',
      maxLength: 6,
      placeholder: 'Ex: GUA',
      style: { textTransform: 'uppercase' },
      disabled: editando,
    });
    const endereco = h('input.entrada', { value: loja?.endereco ?? '', placeholder: 'Rua, número, bairro, cidade' });
    const telefone = h('input.entrada', { value: loja?.telefone ?? '', placeholder: '(11) 2408-1122' });
    const erro = h('div.oculto');
    const botao = h('button.btn.btn--primario', { type: 'button', onclick: () => formulario.requestSubmit() }, icone('check', { tamanho: 16 }), editando ? 'Salvar alterações' : 'Cadastrar loja');

    const formulario = h(
      'form.pilha',
      {
      novalidate: true,
        onsubmit: async (evento) => {
          evento.preventDefault();
          if (nome.value.trim().length < 2) {
            montar(erro, h('div.faixa-erro', {}, icone('alerta', { tamanho: 20 }), h('div', {}, h('div.faixa-erro__titulo', {}, 'Informe o nome da loja'))));
            erro.classList.remove('oculto');
            return;
          }
          ocupado(botao, true, 'Salvando…');
          try {
            const corpo = {
              nome: nome.value.trim(),
              endereco: endereco.value.trim() || null,
              telefone: telefone.value.trim() || null,
            };
            if (!editando) corpo.codigo = codigo.value.trim().toUpperCase();
            const resposta = editando ? await api.patch(`/api/lojas/${loja.id}`, corpo) : await api.post('/api/lojas', corpo);
            modal.fechar();
            toastSucesso(resposta.mensagem);
            await carregar();
          } catch (e) {
            montar(
              erro,
              h('div.faixa-erro', {}, icone('alerta', { tamanho: 20 }), h('div', {}, h('div.faixa-erro__titulo', {}, 'Não foi possível salvar'), h('div.faixa-erro__texto', {}, e.message))),
            );
            erro.classList.remove('oculto');
          } finally {
            ocupado(botao, false);
          }
        },
      },
      erro,
      h('div.campo', {}, h('label.campo__rotulo', {}, 'Nome da loja *'), nome),
      h(
        'div.campo',
        {},
        h('label.campo__rotulo', {}, 'Código da OS *'),
        codigo,
        h('span.campo__dica', {}, editando ? 'O código não pode ser alterado (ele compõe o número das OS já emitidas).' : 'Usado no número da OS (ex: GUA-2026-0001). Até 6 letras/números.'),
      ),
      h('div.campo', {}, h('label.campo__rotulo', {}, 'Endereço'), endereco),
      h('div.campo', {}, h('label.campo__rotulo', {}, 'Telefone'), telefone),
    );

    const modal = abrirModal({
      titulo: editando ? `Editar ${loja.nome}` : 'Nova loja',
      descricao: editando ? 'Atualize os dados de contato da unidade' : 'A unidade passa a receber novas ordens de serviço',
      corpo: formulario,
      rodape: [h('button.btn.btn--secundario', { type: 'button', onclick: () => modal.fechar() }, 'Cancelar'), botao],
    });
    return modal;
  }

  async function excluirLoja(loja) {
    const ok = await confirmar({
      titulo: 'Excluir loja',
      mensagem: `"${loja.nome}" será removida definitivamente. Só é possível excluir lojas sem usuários vinculados e sem OS registradas.`,
      textoConfirmar: 'Excluir definitivamente',
      perigoso: true,
    });
    if (!ok) return;
    try {
      const resposta = await api.delete(`/api/lojas/${loja.id}`);
      toastSucesso(resposta.mensagem, { titulo: 'Loja excluída' });
      await carregar();
    } catch (erro) {
      toastErro(erro.message, { titulo: 'Não foi possível excluir' });
    }
  }

  /* ------------------------------- Usuários ------------------------------ */

  function renderUsuarios() {
    const botaoNovo = h(
      'button.btn.btn--primario',
      { type: 'button', onclick: () => modalUsuario(null) },
      icone('usuarioMais', { tamanho: 16 }),
      'Novo usuário',
    );

    const lista = estado.usuarios.length
      ? h(
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
                h('th', {}, 'Usuário'),
                h('th', {}, 'Perfil'),
                h('th', {}, 'Loja'),
                h('th', {}, 'Situação'),
                h('th', {}, 'Criado em'),
                h('th', {}, 'Ações'),
              ),
            ),
            h(
              'tbody',
              {},
              ...estado.usuarios.map((usuario) =>
                h(
                  'tr',
                  {},
                  h(
                    'td',
                    {},
                    h(
                      'div.linha',
                      { style: { gap: '10px' } },
                      h('span.avatar', {}, iniciais(usuario.nome)),
                      h(
                        'div',
                        { style: { minWidth: '0' } },
                        h('div.texto-forte', {}, usuario.nome),
                        h('div.texto-mini.texto-fraco', {}, usuario.email),
                      ),
                    ),
                  ),
                  h('td', {}, h('span.badge.badge--acento.badge--sem-ponto', {}, iniciaisPapel(usuario.papel))),
                  h('td', {}, usuario.loja_nome ?? h('span.texto-fraco', {}, 'Todas')),
                  h(
                    'td',
                    {},
                    usuario.ativo
                      ? h('span.badge.badge--pronto', {}, 'Ativo')
                      : h('span.badge.badge--retirado', {}, 'Inativo'),
                  ),
                  h('td.texto-mini.texto-fraco', {}, data(usuario.criado_em)),
                  h(
                    'td',
                    {},
                    h(
                      'div.linha',
                      { style: { gap: '4px' } },
                      h('button.btn.btn--pequeno.btn--secundario', { type: 'button', onclick: () => modalUsuario(usuario) }, 'Editar'),
                      h(
                        'button.btn.btn--pequeno.btn--fantasma',
                        { type: 'button', onclick: () => modalSenha(usuario) },
                        icone('cadeado', { tamanho: 14 }),
                        'Redefinir senha',
                      ),
                      usuario.id !== store.usuario.id
                        ? h(
                            'button.btn.btn--pequeno.btn--perigo',
                            {
                              type: 'button',
                              onclick: () => alternarAtivo(usuario),
                            },
                            usuario.ativo ? 'Desativar' : 'Ativar',
                          )
                        : h('span.texto-mini.texto-fraco', { style: { padding: '0 6px' } }, 'você'),
                      usuario.id !== store.usuario.id
                        ? h(
                            'button.btn.btn--pequeno.btn--perigo',
                            { type: 'button', onclick: () => excluirUsuario(usuario) },
                            icone('x', { tamanho: 14 }),
                            'Excluir',
                          )
                        : null,
                    ),
                  ),
                ),
              ),
            ),
          ),
        )
      : h('div.card', {}, estadoVazio({ icone: 'usuarios', titulo: 'Nenhum usuário', texto: 'Cadastre atendentes e técnicos vinculados às lojas.', acao: botaoNovo }));

    return h(
      'div.pilha',
      {},
      h('div.linha.linha--entre', {}, h('h2', {}, 'Equipe'), botaoNovo),
      lista,
    );
  }

  async function alternarAtivo(usuario) {
    const ok = await confirmar({
      titulo: usuario.ativo ? 'Desativar usuário' : 'Reativar usuário',
      mensagem: usuario.ativo
        ? `${usuario.nome} perde o acesso ao sistema imediatamente. O histórico dele permanece intacto.`
        : `${usuario.nome} volta a conseguir entrar no sistema.`,
      textoConfirmar: usuario.ativo ? 'Desativar' : 'Reativar',
      perigoso: usuario.ativo,
    });
    if (!ok) return;
    try {
      const resposta = await api.patch(`/api/usuarios/${usuario.id}`, { ativo: !usuario.ativo });
      toastSucesso(resposta.mensagem);
      await carregar();
    } catch (erro) {
      toastErro(erro.message);
    }
  }

  async function excluirUsuario(usuario) {
    const ok = await confirmar({
      titulo: 'Excluir usuário',
      mensagem: `${usuario.nome} será removido definitivamente. Só é possível excluir usuários sem histórico (OS, eventos ou fotos); caso contrário, desative-o.`,
      textoConfirmar: 'Excluir definitivamente',
      perigoso: true,
    });
    if (!ok) return;
    try {
      const resposta = await api.delete(`/api/usuarios/${usuario.id}`);
      toastSucesso(resposta.mensagem, { titulo: 'Usuário excluído' });
      await carregar();
    } catch (erro) {
      toastErro(erro.message, { titulo: 'Não foi possível excluir' });
    }
  }

  function modalUsuario(usuario) {
    const editando = Boolean(usuario);
    const nome = h('input.entrada', { required: true, value: usuario?.nome ?? '', placeholder: 'Nome completo' });
    const email = h('input.entrada', { type: 'text', required: true, value: usuario?.email ?? '', placeholder: 'usuario ou pessoa@loja.com.br', autocapitalize: 'none', spellcheck: false });
    const senha = h('input.entrada', { type: 'text', value: 'galaxy2026!', required: !editando });
    const papel = h(
      'select.selecao',
      {},
      ...['atendente', 'tecnico', 'admin'].map((p) => h('option', { value: p, selected: (usuario?.papel ?? 'atendente') === p }, iniciaisPapel(p))),
    );
    const loja = h(
      'select.selecao',
      {},
      h('option', { value: '' }, 'Sem loja'),
      ...estado.lojas.map((l) => h('option', { value: String(l.id), selected: String(usuario?.loja_id ?? '') === String(l.id) }, l.nome)),
    );
    const tel = h('input.entrada', { value: usuario?.telefone ?? '', placeholder: '(11) 91234-5678' });
    const blocoLoja = h('div.campo', {}, h('label.campo__rotulo', {}, 'Loja vinculada *'), loja, h('span.campo__dica', {}, 'Só o atendente precisa de loja. Técnico e admin enxergam a rede inteira.'));
    const blocoSenha = h(
      'div.campo',
      {},
      h('label.campo__rotulo', {}, editando ? 'Nova senha (opcional)' : 'Senha inicial *'),
      senha,
      h('span.campo__dica', {}, 'Mínimo 6 caracteres com letras e números. A senha é guardada com hash scrypt — ninguém consegue lê-la depois.'),
    );

    const sincronizar = () => {
      blocoLoja.classList.toggle('oculto', papel.value !== 'atendente');
    };
    papel.addEventListener('change', sincronizar);
    sincronizar();

    const erro = h('div.oculto');
    const botao = h('button.btn.btn--primario', { type: 'button', onclick: () => formulario.requestSubmit() }, icone('check', { tamanho: 16 }), editando ? 'Salvar alterações' : 'Criar usuário');

    const formulario = h(
      'form.pilha',
      {
      novalidate: true,
        onsubmit: async (evento) => {
          evento.preventDefault();
          erro.classList.add('oculto');
          ocupado(botao, true, 'Salvando…');
          try {
            if (editando) {
              const corpo = {
                nome: nome.value.trim(),
                email: email.value.trim(),
                papel: papel.value,
                lojaId: loja.value ? Number(loja.value) : null,
                telefone: tel.value.trim() || null,
              };
              const resposta = await api.patch(`/api/usuarios/${usuario.id}`, corpo);
              if (senha.value.trim()) await api.post(`/api/usuarios/${usuario.id}/senha`, { novaSenha: senha.value.trim() });
              modal.fechar();
              toastSucesso(resposta.mensagem);
            } else {
              const resposta = await api.post('/api/usuarios', {
                nome: nome.value.trim(),
                email: email.value.trim(),
                senha: senha.value,
                papel: papel.value,
                lojaId: loja.value ? Number(loja.value) : null,
                telefone: tel.value.trim() || null,
              });
              modal.fechar();
              toastSucesso(resposta.mensagem, { titulo: 'Usuário criado' });
            }
            await carregar();
          } catch (e) {
            montar(
              erro,
              h('div.faixa-erro', {}, icone('alerta', { tamanho: 20 }), h('div', {}, h('div.faixa-erro__titulo', {}, 'Não foi possível salvar'), h('div.faixa-erro__texto', {}, e.message))),
            );
            erro.classList.remove('oculto');
          } finally {
            ocupado(botao, false);
          }
        },
      },
      erro,
      h('div.formulario__linha.formulario__linha--2', {}, h('div.campo', {}, h('label.campo__rotulo', {}, 'Nome *'), nome), h('div.campo', {}, h('label.campo__rotulo', {}, 'Usuário (login) *'), email)),
      h('div.formulario__linha.formulario__linha--2', {}, h('div.campo', {}, h('label.campo__rotulo', {}, 'Perfil de acesso *'), papel), blocoLoja),
      h('div.campo', {}, h('label.campo__rotulo', {}, 'Telefone'), tel),
      blocoSenha,
    );

    const modal = abrirModal({
      titulo: editando ? `Editar ${usuario.nome}` : 'Novo usuário',
      descricao: editando ? 'Alterações de perfil valem a partir do próximo acesso' : 'Defina o perfil e a loja do novo membro da equipe',
      corpo: formulario,
      rodape: [h('button.btn.btn--secundario', { type: 'button', onclick: () => modal.fechar() }, 'Cancelar'), botao],
    });
    return modal;
  }

  function modalSenha(usuario) {
    const nova = h('input.entrada', { type: 'text', required: true, value: gerarSenhaForte(), spellcheck: false, autocomplete: 'off' });
    const erro = h('div.oculto');
    const botaoGerar = h('button.btn.btn--secundario.btn--pequeno', { type: 'button' }, icone('recarregar', { tamanho: 14 }), 'Gerar outra');
    const botaoCopiar = h('button.btn.btn--fantasma.btn--pequeno', { type: 'button' }, icone('olho', { tamanho: 14 }), 'Copiar');
    botaoGerar.addEventListener('click', () => {
      nova.value = gerarSenhaForte();
    });
    botaoCopiar.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(nova.value);
        toastSucesso('Senha copiada.', { titulo: 'Pronto' });
      } catch {
        nova.select?.();
      }
    });
    const botao = h('button.btn.btn--primario', { type: 'button', onclick: () => formulario.requestSubmit() }, icone('check', { tamanho: 16 }), 'Redefinir senha');
    const formulario = h(
      'form.pilha',
      {
      novalidate: true,
        onsubmit: async (evento) => {
          evento.preventDefault();
          ocupado(botao, true, 'Salvando…');
          try {
            const resposta = await api.post(`/api/usuarios/${usuario.id}/senha`, { novaSenha: nova.value });
            modal.fechar();
            toastSucesso(resposta.mensagem, { titulo: 'Senha redefinida' });
          } catch (e) {
            montar(erro, h('div.faixa-erro', {}, icone('alerta', { tamanho: 20 }), h('div', {}, h('div.faixa-erro__titulo', {}, 'Não foi possível redefinir'), h('div.faixa-erro__texto', {}, e.message))));
            erro.classList.remove('oculto');
          } finally {
            ocupado(botao, false);
          }
        },
      },
      erro,
      h('p.texto-pequeno.texto-suave', {}, `Nova senha de ${usuario.nome} (${iniciaisPapel(usuario.papel)}). As sessões abertas dele serão encerradas.`),
      h('div.campo', {}, h('label.campo__rotulo', {}, 'Nova senha'), nova, h('span.campo__dica', {}, 'Anote e informe ao usuário — não é possível consultar depois.')),
      h('div.grupo-botoes', {}, botaoGerar, botaoCopiar),
    );
    const modal = abrirModal({
      titulo: `Redefinir senha de ${usuario.nome}`,
      descricao: 'Somente o administrador altera senhas',
      corpo: formulario,
      rodape: [h('button.btn.btn--secundario', { type: 'button', onclick: () => modal.fechar() }, 'Cancelar'), botao],
    });
    return modal;
  }

  function gerarSenhaForte() {
    const conjuntos = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%&*'];
    const todos = conjuntos.join('');
    const sortear = (fonte) => fonte[Math.floor(Math.random() * fonte.length)];
    const base = conjuntos.map((c) => sortear(c));
    while (base.length < 10) base.push(sortear(todos));
    return base.sort(() => Math.random() - 0.5).join('');
  }

  /* ------------------------------ Auditoria ------------------------------ */

  const ROTULOS_EXCLUSAO = { os: 'Ordem de serviço', foto: 'Anexo', loja: 'Loja', usuario: 'Usuário', backup: 'Backup' };

  async function exportarBackup(botao) {
    ocupado(botao, true, 'Gerando…');
    try {
      const { backup } = await api.get('/api/admin/backup');
      const conteudo = JSON.stringify(backup, null, 2);
      const url = URL.createObjectURL(new Blob([conteudo], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `backup-assistencia-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toastSucesso('Backup gerado.', { titulo: 'Download iniciado' });
    } catch (erro) {
      toastErro(erro.message, { titulo: 'Não foi possível gerar o backup' });
    } finally {
      ocupado(botao, false);
    }
  }

  async function restaurarBackup(arquivo, input) {
    if (input) input.value = '';
    if (!arquivo) return;

    let backup;
    try {
      backup = JSON.parse(await arquivo.text());
    } catch {
      toastErro('O arquivo selecionado não é um JSON válido.', { titulo: 'Backup inválido' });
      return;
    }

    const confirmado = await confirmar({
      titulo: 'Restaurar backup',
      mensagem:
        'Isto substitui TODOS os dados atuais (lojas, usuários, OS, histórico e registros de exclusão) pelo conteúdo do arquivo e encerra todas as sessões. Não é possível desfazer.',
      textoConfirmar: 'Substituir tudo',
      perigoso: true,
    });
    if (!confirmado) return;

    try {
      const resposta = await api.post('/api/admin/backup', { backup });
      toastSucesso(resposta.mensagem ?? 'Backup restaurado.', { titulo: 'Restaurado' });
      window.location.hash = '/login';
      window.location.reload();
    } catch (erro) {
      toastErro(erro.message, { titulo: 'Não foi possível restaurar' });
    }
  }

  function renderConfig() {
    const garantia = h('input.entrada', {
      type: 'number',
      min: '0',
      max: '3650',
      inputMode: 'numeric',
      value: String(estado.config.garantia_dias_padrao ?? '90'),
    });
    const prazo = h('input.entrada', {
      type: 'number',
      min: '0',
      max: '365',
      inputMode: 'numeric',
      value: String(estado.config.prazo_dias_padrao ?? '5'),
    });
    const botao = h('button.btn.btn--primario', { type: 'button' }, icone('check', { tamanho: 16 }), 'Salvar regras');

    botao.addEventListener('click', async () => {
      ocupado(botao, true, 'Salvando…');
      try {
        const resposta = await api.patch('/api/admin/configuracoes', {
          garantiaDiasPadrao: Number(garantia.value),
          prazoDiasPadrao: Number(prazo.value),
        });
        estado.config = resposta.configuracoes ?? estado.config;
        toastSucesso(resposta.mensagem ?? 'Regras salvas.', { titulo: 'Configurações' });
      } catch (erro) {
        toastErro(erro.message);
      } finally {
        ocupado(botao, false);
      }
    });

    return h(
      'div.pilha--grande.pilha',
      {},
      h(
        'div.card',
        {},
        h(
          'div.card__cabecalho',
          {},
          h('h3', {}, 'Regras de negócio'),
          h('span.texto-mini.texto-suave', {}, 'Valem para toda a rede'),
        ),
        h(
          'div.card__corpo.formulario',
          {},
          h(
            'div.formulario__linha.formulario__linha--2',
            {},
            h(
              'div.campo',
              {},
              h('label.campo__rotulo', {}, 'Garantia padrão (dias)'),
              garantia,
              h('span.campo__dica', {}, 'Sugerida ao concluir o serviço e usada no cálculo da garantia na retirada.'),
            ),
            h(
              'div.campo',
              {},
              h('label.campo__rotulo', {}, 'Prazo de retirada (dias)'),
              prazo,
              h('span.campo__dica', {}, 'Previsão mostrada ao cliente no acompanhamento da OS.'),
            ),
          ),
          h('div', {}, botao),
        ),
      ),
    );
  }

  function renderAuditoria() {
    const entradaArquivo = h('input', {
      type: 'file',
      accept: '.json,application/json',
      hidden: true,
      onchange: (evento) => restaurarBackup(evento.target.files?.[0], evento.target),
    });

    const listaExclusoes = estado.exclusoes.length
      ? h(
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
                h('th', {}, 'Quando'),
                h('th', {}, 'Tipo'),
                h('th', {}, 'Referência'),
                h('th', {}, 'Detalhes'),
                h('th', {}, 'Autor'),
              ),
            ),
            h(
              'tbody',
              {},
              ...estado.exclusoes.map((item) =>
                h(
                  'tr',
                  {},
                  h('td.texto-mini.texto-fraco', {}, dataHora(item.criado_em)),
                  h('td', {}, ROTULOS_EXCLUSAO[item.tipo] ?? item.tipo),
                  h('td.texto-mono.texto-pequeno', {}, item.referencia ?? '—'),
                  h('td.texto-mini', {}, item.detalhes ?? '—'),
                  h('td.texto-pequeno', {}, item.usuario_nome ?? '—'),
                ),
              ),
            ),
          ),
        )
      : estadoVazio({
          icone: 'escudo',
          titulo: 'Nenhuma exclusão registrada',
          texto: 'Quando uma OS, um anexo, uma loja ou um usuário for excluído, o registro aparece aqui.',
        });

    return h(
      'div.pilha--grande.pilha',
      {},
      h(
        'div.card',
        {},
        h('div.card__cabecalho', {}, h('h3', {}, 'Como funciona a auditoria')),
        h(
          'div.card__corpo.pilha',
          {},
          h(
            'p',
            {},
            'Toda mudança relevante é gravada na tabela de eventos com data/hora, autor e status anterior/novo. Esses registros são imutáveis no próprio banco de dados: o sistema bloqueia UPDATE e DELETE na trilha de auditoria, inclusive para administradores.',
          ),
          h(
            'ul.pilha--pequena.pilha',
            { style: { paddingLeft: '20px', margin: 0, color: 'var(--cor-texto-suave)' } },
            h('li', {}, 'Entrada do aparelho, assumir, pausar por peça, concluir e retirar.'),
            h('li', {}, 'Todas as anotações técnicas e de atendimento.'),
            h('li', {}, 'Cada foto anexada, com autor e horário.'),
            h('li', {}, 'Campos imutáveis na OS: loja de entrada, número, nome do cliente e data de criação.'),
          ),
          h(
            'div.faixa-aviso',
            {},
            icone('escudo', { tamanho: 18 }),
            h('span', {}, 'Para consultar a trilha de uma OS específica, abra a ordem e veja a seção "Histórico auditável".'),
          ),
          h(
            'div',
            { style: { marginTop: '4px' } },
            h('a.btn.btn--secundario', { href: '#/ordens' }, icone('lista', { tamanho: 16 }), 'Abrir lista de OS'),
          ),
        ),
      ),
      h(
        'div.card',
        {},
        h(
          'div.card__cabecalho',
          {},
          h('h3', {}, 'Exclusões registradas'),
          h('span.texto-mini.texto-suave', {}, `${estado.exclusoes.length} registro(s)`),
        ),
        h('div.card__corpo', {}, listaExclusoes),
      ),
      h(
        'div.card',
        {},
        h('div.card__cabecalho', {}, h('h3', {}, 'Backup dos dados')),
        h(
          'div.card__corpo.pilha',
          {},
          h(
            'p.texto-pequeno.texto-suave',
            {},
            'Baixe um arquivo .json com todas as tabelas (lojas, usuários, ordens, histórico e registros de fotos). O arquivo contém os logins do sistema — guarde-o em local seguro.',
          ),
          h(
            'div.grupo-botoes',
            {},
            h(
              'button.btn.btn--secundario',
              { type: 'button', onclick: (evento) => exportarBackup(evento.currentTarget) },
              icone('download', { tamanho: 16 }),
              'Exportar backup (.json)',
            ),
            h(
              'button.btn.btn--secundario',
              { type: 'button', onclick: () => entradaArquivo.click() },
              icone('recarregar', { tamanho: 16 }),
              'Restaurar backup',
            ),
            entradaArquivo,
          ),
          h(
            'p.texto-mini.texto-fraco',
            {},
            'Restaurar substitui os dados atuais e encerra todas as sessões. Os arquivos das fotos não entram no backup — apenas os registros que apontam para elas.',
          ),
        ),
      ),
    );
  }
}
