export class ErroApi extends Error {
  constructor(mensagem, { status = 0, codigo = 'erro_rede', detalhes = null } = {}) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

let aoPerderSessao = null;
export function definirTratadorDeSessao(fn) {
  aoPerderSessao = fn;
}

function montarQuery(params) {
  const query = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params ?? {})) {
    if (valor === null || valor === undefined || valor === '') continue;
    query.set(chave, String(valor));
  }
  const texto = query.toString();
  return texto ? `?${texto}` : '';
}

async function interpretar(resposta) {
  const tipo = resposta.headers.get('content-type') ?? '';
  let corpo = null;
  if (tipo.includes('application/json')) {
    try {
      corpo = await resposta.json();
    } catch {
      corpo = null;
    }
  }
  if (!resposta.ok) {
    const erro = corpo?.erro ?? {};
    const mensagem =
      erro.mensagem ??
      (resposta.status === 404
        ? 'Não encontramos o que você procurava.'
        : resposta.status >= 500
          ? 'O servidor não conseguiu concluir a operação. Tente novamente em instantes.'
          : 'Não foi possível concluir a operação.');
    if (resposta.status === 401 && aoPerderSessao) aoPerderSessao();
    throw new ErroApi(mensagem, {
      status: resposta.status,
      codigo: erro.codigo ?? 'erro',
      detalhes: erro.detalhes ?? null,
    });
  }
  return corpo ?? {};
}

async function requisitar(metodo, caminho, { corpo, params, timeoutMs = 30000 } = {}) {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), timeoutMs);
  try {
    const resposta = await fetch(`${caminho}${montarQuery(params)}`, {
      method: metodo,
      headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      credentials: 'same-origin',
      signal: controlador.signal,
    });
    return await interpretar(resposta);
  } catch (erro) {
    if (erro instanceof ErroApi) throw erro;
    if (erro.name === 'AbortError') {
      throw new ErroApi('A conexão demorou demais para responder. Verifique o sinal e tente novamente.', {
        codigo: 'timeout',
      });
    }
    throw new ErroApi(
      'Sem conexão com o servidor. Confira o Wi-Fi ou os dados móveis e tente novamente.',
      { codigo: 'erro_rede' },
    );
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: (caminho, params) => requisitar('GET', caminho, { params }),
  post: (caminho, corpo, params) => requisitar('POST', caminho, { corpo, params }),
  patch: (caminho, corpo) => requisitar('PATCH', caminho, { corpo }),
  delete: (caminho) => requisitar('DELETE', caminho),

  /** Envia binário (foto/assinatura) como corpo cru — sem base64, sem multipart. */
  async enviarArquivo(caminho, blob, { params, timeoutMs = 60000 } = {}) {
    const controlador = new AbortController();
    const timer = setTimeout(() => controlador.abort(), timeoutMs);
    try {
      const resposta = await fetch(`${caminho}${montarQuery(params)}`, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob,
        credentials: 'same-origin',
        signal: controlador.signal,
      });
      return await interpretar(resposta);
    } catch (erro) {
      if (erro instanceof ErroApi) throw erro;
      if (erro.name === 'AbortError') {
        throw new ErroApi('O envio da foto demorou demais. Aproxime-se do Wi-Fi e tente novamente.', {
          codigo: 'timeout',
        });
      }
      throw new ErroApi('Falha ao enviar a foto. Verifique a conexão e tente novamente.', {
        codigo: 'erro_rede',
      });
    } finally {
      clearTimeout(timer);
    }
  },

  /** Dispara o download de um arquivo gerado pelo servidor (ex.: CSV). */
  async baixar(caminho, params, nomeSugerido) {
    const resposta = await fetch(`${caminho}${montarQuery(params)}`, { credentials: 'same-origin' });
    if (resposta.status === 401 && aoPerderSessao) aoPerderSessao();
    if (!resposta.ok) {
      throw new ErroApi('Não foi possível gerar o arquivo agora. Tente novamente.', { status: resposta.status });
    }
    const blob = await resposta.blob();
    const disposicao = resposta.headers.get('content-disposition') ?? '';
    const casamento = /filename="([^"]+)"/.exec(disposicao);
    const nome = casamento?.[1] ?? nomeSugerido ?? 'download';
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return nome;
  },
};
