import { h, montar } from '../dom.js';
import { icone } from '../icons.js';
import { comprimirImagem, blobParaUrl, formatarBytes } from '../image.js';
import { store } from '../store.js';

/**
 * Área de captura/seleção de anexo (foto ou vídeo) com compressão automática
 * das imagens.
 *
 * No celular o usuário escolhe: "Tirar foto" abre direto a câmera traseira
 * (capture="environment"); "Galeria" abre o rolete de fotos e vídeos — sem o
 * atributo capture, o navegador deixa escolher entre câmera e galeria.
 * Vídeos não são comprimidos: sobem como estão (limite em store.meta.anexos).
 */

export const MIMES_VIDEO = ['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp'];

function limiteVideoBytes() {
  return Number(store.meta?.anexos?.maxVideoBytes) || 128 * 1024 * 1024;
}

function rotuloLimite() {
  return formatarBytes(limiteVideoBytes());
}

export function criarCaptura({
  titulo = 'Foto do aparelho',
  dica = 'Tire uma foto agora ou escolha uma foto/vídeo da galeria.',
  legendaFoto = null,
  aoMudar = null,
  maxLado = 1600,
  aceitaVideo = true,
} = {}) {
  let arquivoAtual = null;
  let urlAtual = null;
  let origemAtual = 'camera';

  const entradaCamera = h('input.oculto', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    'aria-label': `${titulo} — câmera`,
  });

  const entradaGaleria = h('input.oculto', {
    type: 'file',
    accept: aceitaVideo ? 'image/*,video/*' : 'image/*',
    'aria-label': `${titulo} — galeria`,
  });

  const area = h(
    'div.captura__area',
    {},
    entradaCamera,
    entradaGaleria,
    h(
      'div.captura__interno',
      {},
      h('div.captura__icone', {}, icone('camera', { tamanho: 24 })),
      h('div.captura__titulo', {}, titulo),
      h('div.captura__dica', {}, dica),
    ),
  );

  const acoes = h(
    'div.captura__acoes',
    {},
    h(
      'button.btn.btn--secundario.captura__botao',
      { type: 'button', onclick: () => abrirEntrada('camera') },
      icone('camera', { tamanho: 16 }),
      'Tirar foto',
    ),
    h(
      'button.btn.btn--secundario.captura__botao',
      { type: 'button', onclick: () => abrirEntrada('galeria') },
      icone('imagem', { tamanho: 16 }),
      aceitaVideo ? 'Foto ou vídeo da galeria' : 'Escolher da galeria',
    ),
  );

  const painelInfo = h('div.oculto');
  const painelErro = h('div.oculto');
  const areaProgresso = h('div.oculto');

  const envoltorio = h('div.captura', {}, area, acoes, areaProgresso, painelErro, painelInfo);

  function abrirEntrada(origem) {
    origemAtual = origem;
    const entrada = origem === 'camera' ? entradaCamera : entradaGaleria;
    entrada.value = '';
    entrada.click();
  }

  function mostrarErro(mensagem) {
    montar(
      painelErro,
      h(
        'div.faixa-erro',
        {},
        icone('alerta', { tamanho: 20 }),
        h(
          'div',
          {},
          h('div.faixa-erro__titulo', {}, 'Não conseguimos usar este arquivo'),
          h('div.faixa-erro__texto', {}, mensagem),
        ),
      ),
    );
    painelErro.classList.remove('oculto');
  }

  async function processar(arquivo) {
    painelErro.classList.add('oculto');
    const mime = String(arquivo.type ?? '').toLowerCase();

    if (mime.startsWith('video/')) {
      if (!aceitaVideo) {
        montar(painelErro);
        mostrarErro('Este campo aceita apenas fotos.');
        aoMudar?.(null);
        return;
      }
      if (!MIMES_VIDEO.includes(mime)) {
        mostrarErro('Formato de vídeo não suportado por aqui. Use MP4, MOV (iPhone) ou WebM.');
        aoMudar?.(null);
        return;
      }
      const limite = limiteVideoBytes();
      if (arquivo.size > limite) {
        mostrarErro(
          `Este vídeo tem ${formatarBytes(arquivo.size)} e o limite é ${rotuloLimite()}. ` +
            'Grave um trecho mais curto ou escolha outro arquivo.',
        );
        aoMudar?.(null);
        return;
      }

      if (urlAtual) URL.revokeObjectURL(urlAtual);
      arquivoAtual = {
        tipo: 'video',
        blob: arquivo,
        mime,
        legenda: legendaFoto,
        bytes: arquivo.size,
        bytesOriginais: arquivo.size,
        percentual: 0,
        dimensoes: null,
        nome: arquivo.name || 'video',
      };
      urlAtual = blobParaUrl(arquivo);
      renderizarPreview();
      aoMudar?.(arquivoAtual);
      return;
    }

    montar(areaProgresso, h('div.barra-progresso', {}, h('span', { style: { width: '35%' } })), h('div.texto-mini.texto-suave', { style: { marginTop: '6px' } }, 'Otimizando imagem…'));
    areaProgresso.classList.remove('oculto');

    try {
      const resultado = await comprimirImagem(arquivo, { maxLado });
      if (urlAtual) URL.revokeObjectURL(urlAtual);
      arquivoAtual = {
        tipo: 'imagem',
        blob: resultado.blob,
        mime: 'image/jpeg',
        legenda: legendaFoto,
        bytes: resultado.bytes,
        bytesOriginais: resultado.bytesOriginais,
        percentual: resultado.percentual,
        dimensoes: `${resultado.largura}×${resultado.altura}`,
        nome: arquivo.name || 'foto.jpg',
      };
      urlAtual = blobParaUrl(resultado.blob);
      renderizarPreview();
      aoMudar?.(arquivoAtual);
    } catch (erro) {
      limpar();
      mostrarErro(erro.message);
      aoMudar?.(null);
    } finally {
      montar(areaProgresso);
      areaProgresso.classList.add('oculto');
    }
  }

  function montarAreaInicial() {
    montar(
      area,
      entradaCamera,
      entradaGaleria,
      h(
        'div.captura__interno',
        {},
        h('div.captura__icone', {}, icone('camera', { tamanho: 24 })),
        h('div.captura__titulo', {}, titulo),
        h('div.captura__dica', {}, dica),
      ),
    );
  }

  function renderizarPreview() {
    const ehVideo = arquivoAtual.tipo === 'video';
    montar(
      envoltorio,
      h(
        'div.preview-foto',
        {},
        ehVideo
          ? h('video', { src: urlAtual, controls: true, playsinline: true, preload: 'metadata', 'aria-label': 'Pré-visualização do vídeo' })
          : h('img', { src: urlAtual, alt: 'Pré-visualização da foto' }),
        h(
          'div.preview-foto__barra',
          {},
          h(
            'span.texto-mini',
            {},
            ehVideo
              ? `Vídeo: ${formatarBytes(arquivoAtual.bytes)} · enviado sem compressão`
              : arquivoAtual.percentual > 0
                ? `Otimizada: ${formatarBytes(arquivoAtual.bytesOriginais)} → ${formatarBytes(arquivoAtual.bytes)} (−${arquivoAtual.percentual}%)`
                : `${formatarBytes(arquivoAtual.bytes)} · ${arquivoAtual.dimensoes}`,
          ),
          h(
            'div.linha',
            { style: { gap: '2px' } },
            h(
              'button.preview-foto__remover',
              { type: 'button', onclick: () => trocar() },
              ehVideo ? 'Trocar vídeo' : 'Trocar foto',
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
    abrirEntrada(origemAtual);
  }

  function limpar() {
    if (urlAtual) URL.revokeObjectURL(urlAtual);
    urlAtual = null;
    arquivoAtual = null;
    montar(envoltorio, area, acoes, areaProgresso, painelErro, painelInfo);
    painelErro.classList.add('oculto');
    montar(painelErro);
    montarAreaInicial();
  }

  for (const entrada of [entradaCamera, entradaGaleria]) {
    // O clique do próprio input não pode borbulhar para a área (que reabriria
    // a câmera em laço).
    entrada.addEventListener('click', (evento) => evento.stopPropagation());
    entrada.addEventListener('change', (evento) => {
      const arquivo = evento.target.files?.[0];
      if (arquivo) processar(arquivo);
    });
  }

  area.addEventListener('click', () => abrirEntrada('camera'));

  area.addEventListener('dragover', (evento) => {
    evento.preventDefault();
    area.classList.add('captura__area--arrastando');
  });
  area.addEventListener('dragleave', () => area.classList.remove('captura__area--arrastando'));
  area.addEventListener('drop', (evento) => {
    evento.preventDefault();
    area.classList.remove('captura__area--arrastando');
    const arquivo = evento.dataTransfer?.files?.[0];
    if (arquivo && (arquivo.type.startsWith('image/') || (aceitaVideo && arquivo.type.startsWith('video/')))) {
      processar(arquivo);
    }
  });

  return {
    elemento: envoltorio,
    obterArquivo: () => arquivoAtual,
    temArquivo: () => Boolean(arquivoAtual),
    ehVideo: () => arquivoAtual?.tipo === 'video',
    limpar,
    trocar,
  };
}
