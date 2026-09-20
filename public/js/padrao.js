import { h } from './dom.js';
import { icone } from './icons.js';

/**
 * Padrão de desbloqueio (3x3). O usuário desenha ligando os pontos e o sistema
 * registra a ORDEM — ex.: "1-2-5-8". Também gera uma prévia visual do desenho
 * para o técnico reproduzir o padrão sem precisar contar os pontos.
 */

const MARGEM = 0.14;

function pontosDe(lado) {
  const margem = lado * MARGEM;
  const passo = (lado - margem * 2) / 2;
  const lista = [];
  for (let linha = 0; linha < 3; linha += 1) {
    for (let coluna = 0; coluna < 3; coluna += 1) {
      lista.push({ n: linha * 3 + coluna + 1, x: margem + coluna * passo, y: margem + linha * passo });
    }
  }
  return lista;
}

function desenhar(ctx, lado, ordem, { interativo = false, destacar = null } = {}) {
  ctx.clearRect(0, 0, lado, lado);
  const pts = pontosDe(lado);
  const raio = lado * (interativo ? 0.045 : 0.055);

  // linhas do traço
  if (ordem.length > 1) {
    ctx.lineWidth = lado * 0.022;
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
    const ativo = destacar === p.n && !marcado;
    ctx.beginPath();
    ctx.arc(p.x, p.y, marcado ? raio * 1.35 : raio, 0, Math.PI * 2);
    ctx.fillStyle = marcado ? '#4f46e5' : ativo ? '#c7d2fe' : '#e2e6f3';
    ctx.fill();
    ctx.lineWidth = Math.max(1, lado * 0.008);
    ctx.strokeStyle = marcado ? '#4338ca' : '#b9c1d8';
    ctx.stroke();

    if (marcado) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(lado * 0.05)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(ordem.indexOf(p.n) + 1), p.x, p.y);
    }
  }
}

/** Prévia estática (canvas) de um padrão já salvo — usada no detalhe da OS. */
export function previewPadrao(valor, { tamanho = 132 } = {}) {
  const ordem = String(valor ?? '')
    .split('-')
    .map((n) => Number(n))
    .filter((n) => n >= 1 && n <= 9);
  const proporcao = window.devicePixelRatio || 1;
  const canvas = h('canvas.padrao-preview', { 'aria-label': `Padrão ${ordem.join(' ')}` });
  canvas.width = Math.round(tamanho * proporcao);
  canvas.height = Math.round(tamanho * proporcao);
  canvas.style.width = `${tamanho}px`;
  canvas.style.height = `${tamanho}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(proporcao, 0, 0, proporcao, 0, 0);
  desenhar(ctx, tamanho, ordem);
  return canvas;
}

export function criarPadrao({ onChange, minimo = 4 } = {}) {
  const canvas = h('canvas', { 'aria-label': 'Desenho do padrão de desbloqueio' });
  const legenda = h('div.padrao__legenda', {}, `Toque e arraste ligando os pontos (mínimo ${minimo}).`);
  const sequencia = h('div.padrao__sequencia');
  const botaoDesfazer = h('button.btn.btn--fantasma.btn--pequeno', { type: 'button' }, icone('voltar', { tamanho: 14 }), 'Desfazer');
  const botaoLimpar = h('button.btn.btn--fantasma.btn--pequeno', { type: 'button' }, icone('recarregar', { tamanho: 14 }), 'Limpar');
  const acoes = h('div.padrao__acoes', {}, botaoDesfazer, botaoLimpar);
  const envoltorio = h('div.padrao', {}, canvas, legenda, sequencia, acoes);

  let ordem = [];
  let desenhando = false;
  let lado = 280;
  let ultimoPerto = null;

  function dimensionar() {
    const proporcao = window.devicePixelRatio || 1;
    lado = Math.max(210, Math.min(300, envoltorio.clientWidth || 260));
    canvas.width = Math.round(lado * proporcao);
    canvas.height = Math.round(lado * proporcao);
    canvas.style.width = `${lado}px`;
    canvas.style.height = `${lado}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(proporcao, 0, 0, proporcao, 0, 0);
    desenhar(ctx, lado, ordem, { interativo: true, destacar: ultimoPerto });
  }

  function atualizar() {
    const texto = ordem.length ? ordem.join(' → ') : '—';
    sequencia.textContent = `Ordem: ${texto}`;
    const pronto = ordem.length >= minimo;
    sequencia.classList.toggle('padrao__sequencia--curta', ordem.length > 0 && !pronto);
    botaoDesfazer.disabled = ordem.length === 0;
    botaoLimpar.disabled = ordem.length === 0;
    onChange?.(ordem.join('-'), { pronto });
  }

  function pontoProximo(evento) {
    const caixa = canvas.getBoundingClientRect();
    const x = evento.clientX - caixa.left;
    const y = evento.clientY - caixa.top;
    const limite = lado * 0.12;
    return pontosDe(lado).find((p) => Math.hypot(p.x - x, p.y - y) <= limite) ?? null;
  }

  function adicionar(evento) {
    const ponto = pontoProximo(evento);
    ultimoPerto = ponto ? ponto.n : null;
    if (!ponto || ordem.includes(ponto.n)) {
      desenhar(canvas.getContext('2d'), lado, ordem, { interativo: true, destacar: ultimoPerto });
      return;
    }
    ordem.push(ponto.n);
    desenhar(canvas.getContext('2d'), lado, ordem, { interativo: true, destacar: ultimoPerto });
    atualizar();
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

  botaoDesfazer.addEventListener('click', () => {
    ordem.pop();
    desenhar(canvas.getContext('2d'), lado, ordem, { interativo: true });
    atualizar();
  });
  botaoLimpar.addEventListener('click', () => {
    ordem = [];
    desenhar(canvas.getContext('2d'), lado, ordem, { interativo: true });
    atualizar();
  });
  canvas.addEventListener('pointerdown', iniciar);
  canvas.addEventListener('pointermove', mover);
  canvas.addEventListener('pointerup', terminar);
  canvas.addEventListener('pointercancel', terminar);
  canvas.addEventListener('pointerleave', () => {
    terminar();
    ultimoPerto = null;
  });
  window.addEventListener('resize', dimensionar);
  setTimeout(() => {
    dimensionar();
    atualizar();
  }, 40);

  return {
    elemento: envoltorio,
    valor: () => ordem.join('-'),
    pontos: () => ordem.length,
    estaVazio: () => ordem.length === 0,
    ajustar: dimensionar,
    limpar: () => {
      ordem = [];
      desenhar(canvas.getContext('2d'), lado, ordem, { interativo: true });
      atualizar();
    },
  };
}
