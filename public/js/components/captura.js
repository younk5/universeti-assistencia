import { h, montar } from '../dom.js';
import { icone } from '../icons.js';
import { comprimirImagem, blobParaUrl, formatarBytes } from '../image.js';

/**
 * Área de captura/seleção de foto com compressão automática.
 * Em celular abre direto a câmera traseira (capture="environment").
 */
export function criarCaptura({
  titulo = 'Foto do aparelho',
  dica = 'Toque para abrir a câmera ou escolha uma imagem da galeria.',
  legendaFoto = null,
  aoMudar = null,
  maxLado = 1600,
} = {}) {
  let arquivoAtual = null;
  let urlAtual = null;

  const entrada = h('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    'aria-label': titulo,
  });

  const area = h(
    'div.captura__area',
    {},
    entrada,
    h(
      'div.captura__interno',
      {},
      h('div.captura__icone', {}, icone('camera', { tamanho: 24 })),
      h('div.captura__titulo', {}, titulo),
      h('div.captura__dica', {}, dica),
    ),
  );

  const painelInfo = h('div.oculto');
  const painelErro = h('div.oculto');
  const areaProgresso = h('div.oculto');

  const envoltorio = h('div.captura', {}, area, areaProgresso, painelErro, painelInfo);

  async function processar(arquivo) {
    painelErro.classList.add('oculto');
    montar(areaProgresso, h('div.barra-progresso', {}, h('span', { style: { width: '35%' } })), h('div.texto-mini.texto-suave', { style: { marginTop: '6px' } }, 'Otimizando imagem…'));
    areaProgresso.classList.remove('oculto');

    try {
      const resultado = await comprimirImagem(arquivo, { maxLado });
      if (urlAtual) URL.revokeObjectURL(urlAtual);
      arquivoAtual = {
        blob: resultado.blob,
        mime: 'image/jpeg',
        legenda: legendaFoto,
        bytes: resultado.bytes,
        bytesOriginais: resultado.bytesOriginais,
        percentual: resultado.percentual,
        dimensoes: `${resultado.largura}×${resultado.altura}`,
      };
      urlAtual = blobParaUrl(resultado.blob);
      renderizarPreview();
      aoMudar?.(arquivoAtual);
    } catch (erro) {
      limpar();
      montar(
        painelErro,
        h(
          'div.faixa-erro',
          {},
          icone('alerta', { tamanho: 20 }),
          h(
            'div',
            {},
            h('div.faixa-erro__titulo', {}, 'Não conseguimos usar esta foto'),
            h('div.faixa-erro__texto', {}, erro.message),
          ),
        ),
      );
      painelErro.classList.remove('oculto');
      aoMudar?.(null);
    } finally {
      montar(areaProgresso);
      areaProgresso.classList.add('oculto');
    }
  }

  function renderizarPreview() {
    montar(
      envoltorio,
      h(
        'div.preview-foto',
        {},
        h('img', { src: urlAtual, alt: 'Pré-visualização da foto' }),
        h(
          'div.preview-foto__barra',
          {},
          h(
            'span.texto-mini',
            {},
            arquivoAtual.percentual > 0
              ? `Otimizada: ${formatarBytes(arquivoAtual.bytesOriginais)} → ${formatarBytes(arquivoAtual.bytes)} (−${arquivoAtual.percentual}%)`
              : `${formatarBytes(arquivoAtual.bytes)} · ${arquivoAtual.dimensoes}`,
          ),
          h(
            'div.linha',
            { style: { gap: '2px' } },
            h(
              'button.preview-foto__remover',
              { type: 'button', onclick: () => trocar() },
              'Trocar foto',
            ),
            h(
              'button.preview-foto__remover',
              { type: 'button', onclick: () => { limpar(); aoMudar?.(null); } },
              'Remover',
            ),
          ),
        ),
      ),
    );
  }

  function trocar() {
    entrada.value = '';
    entrada.click();
  }

  function limpar() {
    if (urlAtual) URL.revokeObjectURL(urlAtual);
    urlAtual = null;
    arquivoAtual = null;
    montar(envoltorio, area);
    painelErro.classList.add('oculto');
    montar(painelErro);
    montar(
      area,
      entrada,
      h(
        'div.captura__interno',
        {},
        h('div.captura__icone', {}, icone('camera', { tamanho: 24 })),
        h('div.captura__titulo', {}, titulo),
        h('div.captura__dica', {}, dica),
      ),
    );
  }

  entrada.addEventListener('change', (evento) => {
    const arquivo = evento.target.files?.[0];
    if (arquivo) processar(arquivo);
  });

  area.addEventListener('dragover', (evento) => {
    evento.preventDefault();
    area.classList.add('captura__area--arrastando');
  });
  area.addEventListener('dragleave', () => area.classList.remove('captura__area--arrastando'));
  area.addEventListener('drop', (evento) => {
    evento.preventDefault();
    area.classList.remove('captura__area--arrastando');
    const arquivo = evento.dataTransfer?.files?.[0];
    if (arquivo && arquivo.type.startsWith('image/')) processar(arquivo);
  });

  return {
    elemento: envoltorio,
    obterArquivo: () => arquivoAtual,
    temFoto: () => Boolean(arquivoAtual),
    limpar,
    trocar,
  };
}
