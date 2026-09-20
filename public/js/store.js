import { api } from './api.js';

const CHAVE_TEMA = 'tecnoflow.tema';

const estado = {
  usuario: null,
  permissoes: [],
  meta: null,
  tema: document.documentElement.getAttribute('data-tema') ?? 'claro',
  resumo: null,
  ouvintes: new Set(),
};

export const store = {
  get usuario() {
    return estado.usuario;
  },
  get permissoes() {
    return estado.permissoes;
  },
  get meta() {
    return estado.meta;
  },
  get tema() {
    return estado.tema;
  },
  get resumo() {
    return estado.resumo;
  },

  pode(permissao) {
    return estado.permissoes.includes(permissao);
  },

  get papel() {
    return estado.usuario?.papel ?? null;
  },

  get ehAdmin() {
    return estado.usuario?.papel === 'admin';
  },

  /**
   * Visão de rede: administrador e técnico enxergam todas as lojas; o
   * atendente fica restrito à própria loja.
   */
  get escopoRede() {
    return estado.usuario?.papel === 'admin' || estado.usuario?.papel === 'tecnico';
  },

  definirSessao(usuario, permissoes) {
    estado.usuario = usuario;
    estado.permissoes = permissoes ?? [];
    notificar();
  },

  limparSessao() {
    estado.usuario = null;
    estado.permissoes = [];
    estado.meta = null;
    estado.resumo = null;
    notificar();
  },

  definirMeta(meta) {
    estado.meta = meta;
  },

  definirResumo(resumo) {
    estado.resumo = resumo;
    notificar();
  },

  alternarTema() {
    const novo = estado.tema === 'escuro' ? 'claro' : 'escuro';
    estado.tema = novo;
    document.documentElement.setAttribute('data-tema', novo);
    try {
      localStorage.setItem(CHAVE_TEMA, novo);
    } catch {
      /* modo privado: segue sem persistir */
    }
    notificar();
    return novo;
  },

  assinar(ouvinte) {
    estado.ouvintes.add(ouvinte);
    return () => estado.ouvintes.delete(ouvinte);
  },

  async carregarSessao() {
    try {
      const dados = await api.get('/api/auth/me');
      this.definirSessao(dados.usuario, dados.permissoes);
      return dados.usuario;
    } catch {
      this.limparSessao();
      return null;
    }
  },

  async carregarMeta() {
    try {
      const meta = await api.get('/api/meta');
      this.definirMeta(meta);
      return meta;
    } catch {
      return null;
    }
  },

  async entrar(login, senha) {
    const dados = await api.post('/api/auth/login', { login, senha });
    this.definirSessao(dados.usuario, dados.permissoes);
    await this.carregarMeta();
    return dados.usuario;
  },

  async sair() {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* mesmo com falha de rede a sessão local é encerrada */
    }
    this.limparSessao();
  },
};

function notificar() {
  for (const ouvinte of estado.ouvintes) {
    try {
      ouvinte(estado);
    } catch (erro) {
      console.error('[store] ouvinte falhou', erro);
    }
  }
}
