import { criarDocumento, carregarImagem } from './documento.js';
import { montarPdf, canvasParaJpeg, baixarPdf, mmParaPt } from './pdf.js';
import { dataHora, telefone, moeda } from './format.js';
import { ROTULOS_STATUS, ROTULOS_TIPO_FOTO, ROTULOS_TIPO_EVENTO } from './constantes.js';
import { qrDataUrl } from './qr.js';

const MARCA = 'UniverseTI Assistência';
const MARCA_SUB = 'Assistência técnica de celulares';

const ROTULOS_PAGAMENTO = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  credito: 'Cartão de crédito',
  debito: 'Cartão de débito',
  outro: 'Outro',
};

const ETIQUETA = { largura: 100, altura: 70 };

/* -------------------------------------------------------------------------- */
/* Etiqueta                                                                    */
/* -------------------------------------------------------------------------- */

function desenharEtiqueta(ordem) {
  const L = ETIQUETA.largura;
  const A = ETIQUETA.altura;
  const M = 4;
  const doc = criarDocumento({ larguraMm: L, alturaMm: A, escala: 8 });

  doc.texto(M, M, MARCA, { tamanho: 3.3, peso: 800 });
  doc.texto(L - M, M + 0.5, `${ordem.loja_codigo ?? ''} · ${ordem.loja_nome ?? ''}`.replace(/^ · /, ''), {
    tamanho: 2.4,
    peso: 700,
    cor: '#4f46e5',
    alinhamento: 'right',
  });
  doc.linha(M, M + 4.6, L - M, M + 4.6, { espessura: 0.5 });

  doc.texto(M, M + 6, ordem.numero_os, { tamanho: 7.6, peso: 800, mono: true });
  doc.texto(L - M, M + 8.6, `Entrada ${dataHora(ordem.criado_em)}`, {
    tamanho: 2.4,
    cor: '#6b7186',
    alinhamento: 'right',
  });

  let y = M + 16.5;
  const campo = (rotulo, valor, tamanho, peso, linhasMax = 1) => {
    const prefixo = `${rotulo} `;
    const larguraPrefixo = doc.larguraTexto(prefixo, { tamanho, peso: 700 });
    doc.texto(M, y, prefixo, { tamanho, peso: 700, cor: '#6b7186' });
    y = doc.texto(M + larguraPrefixo, y, valor, {
      tamanho,
      peso,
      largura: L - M * 2 - larguraPrefixo,
      linhasMax,
    });
    y += 1;
  };

  campo('Cliente:', ordem.cliente_nome, 3.4, 700, 1);
  campo(
    'Aparelho:',
    `${ordem.tipo_aparelho ?? 'Celular'} ${ordem.marca} ${ordem.modelo}${ordem.cor ? ` · ${ordem.cor}` : ''}`,
    2.9,
    500,
    2,
  );
  campo('Contato:', telefone(ordem.cliente_telefone), 2.9, 500, 1);
  if (ordem.acessorios) campo('Acessórios:', ordem.acessorios, 2.6, 500, 1);
  campo('Defeito:', String(ordem.defeito_relatado ?? ''), 2.6, 500, 3);

  const baseBarra = A - M - 12.5;
  doc.codigoBarras(ordem.numero_os, M, baseBarra, 56, 11);
  doc.texto(L - M, baseBarra + 1, 'Guarde este comprovante.', { tamanho: 2.2, cor: '#6b7186', alinhamento: 'right' });
  doc.texto(L - M, baseBarra + 4.4, 'Apresente no momento da', { tamanho: 2.2, cor: '#6b7186', alinhamento: 'right' });
  doc.texto(L - M, baseBarra + 7.8, 'retirada do aparelho.', { tamanho: 2.2, cor: '#6b7186', alinhamento: 'right' });

  return doc.canvas;
}

