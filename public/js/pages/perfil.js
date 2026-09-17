import { h } from '../dom.js';
import { icone } from '../icons.js';
import { abrirModal, toastSucesso, toastErro, ocupado, confirmar } from '../ui.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { iniciais, iniciaisPapel } from '../format.js';

export function abrirPerfil({ aoFechar } = {}) {
  const usuario = store.usuario;
  const botaoSalvar = h('button.btn.btn--primario', { type: 'submit' }, icone('check', { tamanho: 16 }), 'Salvar nova senha');

  const campoAtual = h('input.entrada', { type: 'password', autocomplete: 'current-password', required: true });
  const campoNova = h('input.entrada', { type: 'password', autocomplete: 'new-password', required: true, minLength: 6 });
  const campoConfirma = h('input.entrada', { type: 'password', autocomplete: 'new-password', required: true, minLength: 6 });
  const erroSenha = h('div.campo__erro.oculto');

  const formulario = h(
    'form.formulario',
    {
      novalidate: true,
      onsubmit: async (evento) => {
        evento.preventDefault();
        erroSenha.classList.add('oculto');
        if (campoNova.value !== campoConfirma.value) {
          erroSenha.textContent = 'A confirmação não corresponde à nova senha.';
          erroSenha.classList.remove('oculto');
          campoConfirma.focus();
          return;
        }
        ocupado(botaoSalvar, true, 'Salvando…');
        try {
          const resposta = await api.post('/api/auth/senha', {
            senhaAtual: campoAtual.value,
            novaSenha: campoNova.value,
          });
          toastSucesso(resposta.mensagem ?? 'Senha alterada.', { titulo: 'Tudo certo' });
          campoAtual.value = '';
          campoNova.value = '';
          campoConfirma.value = '';
        } catch (erro) {
          erroSenha.textContent = erro.message;
          erroSenha.classList.remove('oculto');
        } finally {
          ocupado(botaoSalvar, false);
        }
      },
    },
    h('h4', {}, 'Alterar minha senha'),
    h('div.campo', {}, h('label.campo__rotulo', {}, 'Senha atual'), campoAtual),
    h(
      'div.campo',
      {},
      h('label.campo__rotulo', {}, 'Nova senha'),
      campoNova,
      h('span.campo__dica', {}, 'Mínimo de 6 caracteres, com letras e números.'),
    ),
    h('div.campo', {}, h('label.campo__rotulo', {}, 'Confirmar nova senha'), campoConfirma),
    erroSenha,
    h('div.grupo-botoes', {}, botaoSalvar),
  );

  const corpo = h(
    'div.pilha--grande.pilha',
    {},
    h(
      'div.linha.linha--quebra',
      { style: { gap: '14px' } },
      h('span.avatar.avatar--grande', {}, iniciais(usuario?.nome)),
      h(
        'div',
        { style: { minWidth: '0' } },
        h('div.texto-forte', {}, usuario?.nome ?? ''),
        h('div.texto-pequeno.texto-suave', {}, usuario?.email ?? ''),
        h('div.linha.texto-mini', { style: { gap: '6px', marginTop: '4px' } },
          h('span.badge.badge--acento.badge--sem-ponto', {}, iniciaisPapel(usuario?.papel)),
          usuario?.lojaNome ? h('span.badge.badge--sem-ponto', {}, usuario.lojaNome) : null,
        ),
      ),
    ),
    h('hr.divisor'),
    h(
      'div.linha.linha--entre',
      {},
      h(
        'div',
        {},
        h('div.texto-forte', {}, 'Aparência'),
        h('div.texto-mini.texto-suave', {}, 'Escolha entre tema claro e escuro.'),
      ),
      h(
        'button.btn.btn--secundario',
        {
          type: 'button',
          onclick: (evento) => {
            const tema = store.alternarTema();
            const botao = evento.currentTarget;
            botao.replaceChildren(
              icone(tema === 'escuro' ? 'sol' : 'lua', { tamanho: 16 }),
              tema === 'escuro' ? 'Tema claro' : 'Tema escuro',
            );
          },
        },
        icone(store.tema === 'escuro' ? 'sol' : 'lua', { tamanho: 16 }),
        store.tema === 'escuro' ? 'Tema claro' : 'Tema escuro',
      ),
    ),
    h('hr.divisor'),
    formulario,
    h('hr.divisor'),
    h(
      'button.btn.btn--perigo.btn--bloco',
      {
        type: 'button',
        onclick: async () => {
          const confirmado = await confirmar({
            titulo: 'Encerrar sessão',
            mensagem: 'Você precisará informar usuário e senha para entrar novamente neste dispositivo.',
            textoConfirmar: 'Sair agora',
            perigoso: true,
          });
          if (!confirmado) return;
          await store.sair();
          modal.fechar();
          window.location.hash = '/login';
          window.location.reload();
        },
      },
      icone('sair', { tamanho: 16 }),
      'Sair da conta',
    ),
    h(
      'p.texto-mini.texto-fraco.texto-central',
      {},
      'Os registros de auditoria (quem fez o quê e quando) não podem ser editados nem apagados por nenhum perfil.',
    ),
  );

  const modal = abrirModal({
    titulo: 'Minha conta',
    descricao: 'Dados de acesso, aparência e segurança',
    corpo,
    aoFechar,
  });

  return modal;
}
