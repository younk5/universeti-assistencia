import { h, montar } from '../dom.js';
import { icone } from '../icons.js';
import { store } from '../store.js';
import { toastErro, faixaErro, monitorarConexao } from '../ui.js';

const CONTAS_DEMO = [
  { papel: 'Administrador', login: 'UniverseTI' },
  { papel: 'Atendente (Centro)', login: 'atendente.centro@universeti.com.br' },
  { papel: 'Técnico (Centro)', login: 'tecnico.centro@universeti.com.br' },
];
const SENHA_DEMO = 'galaxy2026!';

const ehAmbienteLocal = () =>
  ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname) ||
  window.location.hostname.endsWith('.local');

export function montarLogin() {
  const raiz = document.getElementById('app');
  monitorarConexao();

  const campoLogin = h('input.entrada', {
    type: 'text',
    id: 'login-usuario',
    name: 'login',
    autocomplete: 'username',
    inputMode: 'text',
    autocapitalize: 'none',
    spellcheck: false,
    required: true,
    placeholder: 'Seu usuário',
    'aria-label': 'Usuário',
  });

  const campoSenha = h('input.entrada', {
    type: 'password',
    id: 'login-senha',
    name: 'senha',
    autocomplete: 'current-password',
    required: true,
    placeholder: 'Sua senha',
    'aria-label': 'Senha',
  });

  const botaoOlho = h(
    'button.senha-wrapper__botao',
    {
      type: 'button',
      'aria-label': 'Mostrar senha',
      onclick: () => {
        const visivel = campoSenha.type === 'text';
        campoSenha.type = visivel ? 'password' : 'text';
        botaoOlho.setAttribute('aria-label', visivel ? 'Mostrar senha' : 'Ocultar senha');
        montar(botaoOlho, icone(visivel ? 'olho' : 'olhoFechado', { tamanho: 17 }));
      },
    },
    icone('olho', { tamanho: 17 }),
  );

  const areaErro = h('div', { style: { display: 'none' } });
  const botao = h('button.btn.btn--primario.btn--grande.btn--bloco', { type: 'submit' }, 'Entrar no sistema');

  let enviando = false;

  async function entrar(evento) {
    evento?.preventDefault();
    if (enviando) return;
    areaErro.style.display = 'none';

    const login = campoLogin.value.trim();
    const senha = campoSenha.value;

    if (!login || !senha) {
      mostrarErro('Preencha o usuário e a senha para entrar.');
      (!login ? campoLogin : campoSenha).focus();
      return;
    }

    enviando = true;
    botao.disabled = true;
    montar(botao, h('span.btn__spinner'), 'Entrando…');

    try {
      await store.entrar(login, senha);
      window.location.hash = '/painel';
      window.location.reload();
    } catch (erro) {
      mostrarErro(erro.message);
      campoSenha.value = '';
      if (erro.codigo === 'credenciais_invalidas') campoSenha.focus();
      else campoLogin.focus();
      toastErro(erro.message, { titulo: 'Não foi possível entrar' });
    } finally {
      enviando = false;
      botao.disabled = false;
      montar(botao, 'Entrar no sistema');
    }
  }

  function mostrarErro(mensagem) {
    montar(areaErro, faixaErro(mensagem, { titulo: 'Falha no acesso' }));
    areaErro.style.display = 'block';
  }

  const formulario = h(
    'form.pilha',
    { onsubmit: entrar, novalidate: true },
    h(
      'div.campo',
      {},
      h('label.campo__rotulo', { for: 'login-usuario' }, 'Usuário'),
      h(
        'div.campo-com-icone',
        {},
        h('span.campo-com-icone__icone', {}, icone('usuario', { tamanho: 17 })),
        campoLogin,
      ),
    ),
    h(
      'div.campo',
      {},
      h(
        'div.linha.linha--entre',
        {},
        h('label.campo__rotulo', { for: 'login-senha' }, 'Senha'),
        h('span.campo__dica', {}, 'Esqueceu? Fale com o administrador'),
      ),
      h('div.senha-wrapper', {}, campoSenha, botaoOlho),
    ),
    areaErro,
    botao,
  );

  const contasDemo = ehAmbienteLocal()
    ? h(
        'div.login__contas',
        {},
        h('div.login__contas-titulo', {}, 'Contas de demonstração'),
        h(
          'div',
          {},
          ...CONTAS_DEMO.map((conta) =>
            h(
              'button.login__conta',
              {
                type: 'button',
                onclick: () => {
                  campoLogin.value = conta.login;
                  campoSenha.value = SENHA_DEMO;
                  campoSenha.focus();
                },
              },
              h('strong', {}, conta.papel),
              h('span.login__conta-email', {}, conta.login),
            ),
          ),
        ),
        h(
          'p.texto-mini.texto-fraco',
          { style: { marginTop: '8px' } },
          `Senha de todas as contas: ${SENHA_DEMO}`,
        ),
      )
    : null;

  montar(
    raiz,
    h(
      'div.login',
      {},
      h(
        'section.login__lateral',
        {},
        h(
          'div.login__lateral-topo',
          {},
          h('div.login__lateral-logo', {}, h('img', { src: '/img/icone.png', alt: 'UniverseTI' })),
          h('div', {}, h('div.texto-forte', {}, 'UniverseTI Assistência'), h('div.texto-mini', { style: { opacity: 0.8 } }, 'Assistência técnica de celulares')),
        ),
        h(
          'div',
          {},
          h('h2', {}, 'Acesso restrito à equipe.'),
          h('p', {}, 'Entre com o usuário e a senha cadastrados pelo administrador do sistema.'),
        ),
        h('p.texto-mini', { style: { opacity: 0.7, position: 'relative', zIndex: 1 } }, 'Assistência técnica de celulares'),
      ),
      h(
        'section.login__area',
        {},
        h(
          'div.login__cartao',
          {},
          h(
            'div.login__marca',
            {},
            h('div.login__marca-logo', {}, h('img', { src: '/img/icone.png', alt: 'UniverseTI' })),
            h('div', {}, h('h1', { style: { fontSize: '1.3rem' } }, 'Entrar na UniverseTI Assistência'), h('p.texto-pequeno.texto-suave', {}, 'Acesso restrito à equipe')),
          ),
          formulario,
          contasDemo,
        ),
      ),
    ),
  );

  setTimeout(() => campoLogin.focus(), 80);
}
