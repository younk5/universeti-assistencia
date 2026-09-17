/**
 * Gerador de PDF mínimo, sem dependências externas.
 *
 * O documento (etiqueta ou comprovante) é desenhado em um canvas e embutido
 * no PDF como uma imagem JPEG — uma página por imagem. Isso dispensa fontes,
 * codificação de texto e bibliotecas de terceiros, e imprime nítido porque o
 * canvas é renderizado em alta resolução.
 */

const MM_PT = 72 / 25.4;

export const mmParaPt = (mm) => mm * MM_PT;

function latin1(texto) {
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i += 1) bytes[i] = texto.charCodeAt(i) & 0xff;
  return bytes;
}

function numero(valor) {
  return Number(Number(valor).toFixed(2));
}

/** Lê largura, altura e número de componentes direto do cabeçalho JPEG. */
function lerDimensoesJpeg(bytes) {
  let i = 2;
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marcador = bytes[i + 1];
    if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) {
      i += 2;
      continue;
    }
    const tamanho = (bytes[i + 2] << 8) | bytes[i + 3];
    const ehSOF =
      (marcador >= 0xc0 && marcador <= 0xc3) ||
      (marcador >= 0xc5 && marcador <= 0xc7) ||
      (marcador >= 0xc9 && marcador <= 0xcb) ||
      (marcador >= 0xcd && marcador <= 0xcf);
    if (ehSOF) {
      return {
        altura: (bytes[i + 5] << 8) | bytes[i + 6],
        largura: (bytes[i + 7] << 8) | bytes[i + 8],
      };
    }
    i += 2 + tamanho;
  }
  throw new Error('JPEG inválido: não foi possível ler as dimensões da imagem.');
}

/**
 * Monta o PDF a partir de uma lista de páginas.
 * @param {{ jpeg: Uint8Array, larguraPt?: number, alturaPt?: number }[]} paginas
 * @returns {Uint8Array}
 */
export function montarPdf(paginas) {
  if (!Array.isArray(paginas) || !paginas.length) {
    throw new Error('Nenhuma página foi informada para gerar o PDF.');
  }

  const objetos = [];
  objetos[1] = { dict: '<< /Type /Catalog /Pages 2 0 R >>', stream: null };

  const defs = paginas.map((pagina, indice) => {
    const base = 3 + indice * 3;
    return { ...pagina, numPagina: base, numImagem: base + 1, numConteudo: base + 2 };
  });

  objetos[2] = {
    dict: `<< /Type /Pages /Kids [${defs.map((p) => `${p.numPagina} 0 R`).join(' ')}] /Count ${defs.length} >>`,
    stream: null,
  };

  for (const def of defs) {
    const dimensoes = lerDimensoesJpeg(def.jpeg);
    const largura = def.larguraPt ?? dimensoes.largura;
    const altura = def.alturaPt ?? dimensoes.altura;

    objetos[def.numImagem] = {
      dict:
        '<< /Type /XObject /Subtype /Image ' +
        `/Width ${dimensoes.largura} /Height ${dimensoes.altura} ` +
        '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ' +
        `/Length ${def.jpeg.length} >>`,
      stream: def.jpeg,
    };

    const conteudo = latin1(`q\n${numero(largura)} 0 0 ${numero(altura)} 0 0 cm\n/Im${def.numImagem} Do\nQ\n`);
    objetos[def.numConteudo] = { dict: `<< /Length ${conteudo.length} >>`, stream: conteudo };
    objetos[def.numPagina] = {
      dict:
        '<< /Type /Page /Parent 2 0 R ' +
        `/MediaBox [0 0 ${numero(largura)} ${numero(altura)}] ` +
        `/Resources << /XObject << /Im${def.numImagem} ${def.numImagem} 0 R >> >> ` +
        `/Contents ${def.numConteudo} 0 R >>`,
      stream: null,
    };
  }

  const partes = [];
  let deslocamento = 0;
  const escrever = (bytes) => {
    partes.push(bytes);
    deslocamento += bytes.length;
  };
  const escreverTexto = (texto) => escrever(latin1(texto));

  escreverTexto('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');

  const offsets = [];
  for (let n = 1; n < objetos.length; n += 1) {
    const objeto = objetos[n];
    offsets[n] = deslocamento;
    escreverTexto(`${n} 0 obj\n${objeto.dict}\n`);
    if (objeto.stream) {
      escreverTexto('stream\n');
      escrever(objeto.stream);
      escreverTexto('\nendstream\n');
    }
    escreverTexto('endobj\n');
  }

  const inicioXref = deslocamento;
  let xref = `xref\n0 ${objetos.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objetos.length; n += 1) {
    xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  }
  escreverTexto(xref);
  escreverTexto(`trailer\n<< /Size ${objetos.length} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);

  const saida = new Uint8Array(deslocamento);
  let posicao = 0;
  for (const parte of partes) {
    saida.set(parte, posicao);
    posicao += parte.length;
  }
  return saida;
}

/** Converte um canvas em bytes JPEG (qualidade alta para impressão). */
export function canvasParaJpeg(canvas, qualidade = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error('Não foi possível gerar a imagem do documento.'));
          return;
        }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      'image/jpeg',
      qualidade,
    );
  });
}

/** Dispara o download do PDF no navegador. */
export function baixarPdf(nomeArquivo, bytes) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 6000);
}
