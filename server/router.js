/**
 * Roteador mínimo baseado em padrões de caminho ("/api/ordens/:id/fotos").
 * Mantido sem dependências de propósito: fácil de auditar e ler.
 */
export class Roteador {
  constructor() {
    this.rotas = [];
  }

  add(metodo, padrao, handler) {
    const chaves = [];
    const regex = new RegExp(
      '^' +
        padrao
          .split('/')
          .map((segmento) => {
            if (segmento.startsWith(':')) {
              chaves.push(segmento.slice(1));
              return '([^/]+)';
            }
            return segmento.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('/') +
        '/?$',
    );
    this.rotas.push({ metodo: metodo.toUpperCase(), regex, chaves, handler, padrao });
    return this;
  }

  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  /** @returns {{handler: Function, params: Record<string,string>}|null} */
  encontrar(metodo, caminho) {
    let caminhoPermitido = false;
    for (const rota of this.rotas) {
      const match = rota.regex.exec(caminho);
      if (!match) continue;
      if (rota.metodo !== metodo.toUpperCase()) {
        caminhoPermitido = true;
        continue;
      }
      const params = {};
      rota.chaves.forEach((chave, i) => {
        params[chave] = decodeURIComponent(match[i + 1]);
      });
      return { handler: rota.handler, params };
    }
    return caminhoPermitido ? { metodoNaoPermitido: true } : null;
  }
}
