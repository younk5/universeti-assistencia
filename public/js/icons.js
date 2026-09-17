/**
 * Ícones em SVG inline. Um único mapa evita dependências externas e mantém
 * o pacote de UI leve (sem requisições extras no 4G do balcão).
 */
const CAMINHOS = {
  painel: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  fila: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  lista: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/>',
  nova: '<path d="M12 5v14M5 12h14"/>',
  admin: '<path d="M12 2 4 6v6c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V6l-8-4Z"/><path d="m9 12 2 2 4-4"/>',
  sair: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  lua: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  camera: '<path d="M14.5 4h-5L8 6.5H4A1.5 1.5 0 0 0 2.5 8v10A1.5 1.5 0 0 0 4 19.5h16A1.5 1.5 0 0 0 21.5 18V8A1.5 1.5 0 0 0 20 6.5h-4L14.5 4Z"/><circle cx="12" cy="13" r="3.5"/>',
  imagem: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  telefone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',
  usuario: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  usuarios: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 5.3a3.5 3.5 0 0 1 0 6.4M18 21a6.6 6.6 0 0 0-1.4-4.1c2.6.4 4.4 2 4.4 4.1"/>',
  loja: '<path d="M3 9.5 4.5 4h15L21 9.5"/><path d="M4 9.5V20h16V9.5"/><path d="M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/><path d="M9 20v-5h6v5"/>',
  busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  filtro: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
  chevronDireita: '<path d="m9 6 6 6-6 6"/>',
  chevronEsquerda: '<path d="m15 6-6 6 6 6"/>',
  chevronBaixo: '<path d="m6 9 6 6 6-6"/>',
  setaDireita: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alerta: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17.5v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  imprimir: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 17h10v4H7z"/>',
  whatsapp: '<path d="M12.04 2A9.9 9.9 0 0 0 2.1 11.9c0 1.75.46 3.45 1.32 4.95L2 22l5.3-1.38a9.9 9.9 0 0 0 4.74 1.2h.01a9.9 9.9 0 0 0 9.9-9.9 9.9 9.9 0 0 0-9.9-9.92Zm5.8 14.06c-.25.7-1.45 1.34-2 1.38-.5.05-.98.2-3.3-.7-2.78-1.1-4.53-3.96-4.67-4.15-.13-.18-1.1-1.48-1.1-2.83 0-1.34.7-2 .96-2.28.25-.28.54-.35.72-.35l.52.01c.17 0 .39-.06.6.46l.83 2c.07.14.11.3.02.48l-.31.47-.22.24c-.14.14-.29.3-.13.58.16.28.72 1.19 1.55 1.93 1.06.95 1.96 1.24 2.24 1.38.28.14.44.12.6-.07l.87-1.01c.19-.24.36-.18.6-.09l1.71.8c.25.13.42.19.48.3.06.1.06.6-.19 1.3Z"/>',
  assinatura: '<path d="M3 19c3 0 4-11 7-11s3 9 5 9 3-4 6-4"/><path d="M3 22h18"/>',
  editar: '<path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="m14 6 4 4"/>',
  olho: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  olhoFechado: '<path d="M3 3l18 18"/><path d="M10.6 6.2A9.5 9.5 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-2.9 3.7M6.5 7.6C3.8 9.2 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  ferramenta: '<path d="M14.7 6.3a4.5 4.5 0 0 0 6 6L21 21l-3 .5-8.7-8.7a4.5 4.5 0 0 0-6-6L2 7l3 .5L6.5 9l-1.2 1.2 2.5 2.5L9 11.5l1.5 1.5"/>',
  pacote: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
  recarregar: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  cadeado: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  usuarioMais: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M18 8v6M15 11h6"/>',
  caixa: '<path d="M3 8h18v12H3z"/><path d="M3 8l2-4h14l2 4M9 12h6"/>',
  tendencia: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.4-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  voltar: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  escudo: '<path d="M12 2 4 6v6c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V6l-8-4Z"/>',
  raio: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
  local: '<path d="M12 22s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>',
  dispositivo: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18.5h2"/>',
  filtroX: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/><path d="m17 3 4 4M21 3l-4 4"/>',
  garra: '<path d="M12 3v6M8 9h8l1 6H7l1-6ZM10 15v6M14 15v6"/>',
  curva: '<path d="M3 20V8a5 5 0 0 1 5-5h13"/><path d="m17 1 4 2-4 2"/>',
};

export function iconeSvg(nome, { tamanho = 20, classe = '', traco = 1.8 } = {}) {
  const conteudo = CAMINHOS[nome];
  if (!conteudo) return '';
  return `<svg viewBox="0 0 24 24" width="${tamanho}" height="${tamanho}" fill="none" stroke="currentColor" stroke-width="${traco}" stroke-linecap="round" stroke-linejoin="round" class="${classe}" aria-hidden="true" focusable="false">${conteudo}</svg>`;
}

export function icone(nome, opcoes) {
  const template = document.createElement('template');
  template.innerHTML = iconeSvg(nome, opcoes).trim();
  return template.content.firstElementChild ?? document.createComment('');
}
