/**
 * Verificação estrutural do gerador de PDF (public/js/pdf.js).
 *
 * Não abre um leitor de PDF: confere a estrutura do arquivo — cabeçalho,
 * objetos, tabela xref e trailer — e que a imagem JPEG foi embutida.
 */
import { montarPdf } from '../../public/js/pdf.js';

let passos = 0;
let falhas = 0;

const ok = (condicao, descricao, extra = '') => {
  passos += 1;
  if (condicao) {
    console.log(`  \u2713 ${descricao}`);
  } else {
    falhas += 1;
    console.error(`  \u2717 ${descricao}${extra ? ` -> ${extra}` : ''}`);
  }
};

// Cabeçalho JPEG mínimo (SOI + SOF0), só para o gerador ler as dimensões (3x2).
const jpegFalso = Uint8Array.from([
  0xff, 0xd8,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03,
  0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  0xff, 0xd9,
]);

console.log('\n  Gerador de PDF (estrutura)\n');

try {
  const pdf = montarPdf([
    { jpeg: jpegFalso, larguraPt: 283.46, alturaPt: 198.43 },
    { jpeg: jpegFalso, larguraPt: 283.46, alturaPt: 198.43 },
  ]);

  ok(pdf instanceof Uint8Array && pdf.length > 500, 'PDF gerado como bytes');

  const texto = Buffer.from(pdf).toString('latin1');

  ok(texto.startsWith('%PDF-1.4'), 'cabeçalho %PDF-1.4 presente');
  ok(texto.trimEnd().endsWith('%%EOF'), 'trailer %%EOF presente');
  ok(texto.includes('/Filter /DCTDecode'), 'imagem embutida como JPEG (DCTDecode)');
  ok(texto.includes('/Width 3') && texto.includes('/Height 2'), 'dimensões lidas do cabeçalho JPEG');
  ok(texto.includes('/Count 2') && texto.includes('/Type /Pages'), 'duas páginas declaradas');
  ok(texto.includes('/MediaBox [0 0 283.46 198.43]'), 'tamanho da página em pontos (mm convertido)');

  const startxref = /startxref\s+(\d+)\s+%%EOF/.exec(texto);
  const deslocamento = startxref ? Number(startxref[1]) : -1;
  ok(deslocamento > 0 && texto.slice(deslocamento, deslocamento + 4) === 'xref', 'startxref aponta para a tabela xref');

  const linhas = texto.slice(deslocamento).split('\n');
  const totalObjetos = Number(linhas[1]?.trim().split(' ')[1] ?? 0);
  let offsetsValidos = totalObjetos > 0;
  for (let n = 1; n < totalObjetos; n += 1) {
    const offset = Number((linhas[2 + n] ?? '').slice(0, 10));
    if (!Number.isFinite(offset) || !/^\d+ 0 obj/.test(texto.slice(offset, offset + 12))) {
      offsetsValidos = false;
      break;
    }
  }
  ok(offsetsValidos, `tabela xref aponta para todos os ${totalObjetos - 1} objetos`);
} catch (erro) {
  falhas += 1;
  console.error('\n  [verificação interrompida]', erro.message ?? erro);
}

console.log(`\n${'\u2500'.repeat(52)}`);
console.log(`  ${passos - falhas}/${passos} verificações passaram`);
console.log(`${'\u2500'.repeat(52)}\n`);
process.exit(falhas === 0 ? 0 : 1);
