import { criarDocumento } from './documento.js';
import { montarPdf, canvasParaJpeg, baixarPdf, mmParaPt } from './pdf.js';
import { moeda, numero, dataHora } from './format.js';
import { ROTULOS_STATUS, ORDEM_STATUS } from './constantes.js';

/**
 * Relatório gerencial em PDF, gerado no navegador a partir dos dados do painel
 * (/api/dashboard). Multi-página em A4, sem dependências.
 */
const P = { largura: 210, altura: 297 };
const M = 14;
const LIMITE = P.altura - 18;

const ROTULOS_PAGAMENTO = {
  pix: 'Pix',
  dinheiro: 'Dinheiro',
  credito: 'Cartão de crédito',
  debito: 'Cartão de débito',
  outro: 'Outro',
  nao_informado: 'Não informado',
};

export async function baixarRelatorioPainel(dados, { escopo = 'Rede inteira' } = {}) {
  const paginas = [];
  let doc = null;
  let y = 0;

  const novaPagina = () => {
    doc = criarDocumento({ larguraMm: P.largura, alturaMm: P.altura, escala: 9 });
    paginas.push(doc);
    y = M;
  };
  const garantir = (altura) => {
    if (y + altura <= LIMITE) return;
    novaPagina();
    doc.texto(M, M, 'UniverseTI Assistência — relatório (continuação)', { tamanho: 2.5, peso: 700, cor: '#6b7186' });
    y = M + 8;
  };
  const secao = (titulo) => {
    garantir(11);
    doc.texto(M, y, String(titulo).toUpperCase(), { tamanho: 2.2, peso: 700, cor: '#4f46e5' });
    y += 3.6;
    doc.linha(M, y, P.largura - M, y, { cor: '#e5e8f0', espessura: 0.2 });
    y += 3.4;
  };
  const linha = (rotulo, valor, destaque = false) => {
    garantir(7);
    doc.texto(M, y, rotulo, { tamanho: 2.6, cor: '#5a6178' });
    doc.texto(P.largura - M, y, valor, {
      tamanho: 2.8,
      peso: 700,
      alinhamento: 'right',
      cor: destaque ? '#4f46e5' : '#14182b',
    });
    y += 6;
  };

  novaPagina();
  // Cabeçalho
  doc.retangulo(M, y, 13, 13, { cor: '#14182b', raio: 3.5 });
  doc.texto(M + 6.5, y + 3.2, 'UT', { tamanho: 4.6, peso: 800, cor: '#ffffff', alinhamento: 'center', mono: true });
  doc.texto(M + 16, y + 0.6, 'UniverseTI Assistência', { tamanho: 4.8, peso: 800 });
  doc.texto(M + 16, y + 6.6, 'Relatório gerencial', { tamanho: 2.4, cor: '#6b7186' });
  doc.texto(P.largura - M, y + 0.6, dataHora(dados.geradoEm), { tamanho: 2.4, cor: '#6b7186', alinhamento: 'right' });
  doc.texto(P.largura - M, y + 5.6, escopo, { tamanho: 2.6, peso: 700, cor: '#4f46e5', alinhamento: 'right' });
  y += 18;
  doc.linha(M, y, P.largura - M, y, { espessura: 0.5 });
  y += 6;

  const periodo = dados.periodo ? `${dados.periodo.de} a ${dados.periodo.ate}` : '—';

  secao('Período');
  linha('Período analisado', periodo);
  linha('Entradas', numero(dados.periodoResumo?.total ?? 0));
  linha('Valor em serviços', moeda(dados.periodoResumo?.faturamento ?? 0), true);
  const comp = dados.comparativo;
  if (comp) {
    const fmtVar = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${String(v).replace('.', ',')}%`);
    linha('Variação de entradas vs. anterior', fmtVar(comp.variacaoEntradas));
    linha('Variação de faturamento vs. anterior', fmtVar(comp.variacaoFaturamento));
  }

  secao('Situação atual das OS');
  const status = dados.status ?? {};
  for (const chave of ORDEM_STATUS) linha(ROTULOS_STATUS[chave] ?? chave, numero(status[chave] ?? 0));
  linha('Em aberto', numero(status.abertas ?? 0), true);

  const fin = dados.financeiro;
  if (fin) {
    secao('Financeiro do período');
    linha('Entregas (retiradas)', numero(fin.entregas ?? 0));
    linha('Faturamento', moeda(fin.faturamento ?? 0), true);
    linha('Recebido', moeda(fin.recebido ?? 0));
    linha('A receber', moeda(fin.aReceber ?? 0));
    linha('Ticket médio', moeda(fin.ticketMedio ?? 0));
    if (fin.porFormaPagamento?.length) {
      y += 2;
      for (const p of fin.porFormaPagamento) {
        linha(`Pagamento · ${ROTULOS_PAGAMENTO[p.forma] ?? p.forma}`, `${numero(p.total)} · ${moeda(p.valor)}`);
      }
    }
  }

  if (dados.porLoja?.length) {
    secao('Ordens por loja');
    for (const loja of dados.porLoja) {
      garantir(7);
      doc.texto(M, y, loja.nome, { tamanho: 2.8, peso: 700 });
      doc.texto(P.largura - M, y, `${numero(loja.total)} OS · ${moeda(loja.faturamento ?? 0)}`, {
        tamanho: 2.6,
        alinhamento: 'right',
        cor: '#5a6178',
      });
      y += 6;
    }
  }

  if (dados.produtividade?.length) {
    secao('Produtividade da equipe');
    for (const t of dados.produtividade) {
      garantir(7);
      doc.texto(M, y, `${t.nome}${t.loja_nome ? ` · ${t.loja_nome}` : ''}`, { tamanho: 2.6 });
      doc.texto(P.largura - M, y, `${numero(t.concluidas_com_data ?? 0)} concluídas · ${moeda(t.faturamento ?? 0)}`, {
        tamanho: 2.5,
        alinhamento: 'right',
        cor: '#5a6178',
      });
      y += 6;
    }
  }

  const emitido = new Date().toLocaleString('pt-BR');
  paginas.forEach((pagina, indice) => {
    pagina.linha(M, P.altura - 13, P.largura - M, P.altura - 13, { cor: '#e5e8f0', espessura: 0.2 });
    pagina.texto(M, P.altura - 10.5, `UniverseTI Assistência · emitido em ${emitido}`, { tamanho: 2.1, cor: '#9aa0b4' });
    pagina.texto(P.largura - M, P.altura - 10.5, `Página ${indice + 1} de ${paginas.length}`, {
      tamanho: 2.1,
      cor: '#9aa0b4',
      alinhamento: 'right',
    });
  });

  const jpegs = await Promise.all(paginas.map((pagina) => canvasParaJpeg(pagina.canvas, 0.92)));
  const saida = jpegs.map((jpeg) => ({ jpeg, larguraPt: mmParaPt(P.largura), alturaPt: mmParaPt(P.altura) }));
  baixarPdf(`relatorio-${(dados.periodo?.de ?? '').replace(/-/g, '')}-${(dados.periodo?.ate ?? '').replace(/-/g, '')}.pdf`, montarPdf(saida));
}
