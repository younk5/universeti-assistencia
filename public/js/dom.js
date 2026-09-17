import { icone } from './icons.js';

/**
 * Criação de DOM declarativa, sem framework.
 *   h('div.card', { onclick }, h('h2', {}, 'Título'), 'texto')
 */
export function h(seletor, props = null, ...filhos) {
  const [tagEEstilo, ...classes] = String(seletor).split('.');
  const [tag, id] = tagEEstilo.split('#');
  const elemento = document.createElement(tag || 'div');
  if (id) elemento.id = id;
  if (classes.length) elemento.className = classes.join(' ');

  if (props && (props.nodeType || Array.isArray(props) || typeof props === 'string')) {
    filhos.unshift(props);
    props = null;
  }

  if (props) {
    for (const [chave, valor] of Object.entries(props)) {
      if (valor === null || valor === undefined || valor === false) continue;
      if (chave === 'class' || chave === 'className') {
        elemento.className = [elemento.className, valor].filter(Boolean).join(' ');
      } else if (chave === 'style' && typeof valor === 'object') {
        Object.assign(elemento.style, valor);
      } else if (chave === 'dataset') {
        Object.assign(elemento.dataset, valor);
      } else if (chave === 'html') {
        elemento.innerHTML = valor;
      } else if (chave.startsWith('on') && typeof valor === 'function') {
        elemento.addEventListener(chave.slice(2).toLowerCase(), valor);
      } else if (chave in elemento && chave !== 'list' && typeof valor !== 'object') {
        elemento[chave] = valor;
      } else {
        elemento.setAttribute(chave, valor === true ? '' : String(valor));
      }
    }
  }

  anexar(elemento, filhos);
  return elemento;
}

export function anexar(pai, filhos) {
  for (const filho of filhos.flat(Infinity)) {
    if (filho === null || filho === undefined || filho === false || filho === true) continue;
    pai.append(filho.nodeType ? filho : document.createTextNode(String(filho)));
  }
  return pai;
}

export function limpar(elemento) {
  while (elemento.firstChild) elemento.removeChild(elemento.firstChild);
  return elemento;
}

export function montar(pai, ...filhos) {
  limpar(pai);
  anexar(pai, filhos);
  return pai;
}

export function fragmento(...filhos) {
  const f = document.createDocumentFragment();
  anexar(f, filhos);
  return f;
}

/** Helper síncrono para debounce de campos de busca. */
export function debounce(fn, espera = 320) {
  let timer = null;
  const envolto = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), espera);
  };
  envolto.cancelar = () => clearTimeout(timer);
  return envolto;
}
