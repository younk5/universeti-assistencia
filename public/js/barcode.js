/**
 * Code 128B — codificador mínimo para a etiqueta da OS.
 * Cada caractere vira uma sequência de larguras (barra, espaço, barra, ...).
 */
const PADROES = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const INICIO_B = 104;
const PARADA = 106;

/** @returns {number[]} larguras dos módulos, alternando barra/espaço a partir de barra. */
export function largurasCode128B(texto) {
  const limpo = String(texto ?? '')
    .split('')
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 127)
    .join('');
  if (!limpo) return [];

  const valores = [INICIO_B, ...limpo.split('').map((c) => c.charCodeAt(0) - 32)];
  let soma = valores[0];
  for (let i = 1; i < valores.length; i += 1) soma += valores[i] * i;
  valores.push(soma % 103);
  valores.push(PARADA);

  const larguras = [];
  for (const valor of valores) {
    for (const digito of PADROES[valor]) larguras.push(Number(digito));
  }
  return larguras;
}

/**
 * Desenha o código de barras em um canvas (retorna o canvas pronto para uso).
 */
export function desenharCode128(texto, { larguraModulo = 1.6, altura = 44, cor = '#000000' } = {}) {
  const larguras = largurasCode128B(texto);
  const canvas = document.createElement('canvas');
  if (!larguras.length) return canvas;

  const margem = 8;
  const larguraTotal = larguras.reduce((a, b) => a + b, 0) * larguraModulo + margem * 2;
  const proporcao = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(larguraTotal * proporcao);
  canvas.height = Math.round((altura + 8) * proporcao);
  canvas.style.width = `${larguraTotal}px`;
  canvas.style.height = `${altura + 8}px`;

  const ctx = canvas.getContext('2d');
  ctx.scale(proporcao, proporcao);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, larguraTotal, altura + 8);
  ctx.fillStyle = cor;

  let x = margem;
  let barra = true;
  for (const largura of larguras) {
    const larguraPx = largura * larguraModulo;
    if (barra) ctx.fillRect(x, 4, larguraPx, altura);
    x += larguraPx;
    barra = !barra;
  }
  return canvas;
}
