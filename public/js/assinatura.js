import { h } from './dom.js';
import { icone } from './icons.js';

/**
 * Tela de assinatura (pointer events) que funciona com dedo, caneta e mouse.
 * Devolve um objeto com `obterBlob()` e `estaVazio()`.
 */
export function criarAssinatura({ altura = 190, rotulo = 'Assine com o dedo na área acima' } = {}) {
  const canvas = h('canvas', { 'aria-label': 'Área de assinatura' });
  const legenda = h('div.assinatura__legenda', {}, rotulo);
  const botoes = h(
    'div.linha.assinatura__acoes',
    { style: { padding: '8px 10px' } },
    h(
      'button.btn.btn--pequeno.btn--fantasma',
      { type: 'button', onclick: () => limparTudo() },
      icone('recarregar', { tamanho: 14 }),
      'Limpar assinatura',
    ),
  );

  const envoltorio = h('div.assinatura', {}, canvas, legenda, botoes);

  const ctx = canvas.getContext('2d');
  let desenhando = false;
  let temTraco = false;
  let ultimo = null;

  function ajustarTamanho() {
    const proporcao = window.devicePixelRatio || 1;
    const larguraCss = envoltorio.clientWidth || canvas.clientWidth || 320;
    canvas.width = Math.round(larguraCss * proporcao);
    canvas.height = Math.round(altura * proporcao);
    canvas.style.height = `${altura}px`;
    ctx.setTransform(proporcao, 0, 0, proporcao, 0, 0);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffffff';
  }

  function posicao(evento) {
    const caixa = canvas.getBoundingClientRect();
    return { x: evento.clientX - caixa.left, y: evento.clientY - caixa.top };
  }

  function iniciar(evento) {
    evento.preventDefault();
    canvas.setPointerCapture?.(evento.pointerId);
    desenhando = true;
    ultimo = posicao(evento);
  }

  function mover(evento) {
    if (!desenhando) return;
    evento.preventDefault();
    const ponto = posicao(evento);
    ctx.beginPath();
    ctx.moveTo(ultimo.x, ultimo.y);
    ctx.lineTo(ponto.x, ponto.y);
    ctx.stroke();
    ultimo = ponto;
    if (!temTraco) {
      temTraco = true;
      legenda.style.opacity = '0';
    }
  }

  function terminar(evento) {
    desenhando = false;
    try {
      canvas.releasePointerCapture?.(evento.pointerId);
    } catch {
      /* captura já liberada */
    }
  }

  canvas.addEventListener('pointerdown', iniciar);
  canvas.addEventListener('pointermove', mover);
  canvas.addEventListener('pointerup', terminar);
  canvas.addEventListener('pointercancel', terminar);
  canvas.addEventListener('pointerleave', terminar);

  function limparTudo() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    temTraco = false;
    legenda.style.opacity = '1';
  }

  const observador = new ResizeObserver(() => {
    const anterior = temTraco ? canvas.toDataURL() : null;
    ajustarTamanho();
    if (anterior) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.clientWidth, altura);
      img.src = anterior;
    }
  });

  requestAnimationFrame(() => {
    ajustarTamanho();
    observador.observe(envoltorio);
  });

  return {
    elemento: envoltorio,
    canvas,
    estaVazio: () => !temTraco,
    limpar: limparTudo,
    destruir: () => observador.disconnect(),
    ajustarTamanho,
  };
}