export async function baixarEtiquetaPdf(ordem, { copias = 1 } = {}) {
  const total = Math.max(1, Math.min(20, Number(copias) || 1));
  const canvases = Array.from({ length: total }, () => desenharEtiqueta(ordem));
  const jpegs = await Promise.all(canvases.map((canvas) => canvasParaJpeg(canvas, 0.95)));
  const paginas = jpegs.map((jpeg) => ({ jpeg, larguraPt: mmParaPt(ETIQUETA.largura), alturaPt: mmParaPt(ETIQUETA.altura) }));
  baixarPdf(`etiqueta-${ordem.numero_os}.pdf`, montarPdf(paginas));
}

/* -------------------------------------------------------------------------- */
/* Comprovante                                                                 */
/* -------------------------------------------------------------------------- */

export async function baixarComprovantePdf(ordem, eventos = [], fotos = []) {
  const outrasFotos = fotos.filter((f) => f.tipo !== 'assinatura');
  const assinatura = fotos.find((f) => f.tipo === 'assinatura');

  const imagens = {};
  await Promise.all(
    fotos.map((foto) =>
      carregarImagem(`/api/fotos/${foto.id}/raw`)
        .then((img) => {
          imagens[foto.id] = img;
        })
        .catch(() => {
          imagens[foto.id] = null;
        }),
    ),
  );

  let qrRastreio = null;
  try {
    const digitos = String(ordem.cliente_telefone ?? '').replace(/\D/g, '').slice(-4);
    const linkRastreio = `${window.location.origin}/#/rastreio/${encodeURIComponent(ordem.numero_os)}?tel=${digitos}`;
    qrRastreio = await carregarImagem(qrDataUrl(linkRastreio, { cellSize: 6, margin: 1 })).then((img) => ({ img, link: linkRastreio }));
  } catch {
    qrRastreio = null;
  }

  const PAGINA = { largura: 210, altura: 297 };
  const M = 14;
  const LIMITE = PAGINA.altura - 18;

  const paginas = [];
  let doc = null;
  let y = 0;

  const novaPagina = () => {
    doc = criarDocumento({ larguraMm: PAGINA.largura, alturaMm: PAGINA.altura, escala: 9 });
    paginas.push(doc);
    y = M;
  };

  const garantir = (altura) => {
    if (y + altura <= LIMITE) return;
    novaPagina();
    doc.texto(M, M, `${MARCA} — ${ordem.numero_os} (continuação)`, { tamanho: 2.6, peso: 700, cor: '#6b7186' });
    y = M + 9;
  };

  const cabecalho = () => {
    doc.retangulo(M, M, 13, 13, { cor: '#14182b', raio: 3.5 });
    doc.texto(M + 6.5, M + 3.2, 'UT', { tamanho: 4.6, peso: 800, cor: '#ffffff', alinhamento: 'center', mono: true });
    doc.texto(M + 16, M + 0.6, MARCA, { tamanho: 4.8, peso: 800 });
    doc.texto(M + 16, M + 6.6, MARCA_SUB, { tamanho: 2.4, cor: '#6b7186' });

    doc.texto(PAGINA.largura - M, M, ordem.numero_os, { tamanho: 5.2, peso: 800, mono: true, alinhamento: 'right' });
    doc.texto(PAGINA.largura - M, M + 6.4, ROTULOS_STATUS[ordem.status] ?? ordem.status, {
      tamanho: 2.7,
      peso: 700,
      cor: '#4f46e5',
      alinhamento: 'right',
    });
    doc.texto(PAGINA.largura - M, M + 10, `Entrada em ${dataHora(ordem.criado_em)}`, {
      tamanho: 2.3,
      cor: '#6b7186',
      alinhamento: 'right',
    });

    y = M + 16;
    doc.linha(M, y, PAGINA.largura - M, y, { espessura: 0.5 });
    y += 6;
  };

  const secao = (titulo) => {
    garantir(12);
    doc.texto(M, y, titulo.toUpperCase(), { tamanho: 2.2, peso: 700, cor: '#4f46e5' });
    y += 3.8;
    doc.linha(M, y, PAGINA.largura - M, y, { cor: '#e5e8f0', espessura: 0.2 });
    y += 3.4;
  };

  const campos = (pares) => {
    const coluna = (PAGINA.largura - M * 2) / 2;
    for (let i = 0; i < pares.length; i += 2) {
      garantir(11);
      for (let c = 0; c < 2; c += 1) {
        const par = pares[i + c];
        if (!par) continue;
        const x = M + c * coluna;
        doc.texto(x, y, par[0], { tamanho: 2, peso: 700, cor: '#6b7186' });
        doc.texto(x, y + 2.4, par[1], { tamanho: 2.8, peso: 600, largura: coluna - 6, linhasMax: 2 });
      }
      y += 7;
    }
    y += 1;
  };

  const paragrafo = (texto) => {
    const altura = doc.alturaTexto(texto, { tamanho: 2.7, largura: PAGINA.largura - M * 2 });
    garantir(altura + 3);
    y = doc.texto(M, y, texto, { tamanho: 2.7, largura: PAGINA.largura - M * 2 });
    y += 2.5;
  };

  const listaEventos = () => {
    for (const evento of eventos) {
      const descricao = `${ROTULOS_TIPO_EVENTO[evento.tipo_evento] ?? evento.tipo_evento}${
        evento.descricao ? `: ${evento.descricao}` : ''
      }${evento.usuario_nome ? ` — ${evento.usuario_nome}` : ''}`;
      const larguraDesc = PAGINA.largura - M * 2 - 28;
      const altura = doc.alturaTexto(descricao, { tamanho: 2.5, largura: larguraDesc });
      garantir(altura + 6);
      doc.texto(M, y, dataHora(evento.criado_em), { tamanho: 2.2, cor: '#6b7186', mono: true });
      y = doc.texto(M + 28, y, descricao, { tamanho: 2.5, largura: larguraDesc });
      y += 1;
      doc.linha(M, y, PAGINA.largura - M, y, { cor: '#eef0f6', espessura: 0.2 });
      y += 1.6;
    }
    y += 1;
  };

  const galeriaFotos = () => {
    const largura = 44;
    const altura = 32;
    const lacuna = 5;
    const porLinha = Math.max(1, Math.floor((PAGINA.largura - M * 2 + lacuna) / (largura + lacuna)));
    let coluna = 0;
    for (const foto of outrasFotos) {
      if (coluna === 0) garantir(altura + 9);
      const x = M + coluna * (largura + lacuna);
      const img = imagens[foto.id];
      if (img) doc.imagemContida(img, x, y, largura, altura, { fundo: '#f2f3f7' });
      else doc.retangulo(x, y, largura, altura, { cor: '#f2f3f7', raio: 1.5 });
      doc.texto(x + largura / 2, y + altura + 1.2, ROTULOS_TIPO_FOTO[foto.tipo] ?? foto.tipo, {
        tamanho: 2,
        cor: '#6b7186',
        alinhamento: 'center',
      });
      coluna += 1;
      if (coluna >= porLinha) {
        coluna = 0;
        y += altura + 7;
      }
    }
    if (coluna !== 0) y += altura + 7;
    y += 1;
  };

  const blocoAssinatura = () => {
    if (!assinatura) return;
    const altura = 34;
    garantir(altura + 12);
    doc.texto(M, y, 'Assinatura do cliente', { tamanho: 2.4, peso: 700, cor: '#6b7186' });
    y += 4;
    const img = imagens[assinatura.id];
    if (img) doc.imagemContida(img, M, y, 92, altura, { fundo: '#14182b' });
    else doc.retangulo(M, y, 92, altura, { cor: '#14182b', raio: 2 });
    y += altura + 1.5;
    doc.linha(M, y, M + 92, y, { espessura: 0.3 });
    y += 6;
  };

  novaPagina();
  cabecalho();

  secao('Cliente');
  campos([
    ['Nome', ordem.cliente_nome],
    ['Telefone', telefone(ordem.cliente_telefone)],
    ['Retirado por', ordem.recebido_por ?? '—'],
    ['Loja', ordem.loja_nome],
  ]);

  if (qrRastreio) {
    secao('Acompanhe sua OS pelo celular');
    const tam = 26;
    garantir(tam + 6);
    doc.imagemContida(qrRastreio.img, M, y, tam, tam, { fundo: '#ffffff' });
    doc.texto(M + tam + 5, y + 2, 'Escaneie o QR para ver o status', { tamanho: 2.8, peso: 700 });
    doc.texto(M + tam + 5, y + 6.4, 'do reparo sem precisar ligar na loja.', { tamanho: 2.5, cor: '#6b7186' });
    doc.texto(M + tam + 5, y + 11, qrRastreio.link, {
      tamanho: 2,
      cor: '#9aa0b4',
      largura: PAGINA.largura - M * 2 - tam - 5,
      linhasMax: 3,
    });
    y += tam + 4;
  }

  secao('Aparelho');
  campos([
    ['Tipo', ordem.tipo_aparelho ?? 'Celular'],
    ['Marca / modelo', `${ordem.marca} ${ordem.modelo}`],
    ['Cor', ordem.cor || '—'],
    ['IMEI / série', ordem.imei || '—'],
    ['Acessórios', ordem.acessorios || 'Nenhum registrado'],
  ]);

  secao('Defeito relatado');
  paragrafo(ordem.defeito_relatado);
  if (ordem.estado_aparelho) {
    secao('Estado na entrada');
    paragrafo(ordem.estado_aparelho);
  }

  secao('Serviço e valores');
  campos([
    ['Atendente', ordem.atendente_nome ?? '—'],
    ['Técnico', ordem.tecnico_nome ?? 'Ainda não assumido'],
    ['Início do reparo', ordem.iniciado_em ? dataHora(ordem.iniciado_em) : '—'],
    ['Concluído em', ordem.concluido_em ? dataHora(ordem.concluido_em) : '—'],
    ['Retirado em', ordem.retirado_em ? dataHora(ordem.retirado_em) : '—'],
    ['Valor', ordem.valor != null ? moeda(ordem.valor) : '—'],
    ['Pagamento', ordem.valor_pago ? 'Confirmado' : 'Pendente / não aplicável'],
    ordem.forma_pagamento ? ['Forma de pagamento', ROTULOS_PAGAMENTO[ordem.forma_pagamento] ?? ordem.forma_pagamento] : null,
    ordem.garantia_ate ? ['Garantia até', dataHora(ordem.garantia_ate).slice(0, 10)] : null,
    ordem.orcamento_valor != null ? ['Orçamento aprovado', moeda(ordem.orcamento_valor)] : null,
  ]);

  if (eventos.length) {
    secao('Histórico do atendimento');
    listaEventos();
  }

  if (outrasFotos.length || assinatura) {
    secao('Fotos e assinatura');
    if (outrasFotos.length) galeriaFotos();
    blocoAssinatura();
  }

  const emitido = new Date().toLocaleString('pt-BR');
  paginas.forEach((pagina, indice) => {
    pagina.linha(M, PAGINA.altura - 13, PAGINA.largura - M, PAGINA.altura - 13, { cor: '#e5e8f0', espessura: 0.2 });
    pagina.texto(M, PAGINA.altura - 10.5, `${MARCA} · emitido em ${emitido}`, { tamanho: 2.2, cor: '#9aa0b4' });
    pagina.texto(PAGINA.largura - M, PAGINA.altura - 10.5, `Página ${indice + 1} de ${paginas.length}`, {
      tamanho: 2.2,
      cor: '#9aa0b4',
      alinhamento: 'right',
    });
  });

  const jpegs = await Promise.all(paginas.map((pagina) => canvasParaJpeg(pagina.canvas, 0.9)));
  const saida = jpegs.map((jpeg) => ({ jpeg, larguraPt: mmParaPt(PAGINA.largura), alturaPt: mmParaPt(PAGINA.altura) }));
  baixarPdf(`comprovante-${ordem.numero_os}.pdf`, montarPdf(saida));
}
