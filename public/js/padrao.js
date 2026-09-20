import { h } from './dom.js';
import { icone } from './icons.js';

/**
 * Área para desenhar o padrão (3x3) do aparelho. Registra a ORDEM dos pontos
 * ligados — ex.: "1-2-5-8" — para o técnico saber exatamente a senha desenhada.
 *
 * Devolve `{ elemento, valor(), estaVazio(), limpar() }`.
 */
export function criarPadrao({ onChange } = {}) {
  const canvas = h('canvas', { 'aria-label': 'Desenho do padrão de desbloqueio' });
  const legenda = h('div.padrao__legenda', {}, 'Toque e arraste ligando os pontos na ordem da senha.');
  const sequencia = h('div.padrao__sequencia', {}, 'Ordem: —');
  const botaoLimpar = h('button.btn.btn--fantasma.btn--pequeno', { type: 'button' }, icone('recarregar', { tamanho: 14 }), 'Limpar');
  const envoltorio = h('div.padrao', {}, canvas, legenda, sequencia, botaoLimpar);

  let ordem = [];
  let desenhando = false;
  let lado = 260;

  function pontos() {
    const margem = 36;
    const passo = (lado - margem * 2) / 2;
    const lista = [];
    for (let linha = 0; linha < 3; linha += 1) {
      for (let coluna = 0; coluna < 3; coluna += 1) {
        lista.push({ n: linha * 3 + coluna + 1, x: margem + coluna * passo, y: margem + linha * passo });
      }
    }
    return lista;
  }

  function dimensionar() {
    const proporcao = window.devicePixelRatio || 1;
    lado = Math.max(200, Math.min(280, envoltorio.clientWidth || 260));
    canvas.width = Math.round(lado * proporcao);
    canvas.height = Math.round(lado * proporcao);
    canvas.style.width = `${lado}px`;
    canvas.style.height = `${lado}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(proporcao, 0, 0, proporcao, 0, 0);
    desenhar();
  }

  function desenhar() {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, lado, lado);
    const pts = pontos();

    if (ordem.length > 1) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#4f46e5';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ordem.forEach((n, i) => {
        const p = pts[n - 1];
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }

    for (const p of pts) {
      const marcado = ordem.includes(p.n);
      ctx.beginPath();
      ctx.arc(p.x, p.y, marcado ? 13 : 10, 0, Math.PI * 2);
      ctx.fillStyle = marcado ? '#4f46e5' : '#c7d2fe';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#4338ca';
      ctx.stroke();
      if (marcado) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(ordem.indexOf(p.n) + 1), p.x, p.y);
      }
    }
  }

  function pontoProximo(evento) {
    const caixa = canvas.getBoundingClientRect();
    const x = evento.clientX - caixa.left;
    const y = evento.clientY - caixa.top;
    return pontos().find((p) => Math.hypot(p.x - x, p.y - y) <= 28) ?? null;
  }

  function adicionar(evento) {
    const ponto = pontoProximo(evento);
    if (!ponto || ordem.includes(ponto.n)) return;
    ordem.push(ponto.n);
    desenhar();
    atualizar();
  }

  function atualizar() {
    sequencia.textContent = ordem.length ? `Ordem: ${ordem.join(' → ')}` : 'Ordem: —';
    onChange?.(ordem.join('-'));
  }

  const iniciar = (evento) => {
    evento.preventDefault();
    desenhando = true;
    ordem = [];
    adicionar(evento);
  };
  const mover = (evento) => {
    if (!desenhando) return;
    evento.preventDefault();
    adicionar(evento);
  };
  const terminar = () => {
    desenhando = false;
  };

  botaoLimpar.addEventListener('click', () => {
    ordem = [];
    desenhar();
    atualizar();
  });
  canvas.addEventListener('pointerdown', iniciar);
  canvas.addEventListener('pointermove', mover);
  canvas.addEventListener('pointerup', terminar);
  canvas.addEventListener('pointercancel', terminar);
  canvas.addEventListener('pointerleave', terminar);
  window.addEventListener('resize', dimensionar);
  setTimeout(dimensionar, 40);

  return {
    elemento: envoltorio,
    valor: () => ordem.join('-'),
    estaVazio: () => ordem.length === 0,
    ajustar: dimensionar,
    limpar: () => {
      ordem = [];
      desenhar();
      atualizar();
    },
  };
}
