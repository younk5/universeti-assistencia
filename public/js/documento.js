/**
 * Motor de layout para documentos em canvas (etiqueta e comprovante).
 *
 * Tudo é medido em milímetros; a renderização usa `escala` pixels por mm
 * (o padrão ~200 dpi dá uma impressão nítida). As funções devolvem o "y"
 * seguinte para facilitar o fluxo de cima para baixo.
 */
import { largurasCode128B } from './barcode.js';

const FAMILIA = '"Segoe UI", Roboto, Arial, Helvetica, sans-serif';
const FAMILIA_MONO = '"Cascadia Mono", Consolas, "SFMono-Regular", Menlo, monospace';

export function criarDocumento({ larguraMm, alturaMm, escala = 8, fundo = '#ffffff' }) {
  const px = (mm) => Math.round(mm * escala * 1000) / 1000;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(larguraMm * escala);
  canvas.height = Math.round(alturaMm * escala);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = fundo;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'top';

  function aplicarFonte(tamanho, peso, mono) {
    ctx.font = `${peso} ${Math.round(tamanho * escala * 10) / 10}px ${mono ? FAMILIA_MONO : FAMILIA}`;
  }

  function quebrar(texto, larguraMm) {
    const limite = larguraMm * escala;
    const saida = [];
    for (const paragrafo of String(texto ?? '').split('\n')) {
      const palavras = paragrafo.split(/\s+/).filter(Boolean);
      if (!palavras.length) {
        saida.push('');
        continue;
      }
      let atual = '';
      for (const palavra of palavras) {
        const teste = atual ? `${atual} ${palavra}` : palavra;
        if (ctx.measureText(teste).width <= limite || !atual) atual = teste;
        else {
          saida.push(atual);
          atual = palavra;
        }
      }
      if (atual) saida.push(atual);
    }
    return saida;
  }

  return {
    canvas,
    ctx,
    larguraMm,
    alturaMm,
    escala,

    texto(x, y, valor, { tamanho = 3, peso = 400, cor = '#14182b', largura = null, alinhamento = 'left', mono = false, linhasMax = null } = {}) {
      aplicarFonte(tamanho, peso, mono);
      ctx.fillStyle = cor;
      let linhas = largura ? quebrar(valor, largura) : String(valor ?? '').split('\n');
      if (linhasMax && linhas.length > linhasMax) {
        linhas = linhas.slice(0, linhasMax);
        linhas[linhasMax - 1] = `${linhas[linhasMax - 1].replace(/\s+\S*$/, '')}…`;
      }
      const entrelinha = tamanho * 1.4;
      let atual = y;
      for (const linha of linhas) {
        const larguraLinha = ctx.measureText(linha).width / escala;
        let xDesenho = x;
        if (alinhamento === 'right') xDesenho = x - larguraLinha;
        else if (alinhamento === 'center') xDesenho = x - larguraLinha / 2;
        ctx.fillText(linha, px(xDesenho), px(atual));
        atual += entrelinha;
      }
      return atual;
    },

    larguraTexto(valor, { tamanho = 3, peso = 400, mono = false } = {}) {
      aplicarFonte(tamanho, peso, mono);
      return ctx.measureText(String(valor ?? '')).width / escala;
    },

    alturaTexto(valor, { tamanho = 3, peso = 400, largura = null, mono = false } = {}) {
      aplicarFonte(tamanho, peso, mono);
      const linhas = largura ? quebrar(valor, largura) : String(valor ?? '').split('\n');
      return linhas.length * tamanho * 1.4;
    },

    linha(x1, y1, x2, y2, { cor = '#14182b', espessura = 0.3, tracejada = false } = {}) {      ctx.save();
      ctx.strokeStyle = cor;
      ctx.lineWidth = Math.max(1, espessura * escala);
      if (tracejada) ctx.setLineDash([2 * escala, 1.5 * escala]);
      ctx.beginPath();
      ctx.moveTo(px(x1), px(y1));
      ctx.lineTo(px(x2), px(y2));
      ctx.stroke();
      ctx.restore();
    },

    retangulo(x, y, largura, altura, { cor = '#14182b', raio = 0 } = {}) {
      ctx.fillStyle = cor;
      if (!raio) {
        ctx.fillRect(px(x), px(y), px(largura), px(altura));
        return;
      }
      const r = raio * escala;
      ctx.beginPath();
      ctx.moveTo(px(x) + r, px(y));
      ctx.arcTo(px(x + largura), px(y), px(x + largura), px(y + altura), r);
      ctx.arcTo(px(x + largura), px(y + altura), px(x), px(y + altura), r);
      ctx.arcTo(px(x), px(y + altura), px(x), px(y), r);
      ctx.arcTo(px(x), px(y), px(x + largura), px(y), r);
      ctx.closePath();
      ctx.fill();
    },

    imagem(img, x, y, largura, altura) {
      ctx.drawImage(img, px(x), px(y), px(largura), px(altura));
    },

    imagemContida(img, x, y, largura, altura, { fundo = null } = {}) {
      if (fundo) {
        ctx.fillStyle = fundo;
        ctx.fillRect(px(x), px(y), px(largura), px(altura));
      }
      const proporcao = (img.width || 1) / (img.height || 1);
      let w = largura;
      let h = largura / proporcao;
      if (h > altura) {
        h = altura;
        w = altura * proporcao;
      }
      const xc = x + (largura - w) / 2;
      const yc = y + (altura - h) / 2;
      ctx.drawImage(img, px(xc), px(yc), px(w), px(h));
      return { x: xc, y: yc, largura: w, altura: h };
    },

    codigoBarras(texto, x, y, largura, altura, { cor = '#000000' } = {}) {
      const modulos = largurasCode128B(texto);
      if (!modulos.length) return;
      const total = modulos.reduce((soma, modulo) => soma + modulo, 0);
      const passo = (largura * escala) / total;
      const yPx = px(y);
      const alturaPx = px(altura);
      let posicao = px(x);
      let barra = true;
      ctx.fillStyle = cor;
      for (const modulo of modulos) {
        const w = modulo * passo;
        if (barra) ctx.fillRect(posicao, yPx, Math.ceil(w), alturaPx);
        posicao += w;
        barra = !barra;
      }
    },
  };
}

/** Carrega uma imagem (usada para fotos e assinatura no comprovante). */
export function carregarImagem(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível carregar uma imagem do anexo.'));
    img.src = url;
  });
}
