import { criarDocumento } from './documento.js';
import { montarPdf, canvasParaJpeg, baixarPdf, mmParaPt } from './pdf.js';
import { dataHora } from './format.js';

/**
 * Comprovante em PDF para o CLIENTE, gerado na tela pública de acompanhamento.
 * Diferente do comprovante interno, não inclui fotos nem assinatura (esses
 * exigem sessão) — traz o resumo da OS e o histórico de acompanhamento.
 */
export async function baixarComprovantePublico(ordem, linhaDoTempo = []) {
  const P = { largura: 210, altura: 297 };
  const M = 14;
  const doc = criarDocumento({ larguraMm: P.largura, alturaMm: P.altura, escala: 9 });
  let y = M;

  doc.retangulo(M, y, 13, 13, { cor: '#14182b', raio: 3.5 });
  doc.texto(M + 6.5, y + 3.2, 'UT', { tamanho: 4.6, peso: 800, cor: '#ffffff', alinhamento: 'center', mono: true });
  doc.texto(M + 16, y + 0.6, 'UniverseTI Assistência', { tamanho: 4.8, peso: 800 });
  doc.texto(M + 16, y + 6.6, 'Comprovante de acompanhamento', { tamanho: 2.4, cor: '#6b7186' });
  doc.texto(P.largura - M, y, ordem.numeroOS, { tamanho: 5.2, peso: 800, mono: true, alinhamento: 'right' });
  doc.texto(P.largura - M, y + 6.4, ordem.statusRotulo ?? ordem.status, {
    tamanho: 2.7,
    peso: 700,
    cor: '#4f46e5',
    alinhamento: 'right',
  });
  y += 18;
  doc.linha(M, y, P.largura - M, y, { espessura: 0.5 });
  y += 6;

  const pares = [
    ['Aparelho', `${ordem.marca ?? ''} ${ordem.modelo ?? ''}`.trim() || 'Celular'],
    ['Cor', ordem.cor || '—'],
    ['Loja', ordem.lojaNome ?? '—'],
    ['Aberta em', dataHora(ordem.criadoEm)],
    ordem.concluidoEm ? ['Concluída em', dataHora(ordem.concluidoEm)] : null,
    ordem.retiradoEm ? ['Retirada em', dataHora(ordem.retiradoEm)] : null,
    ordem.garantiaAte ? ['Garantia até', dataHora(ordem.garantiaAte).slice(0, 10)] : null,
    ordem.previsaoRetirada ? ['Previsão de retirada', dataHora(ordem.previsaoRetirada).slice(0, 10)] : null,
    ordem.lojaTelefone ? ['Telefone da loja', ordem.lojaTelefone] : null,
    ordem.orcamentoValor != null ? ['Orçamento', `R$ ${Number(ordem.orcamentoValor).toFixed(2)}`] : null,
  ].filter(Boolean);

  const coluna = (P.largura - M * 2) / 2;
  for (let i = 0; i < pares.length; i += 2) {
    for (let c = 0; c < 2; c += 1) {
      const par = pares[i + c];
      if (!par) continue;
      const x = M + c * coluna;
      doc.texto(x, y, par[0], { tamanho: 2, peso: 700, cor: '#6b7186' });
      doc.texto(x, y + 2.4, par[1], { tamanho: 2.8, peso: 600, largura: coluna - 6, linhasMax: 2 });
    }
    y += 8;
  }

  y += 4;
  doc.texto(M, y, 'HISTÓRICO DO ATENDIMENTO', { tamanho: 2.2, peso: 700, cor: '#4f46e5' });
  y += 4;
  const eventos = [...(linhaDoTempo ?? [])].reverse();
  for (const evento of eventos) {
    doc.texto(M, y, dataHora(evento.quando), { tamanho: 2.2, cor: '#6b7186', mono: true });
    y = doc.texto(M + 28, y, evento.rotulo, { tamanho: 2.5, largura: P.largura - M * 2 - 28 });
    y += 1;
    doc.linha(M, y, P.largura - M, y, { cor: '#eef0f6', espessura: 0.2 });
    y += 1.6;
  }

  doc.linha(M, P.altura - 13, P.largura - M, P.altura - 13, { cor: '#e5e8f0', espessura: 0.2 });
  doc.texto(M, P.altura - 10.5, `Emitido em ${new Date().toLocaleString('pt-BR')}`, { tamanho: 2.2, cor: '#9aa0b4' });

  const jpeg = await canvasParaJpeg(doc.canvas, 0.92);
  baixarPdf(`comprovante-${ordem.numeroOS}.pdf`, montarPdf([{ jpeg, larguraPt: mmParaPt(P.largura), alturaPt: mmParaPt(P.altura) }]));
}
