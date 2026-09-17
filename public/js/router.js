/**
 * Roteamento por hash (#/ordens/12?status=pronto).
 * Funciona com o botão "voltar" do celular e dispensa configuração de
 * servidor para rotas profundas.
 */
export class Roteador {
  constructor() {
    this.rotas = [];
  }

  registrar(padrao, montar) {
    const chaves = [];
    const regex = new RegExp(
      '^' +
        padrao
          .split('/')
          .filter(Boolean)
          .map((segmento) => {
            if (segmento.startsWith(':')) {
              chaves.push(segmento.slice(1));
              return '([^/]+)';
            }
            return segmento.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('/') +
        '$',
    );
    this.rotas.push({ regex, chaves, montar, padrao });
    return this;
  }

  /** @returns {{montar, params, padrao, caminho}|null} */
  resolver(hash) {
    const bruto = String(hash ?? '').replace(/^#/, '');
    const [caminhoBruto] = bruto.split('?');
    const caminho = caminhoBruto.replace(/^\/+|\/+$/g, '');

    for (const rota of this.rotas) {
      const casamento = rota.regex.exec(caminho);
      if (!casamento) continue;
      const params = {};
      rota.chaves.forEach((chave, i) => {
        params[chave] = decodeURIComponent(casamento[i + 1]);
      });
      return { montar: rota.montar, params, padrao: rota.padrao, caminho: `/${caminho}` };
    }
    return null;
  }

  /** Caminho atual sem a query string (ex.: "/ordens/7"). */
  static caminhoAtual(hash) {
    return `/${String(hash ?? '').replace(/^#/, '').split('?')[0].replace(/^\/+|\/+$/g, '')}`;
  }
}

/** Lê o hash atual de forma estruturada: partes do caminho + query string. */
export function analisarRota(hash = window.location.hash) {
  const bruto = String(hash || '#/').replace(/^#/, '');
  const [caminho, queryTexto] = bruto.split('?');
  return {
    caminho,
    partes: caminho.split('/').filter(Boolean),
    query: new URLSearchParams(queryTexto ?? ''),
  };
}
