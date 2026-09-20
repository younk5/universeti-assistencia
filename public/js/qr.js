/**
 * Geração de QR Code sem dependências externas.
 *
 * A biblioteca `public/js/vendor/qrcode.js` (qrcode-generator, MIT, Kazuhiko
 * Arase) é carregada como script clássico no index.html e expõe `window.qrcode`.
 * Aqui só embrulhamos numa API pequena e segura para o resto da aplicação.
 */

function biblioteca() {
  const lib = globalThis.qrcode;
  if (typeof lib !== 'function') {
    throw new Error('Gerador de QR Code não disponível.');
  }
  return lib;
}

export function qrDataUrl(texto, { cellSize = 4, margin = 2, nivel = 'M' } = {}) {
  const lib = biblioteca();
  const qr = lib(0, nivel);
  qr.addData(String(texto));
  qr.make();
  return qr.createDataURL(cellSize, margin);
}

/**
 * Cria um elemento <img> com o QR do texto informado.
 * Nunca lança: se o gerador não estiver disponível, devolve `null` (o `h()`
 * simplesmente ignora valores nulos).
 * @returns {HTMLImageElement|null}
 */
export function qrImagem(texto, { tamanho = 160, alt = 'QR Code', className = 'qr' } = {}) {
  try {
    const cellSize = Math.max(2, Math.round(tamanho / 33));
    const img = document.createElement('img');
    img.src = qrDataUrl(texto, { cellSize, margin: 2 });
    img.alt = alt;
    img.width = tamanho;
    img.height = tamanho;
    img.className = className;
    img.loading = 'lazy';
    return img;
  } catch (erro) {
    console.warn('[qr] não foi possível gerar o QR Code', erro);
    return null;
  }
}
