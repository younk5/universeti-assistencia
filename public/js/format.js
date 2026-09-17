const FORMATADOR_MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const FORMATADOR_NUMERO = new Intl.NumberFormat('pt-BR');
const FORMATADOR_DATA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const FORMATADOR_DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const FORMATADOR_HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });const FORMATADOR_RELATIVO = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

export const moeda = (valor) =>
  valor === null || valor === undefined || valor === '' ? '—' : FORMATADOR_MOEDA.format(Number(valor));

export const numero = (valor) => FORMATADOR_NUMERO.format(Number(valor ?? 0));

export function data(iso) {
  if (!iso) return '—';
  return FORMATADOR_DATA.format(new Date(iso));
}

export function dataHora(iso) {
  if (!iso) return '—';
  return FORMATADOR_DATA_HORA.format(new Date(iso));
}

export function quando(iso) {
  if (!iso) return '';
  const agora = Date.now();
  const alvo = new Date(iso).getTime();
  const diferencaSeg = Math.round((alvo - agora) / 1000);
  const absoluto = Math.abs(diferencaSeg);
  if (absoluto < 45) return 'agora mesmo';
  if (absoluto < 3600) return FORMATADOR_RELATIVO.format(Math.round(diferencaSeg / 60), 'minute');
  if (absoluto < 86400) return FORMATADOR_RELATIVO.format(Math.round(diferencaSeg / 3600), 'hour');
  if (absoluto < 2592000) return FORMATADOR_RELATIVO.format(Math.round(diferencaSeg / 86400), 'day');
  return data(iso);
}

export function duracao(horas) {
  if (horas === null || horas === undefined || Number.isNaN(Number(horas))) return '—';
  const total = Number(horas);
  if (total < 1) {
    const minutos = Math.max(1, Math.round(total * 60));
    return `${minutos} min`;
  }
  if (total < 24) return `${total.toFixed(1).replace('.', ',')} h`;
  const dias = total / 24;
  return `${dias.toFixed(1).replace('.', ',')} dias`;
}

export function telefone(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (digitos.length === 11) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  if (digitos.length === 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  return valor || '—';
}

export function iniciais(nome) {
  const partes = String(nome ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!partes.length) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0][0]}${partes[partes.length - 1][0]}`.toUpperCase();
}

export function iniciaisPapel(papel) {
  return { admin: 'Administrador', atendente: 'Atendente', tecnico: 'Técnico' }[papel] ?? papel;
}

export function mesAtual() {
  const hoje = new Date();
  const primeiro = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const ultimo = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { de: f(primeiro), ate: f(ultimo) };
}

export function rotuloPeriodo(de, ate) {
  if (!de && !ate) return 'Todo o período';
  if (de && ate && de === ate) return data(`${de}T12:00:00`);
  return `${de ? data(`${de}T12:00:00`) : 'início'} até ${ate ? data(`${ate}T12:00:00`) : 'hoje'}`;
}
