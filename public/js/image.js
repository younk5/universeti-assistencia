/**
 * Compressão de imagem no cliente. Fotos de celular moderno passam de 4 MB;
 * reduzir aqui evita uploads pesados no 4G do balcão.
 */

const LIMITE_PADRAO = 900 * 1024;

export class ErroImagem extends Error {
  constructor(mensagem, codigo = 'imagem_invalida') {
    super(mensagem);
    this.name = 'ErroImagem';
    this.codigo = codigo;
  }
}

function carregarBitmap(arquivo) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const imagem = new Image();
    imagem.onload = () => {
      URL.revokeObjectURL(url);
      resolve(imagem);
    };
    imagem.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new ErroImagem(
          'Não foi possível ler esta imagem. Se for um arquivo HEIC do iPhone, ajuste o celular para "Mais compatível" em Ajustes › Câmera › Formatos, ou escolha a foto pela galeria em JPEG.',
          'formato_nao_suportado',
        ),
      );
    };
    imagem.decoding = 'async';
    imagem.src = url;
  });
}

function paraBlob(canvas, qualidade) {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', qualidade));
}

/**
 * Redimensiona para no máximo `maxLado` px e recomprime em JPEG.
 * A qualidade cai progressivamente até caber em `maxBytes`.
 */
export async function comprimirImagem(arquivo, { maxLado = 1600, maxBytes = LIMITE_PADRAO } = {}) {
  if (!arquivo.type.startsWith('image/')) {
    throw new ErroImagem('O arquivo selecionado não é uma imagem.', 'nao_e_imagem');
  }

  const imagem = await carregarBitmap(arquivo);
  const larguraOriginal = imagem.naturalWidth || imagem.width;
  const alturaOriginal = imagem.naturalHeight || imagem.height;
  if (!larguraOriginal || !alturaOriginal) {
    throw new ErroImagem('A imagem está corrompida ou vazia.', 'imagem_vazia');
  }

  const escala = Math.min(1, maxLado / Math.max(larguraOriginal, alturaOriginal));
  const largura = Math.max(1, Math.round(larguraOriginal * escala));
  const altura = Math.max(1, Math.round(alturaOriginal * escala));

  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  const contexto = canvas.getContext('2d', { alpha: false });
  contexto.imageSmoothingEnabled = true;
  contexto.imageSmoothingQuality = 'high';
  contexto.fillStyle = '#ffffff';
  contexto.fillRect(0, 0, largura, altura);
  contexto.drawImage(imagem, 0, 0, largura, altura);

  let qualidade = 0.74;
  let blob = await paraBlob(canvas, qualidade);
  while (blob && blob.size > maxBytes && qualidade > 0.34) {
    qualidade -= 0.1;
    blob = await paraBlob(canvas, qualidade);
  }

  if (!blob) throw new ErroImagem('Falha ao processar a imagem neste navegador.', 'falha_processamento');

  return {
    blob,
    largura,
    altura,
    larguraOriginal,
    alturaOriginal,
    bytes: blob.size,
    bytesOriginais: arquivo.size,
    qualidade: Math.round(qualidade * 100),
    percentual: arquivo.size ? Math.max(0, Math.round((1 - blob.size / arquivo.size) * 100)) : 0,
  };
}

export function blobParaUrl(blob) {
  return URL.createObjectURL(blob);
}

/** Converte o canvas de assinatura em PNG recortado no traço. */
export function recortarAssinatura(canvas, margem = 12) {
  const contexto = canvas.getContext('2d');
  const { width, height } = canvas;
  const dados = contexto.getImageData(0, 0, width, height).data;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (dados[(y * width + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;

  minX = Math.max(0, minX - margem);
  minY = Math.max(0, minY - margem);
  maxX = Math.min(width - 1, maxX + margem);
  maxY = Math.min(height - 1, maxY + margem);

  const largura = maxX - minX + 1;
  const altura = maxY - minY + 1;

  const saida = document.createElement('canvas');
  const escala = Math.min(2, 900 / Math.max(largura, 1));
  saida.width = Math.round(largura * escala);
  saida.height = Math.round(altura * escala);
  const ctxSaida = saida.getContext('2d');
  ctxSaida.fillStyle = '#14182b';
  ctxSaida.fillRect(0, 0, saida.width, saida.height);
  ctxSaida.drawImage(canvas, minX, minY, largura, altura, 0, 0, saida.width, saida.height);

  return new Promise((resolve) => {
    saida.toBlob((blob) => resolve(blob), 'image/png');
  });
}

export function formatarBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
