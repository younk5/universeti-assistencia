/**
 * Teste do módulo de Inventário de Peças — API + interface real, Chrome
 * headless via DevTools Protocol (sem dependências externas).
 *
 *   node server/test/inventario.js
 *
 * Cobre: aba restrita ao admin, CRUD de fornecedor e peça pela UI, conclusão de
 * OS com peça do inventário (snapshot + baixa), gastos no painel e bloqueio do
 * módulo para técnico.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'tecnoflow-inventario-'));
const PORTA = 3188;
const PORTA_CDP = 9344;

let passos = 0;
let falhas = 0;

const ok = (condicao, descricao, extra = '') => {
  passos += 1;
  if (condicao) console.log(`  \u2713 ${descricao}`);
  else {
    falhas += 1;
    console.error(`  \u2717 ${descricao}${extra ? ` -> ${extra}` : ''}`);
  }
};
const titulo = (t) => console.log(`\n${t}`);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function localizarChrome() {
  return [
    process.env.CHROME_PATH,
    `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]
    .filter(Boolean)
    .find((c) => fs.existsSync(c)) ?? null;
}

async function aguardarHttp(url, tentativas = 60) {
  for (let i = 0; i < tentativas; i += 1) {
    try {
      const resposta = await fetch(url);
      if (resposta.ok) return true;
    } catch {
      /* ainda subindo */
    }
    await esperar(250);
  }
  return false;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.proximoId = 1;
    this.pendentes = new Map();
    this.ouvintes = new Map();
    ws.addEventListener('message', (evento) => {
      const mensagem = JSON.parse(evento.data);
      if (mensagem.id && this.pendentes.has(mensagem.id)) {
        const { resolver, rejeitar } = this.pendentes.get(mensagem.id);
        this.pendentes.delete(mensagem.id);
        if (mensagem.error) rejeitar(new Error(mensagem.error.message));
        else resolver(mensagem.result);
        return;
      }
      if (mensagem.method) for (const ouvinte of this.ouvintes.get(mensagem.method) ?? []) ouvinte(mensagem.params);
    });
  }

  enviar(method, params = {}) {
    const id = this.proximoId++;
    return new Promise((resolver, rejeitar) => {
      this.pendentes.set(id, { resolver, rejeitar });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pendentes.has(id)) {
          this.pendentes.delete(id);
          rejeitar(new Error(`Tempo esgotado em ${method}`));
        }
      }, 25000);
    });
  }

  ao(evento, handler) {
    if (!this.ouvintes.has(evento)) this.ouvintes.set(evento, []);
    this.ouvintes.get(evento).push(handler);
  }
}

const chrome = localizarChrome();
if (!chrome) {
  console.error('Chrome/Edge não encontrado. Defina CHROME_PATH para rodar este teste.');
  process.exit(1);
}

const ambiente = {
  ...process.env,
  PORT: String(PORTA),
  HOST: '127.0.0.1',
  DATA_DIR: dirTemp,
  SESSION_SECRET: 'segredo-de-teste-inventario',
  NODE_ENV: 'test',
};
const base = `http://127.0.0.1:${PORTA}`;

let servidor = null;
let navegador = null;
let cdp = null;
const errosConsole = [];
const excecoes = [];
const redeComErro = [];

function rodar(script) {
  return new Promise((resolver, rejeitar) => {
    const processo = spawn(process.execPath, [script], { cwd: raiz, env: ambiente, stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    processo.stdout.on('data', (d) => (saida += d));
    processo.stderr.on('data', (d) => (saida += d));
    processo.on('error', rejeitar);
    processo.on('exit', (codigo) => (codigo === 0 ? resolver(saida) : rejeitar(new Error(saida || `saída ${codigo}`))));
  });
}

async function sessao(login) {
  const resposta = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, senha: 'galaxy2026!' }),
  });
  const corpo = await resposta.json();
  if (resposta.status !== 200 || !corpo.ok) throw new Error(`login ${login} falhou: ${resposta.status}`);
  return (resposta.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
}

async function api(metodo, caminho, cookie, corpo = null) {
  const resposta = await fetch(base + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resposta.text();
  return { status: resposta.status, dados: texto ? JSON.parse(texto) : null };
}

try {
  titulo('Preparação do ambiente');
  await rodar(path.join('server', 'seed.js'));
  ok(true, 'banco de demonstração em diretório temporário');

  servidor = spawn(process.execPath, ['--no-warnings', 'server/index.js'], {
    cwd: raiz,
    env: ambiente,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ok(await aguardarHttp(`${base}/api/health`), 'servidor respondendo em /api/health');

  const cookieAdmin = await sessao('universeti');
  const cookieTecnico = await sessao('tecnico.centro@universeti.com.br');
  ok(true, 'sessões de admin e técnico obtidas');

  navegador = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--remote-debugging-port=${PORTA_CDP}`,
      `--user-data-dir=${path.join(dirTemp, 'chrome-profile')}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let conectou = false;
  for (let i = 0; i < 60 && !conectou; i += 1) {
    try {
      const versao = await fetch(`http://127.0.0.1:${PORTA_CDP}/json/version`);
      if (versao.ok) conectou = true;
    } catch {
      await esperar(250);
    }
  }
  ok(conectou, 'Chrome headless com DevTools ativo');
  if (!conectou) throw new Error('não foi possível conectar ao Chrome');

  const aba = await (await fetch(`http://127.0.0.1:${PORTA_CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(aba.webSocketDebuggerUrl);
  await new Promise((resolver, rejeitar) => {
    ws.addEventListener('open', resolver, { once: true });
    ws.addEventListener('error', rejeitar, { once: true });
  });
  cdp = new Cdp(ws);
  cdp.ao('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') errosConsole.push(p.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  });
  cdp.ao('Runtime.exceptionThrown', (p) => {
    excecoes.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'exceção');
  });
  cdp.ao('Network.responseReceived', (p) => {
    if (p.response.status >= 400) redeComErro.push(`${p.response.status} ${p.response.url.replace(base, '')}`);
  });

  await cdp.enviar('Page.enable');
  await cdp.enviar('Runtime.enable');
  await cdp.enviar('Network.enable');
  await cdp.enviar('Emulation.setDeviceMetricsOverride', { width: 414, height: 896, deviceScaleFactor: 2, mobile: true });

  let nonce = 0;
  const avaliar = async (expressao) => {
    const resultado = await cdp.enviar('Runtime.evaluate', { expression: expressao, returnByValue: true, awaitPromise: true });
    if (resultado.exceptionDetails) throw new Error(resultado.exceptionDetails.exception?.description ?? 'erro ao avaliar');
    return resultado.result.value;
  };

  async function usarSessao(cookie) {
    await cdp.enviar('Network.clearBrowserCookies');
    const [nome, valor] = cookie.split('=');
    await cdp.enviar('Network.setCookie', { name: nome, value: valor, url: `${base}/`, path: '/' });
  }

  async function abrir(rota, esperaMs = 1800) {
    nonce += 1;
    const antes = { console: errosConsole.length, excecoes: excecoes.length };
    await cdp.enviar('Page.navigate', { url: `${base}/?n=${nonce}#${rota}` });
    await esperar(esperaMs);
    return {
      texto: await avaliar('document.body.innerText'),
      errosNovos: errosConsole.slice(antes.console),
      excecoesNovas: excecoes.slice(antes.excecoes),
    };
  }

  /** Clica no primeiro botão/aba cujo texto começa com o informado. */
  async function clicar(texto) {
    return avaliar(`(() => {
      const alvo = Array.from(document.querySelectorAll('button, a, [role="tab"]'))
        .find((e) => e.innerText.trim().toLowerCase().startsWith(${JSON.stringify(texto.toLowerCase())}));
      if (!alvo) return false;
      alvo.click();
      return true;
    })()`);
  }

  async function preencher(seletor, valor, indice = 0) {
    return avaliar(`(() => {
      const el = document.querySelectorAll(${JSON.stringify(seletor)})[${indice}];
      if (!el) return false;
      el.focus();
      el.value = ${JSON.stringify(valor)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }

  const modal = () => avaliar("document.querySelector('.modal') ? document.querySelector('.modal').innerText : ''");

  /* --------------------------------- Admin -------------------------------- */

  titulo('Aba Inventário (admin)');
  await usarSessao(cookieAdmin);
  let tela = await abrir('/inventario', 2000);
  ok(/Inventário/i.test(tela.texto), 'rota #/inventario abre a página');
  const menuAdmin = await avaliar(
    "Array.from(document.querySelectorAll('a, button')).map((e) => e.innerText.trim()).filter(Boolean).join(' | ')",
  );
  ok(/Inventário/i.test(menuAdmin), 'menu do admin mostra a aba Inventário', menuAdmin.slice(0, 140));
  ok(/Inventário vazio|Nenhuma peça/i.test(tela.texto), 'estado vazio da lista de peças');
  ok(tela.errosNovos.length === 0, 'página abre sem erro de console', tela.errosNovos.join(' | '));
  ok(tela.excecoesNovas.length === 0, 'página abre sem exceção', tela.excecoesNovas.join(' | '));

  titulo('CRUD de fornecedor pela interface');
  ok(await clicar('Fornecedores'), 'aba Fornecedores acessível');
  await esperar(400);
  ok(await clicar('Novo fornecedor'), 'botão "Novo fornecedor" abre o modal');
  await esperar(400);
  await preencher('.modal input', 'Astro Distribuidora', 0);
  await preencher('.modal input', '(11) 98888-7777', 1);
  await preencher('.modal textarea', 'Entrega em 2 dias úteis', 0);
  await avaliar("document.querySelector('.modal form').requestSubmit()");
  await esperar(1400);
  tela = { texto: await avaliar('document.body.innerText') };
  ok(tela.texto.includes('Astro Distribuidora'), 'fornecedor aparece na lista depois de salvar');
  ok(!(await modal()), 'modal fecha após salvar');

  titulo('CRUD de peça pela interface');
  ok(await clicar('Peças'), 'aba Peças acessível');
  await esperar(400);
  ok(await clicar('Nova peça'), 'botão "Nova peça" abre o modal');
  await esperar(400);
  await preencher('.modal input', 'Tela iPhone 13', 0);
  await preencher('.modal input', 'iPhone 13', 1);
  await preencher('.modal input', '600,00', 2);
  await preencher('.modal input', '2', 3);
  await avaliar(`(() => {
    const select = document.querySelector('.modal select');
    select.selectedIndex = 1;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await avaliar("document.querySelector('.modal form').requestSubmit()");
  await esperar(1500);
  const listaPecas = await avaliar("document.body.innerText");
  ok(listaPecas.includes('Tela iPhone 13'), 'peça cadastrada aparece na listagem');
  ok(listaPecas.includes('R$') && listaPecas.includes('600,00'), 'preço formatado em R$ brasileiro', listaPecas.slice(0, 200));
  ok(listaPecas.includes('2 un.'), 'estoque exibido na listagem');
  ok(listaPecas.includes('Astro Distribuidora'), 'fornecedor vinculado exibido na peça');
  ok(/valor em estoque/i.test(listaPecas), 'resumo do valor em estoque presente');

  titulo('Validação no frontend');
  ok(await clicar('Nova peça'), 'modal reabre');
  await esperar(400);
  await preencher('.modal input', 'Peça sem preço', 0);
  await avaliar('document.querySelector(".modal form").requestSubmit()');
  await esperar(700);
  const erroModal = await modal();
  ok(/Revise os dados/i.test(erroModal) && /preço de custo/i.test(erroModal), 'frontend bloqueia peça sem preço', erroModal.slice(0, 160));
  ok(await avaliar("document.querySelector('.modal__fechar').click() || true"), 'modal de validação fechado');
  await esperar(300);

  /* ----------------------- Conclusão de OS com peça ----------------------- */

  titulo('Conclusão de OS com peça do inventário (modal real)');
  const lojas = await api('GET', '/api/lojas', cookieAdmin);
  const lojaId = lojas.dados.lojas.find((l) => l.ativo).id;
  const criada = await api('POST', '/api/ordens', cookieAdmin, {
    lojaId,
    clienteNome: 'Cliente Inventário UI',
    clienteTelefone: '11977776666',
    marca: 'Apple',
    modelo: 'iPhone 13',
    defeitoRelatado: 'Tela quebrada',
    valorEstimado: 900,
  });
  ok(criada.status === 201, 'OS de teste criada via API', String(criada.status));
  const osId = criada.dados.ordem.id;

  await abrir(`/ordens/${osId}`, 2000);
  await avaliar("Array.from(document.querySelectorAll('button')).find((e) => /finalizar/i.test(e.innerText))?.click() ?? true");
  await esperar(900);
  let textoModal = await modal();
  ok(/Foi usada alguma peça do inventário/i.test(textoModal), 'modal de conclusão pergunta sobre peças do inventário');
  ok(/Sim/.test(textoModal) && /Não/.test(textoModal), 'opções Sim / Não presentes');

  await avaliar(
    "Array.from(document.querySelectorAll('.modal button')).find((e) => e.innerText.trim() === 'Sim')?.click() ?? true",
  );
  await esperar(1200);
  const opcoesPeca = await avaliar(
    "Array.from(document.querySelectorAll('.modal select option')).map((o) => o.textContent.trim())",
  );
  ok(opcoesPeca.some((o) => /Tela iPhone 13/.test(o)), 'peças disponíveis carregam no seletor', opcoesPeca.join(' | ').slice(0, 160));
  ok(opcoesPeca.some((o) => /Astro Distribuidora/.test(o)), 'fornecedor puxado automaticamente na opção');
  ok(opcoesPeca.some((o) => o.includes('600,00')), 'preço de custo aparece na opção');

  ok(await clicar('Adicionar peça'), 'botão "Adicionar peça" funciona');
  await esperar(500);
  textoModal = await modal();
  ok(/1× Tela iPhone 13|1x Tela iPhone 13/i.test(textoModal), 'peça entra na lista de consumo', textoModal.slice(0, 200));
  ok(/Custo das peças/i.test(textoModal), 'total do custo das peças exibido');

  await preencher('.modal textarea', 'Troca de tela homologada', 0);
  await avaliar("document.querySelector('.modal form').requestSubmit()");
  await esperar(2200);
  const detalhe = await api('GET', `/api/ordens/${osId}`, cookieAdmin);
  ok(detalhe.dados.ordem?.status === 'pronto', 'OS concluída pela interface', detalhe.dados.ordem?.status);
  ok((detalhe.dados.pecasInventario ?? []).length === 1, 'servidor registrou a peça usada');
  const usada = detalhe.dados.pecasInventario?.[0] ?? {};
  ok(Number(usada.preco_unitario) === 600, 'preço congelado no snapshot', String(usada.preco_unitario));
  ok(usada.fornecedor_nome === 'Astro Distribuidora', 'fornecedor no snapshot', usada.fornecedor_nome);
  ok(Boolean(usada.loja_nome), 'loja de destino no snapshot', usada.loja_nome);
  ok(Boolean(usada.modelo_aparelho), 'modelo do aparelho no snapshot', usada.modelo_aparelho);

  tela = await abrir(`/ordens/${osId}`, 2200);
  ok(/Peças do inventário/i.test(tela.texto), 'OS mostra o card "Peças do inventário"');
  ok(tela.texto.includes('600,00'), 'valor da peça na OS');

  const pecaDepois = await api('GET', '/api/inventario/pecas?disponiveis=1', cookieAdmin);
  ok(
    pecaDepois.dados.pecas.some((p) => p.nome === 'Tela iPhone 13' && p.quantidade_estoque === 1),
    'baixa de estoque refletida na listagem',
  );

  /* --------------------------------- Painel ------------------------------- */

  titulo('Painel e relatório do admin');
  tela = await abrir('/painel', 2600);
  ok(/Gastos com peças por fornecedor/i.test(tela.texto), 'painel mostra o card de gastos por fornecedor');
  ok(/Astro Distribuidora/.test(tela.texto), 'card lista o fornecedor');
  ok(/Total geral gasto com peças/i.test(tela.texto), 'card mostra o total geral');
  const filtroFornecedor = await avaliar(
    "Array.from(document.querySelectorAll('label, .campo__rotulo')).some((e) => /Fornecedor/i.test(e.innerText))",
  );
  ok(filtroFornecedor, 'filtro por fornecedor disponível no painel');

  // O relatório é desenhado em canvas e embutido no PDF como imagem: para
  // conferir o conteúdo, registramos cada texto desenhado e o Blob final.
  await avaliar(`(() => {
    window.__pdfs = [];
    window.__textosPdf = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = (blob) => {
      window.__pdfs.push(blob);
      return original.call(URL, blob);
    };
    const proto = CanvasRenderingContext2D.prototype;
    const fill = proto.fillText;
    proto.fillText = function (texto, ...resto) {
      window.__textosPdf.push(String(texto));
      return fill.call(this, texto, ...resto);
    };
    const stroke = proto.strokeText;
    proto.strokeText = function (texto, ...resto) {
      window.__textosPdf.push(String(texto));
      return stroke.call(this, texto, ...resto);
    };
    return true;
  })()`);

  const erroRelatorio = await avaliar(`(async () => {
    const botao = Array.from(document.querySelectorAll('button')).find((e) => /relatório|pdf/i.test(e.innerText));
    if (!botao) return 'sem botão de relatório';
    botao.click();
    await new Promise((r) => setTimeout(r, 3000));
    return '';
  })()`);
  ok(!erroRelatorio, 'geração do relatório em PDF dispara sem erro', erroRelatorio);

  const tamanhoPdf = await avaliar(`(async () => {
    const blob = window.__pdfs[0];
    if (!blob) return 0;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    window.__pdfInicio = String.fromCharCode(...bytes.slice(0, 8));
    const bruto = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    window.__pdfPaginas = bruto.split('/Type /Page').length - 1;
    return bytes.length;
  })()`);
  const inicioPdf = await avaliar('window.__pdfInicio || ""');
  const paginasPdf = await avaliar('window.__pdfPaginas || 0');
  const textosPdf = await avaliar('window.__textosPdf.join(" | ")');

  ok(tamanhoPdf > 1000, 'PDF gerado com conteúdo', String(tamanhoPdf));
  ok(inicioPdf.startsWith('%PDF'), 'arquivo começa com %PDF');
  ok(paginasPdf >= 1, 'PDF tem ao menos uma página', String(paginasPdf));
  ok(/Gastos com peças por fornecedor/i.test(textosPdf), 'seção "Gastos com peças por fornecedor" desenhada', textosPdf.slice(-260));
  ok(/Astro Distribuidora/.test(textosPdf), 'fornecedor aparece no relatório');
  ok(/Tela iPhone 13/.test(textosPdf), 'peça aparece no relatório');
  ok(/Modelo/.test(textosPdf) && /Loja de destino/.test(textosPdf), 'cabeçalho Fornecedor/Peça/Modelo/Loja/Preço presente');
  ok(/Subtotal/i.test(textosPdf), 'subtotal por fornecedor presente');
  ok(/Total gasto por loja|Loja /i.test(textosPdf), 'total por loja presente');
  ok(/Total geral/i.test(textosPdf), 'total geral presente');
  ok(/600,00/.test(textosPdf), 'valores em R$ brasileiro no relatório');

  /* -------------------------------- Técnico ------------------------------- */

  titulo('Bloqueio para técnico');
  await usarSessao(cookieTecnico);
  tela = await abrir('/inventario', 2200);
  ok(!/Nova peça|Novo fornecedor|Inventário vazio/i.test(tela.texto), 'técnico não acessa o conteúdo do inventário', tela.texto.slice(0, 120));
  ok(/restrit|permiss|Painel/i.test(tela.texto), 'rota protegida informa o bloqueio ou volta ao painel', tela.texto.slice(0, 120));
  ok(!/Nova peça|Novo fornecedor/i.test(tela.texto), 'técnico não vê os botões de cadastro');
  const menuTecnico = await avaliar(
    "Array.from(document.querySelectorAll('a, button')).map((e) => e.innerText.trim()).filter(Boolean).join(' | ')",
  );
  ok(!/Inventário/i.test(menuTecnico), 'menu do técnico não tem a aba Inventário', menuTecnico.slice(0, 140));
  ok(tela.errosNovos.length === 0, 'rota bloqueada não gera erro de console', tela.errosNovos.join(' | '));

  const gastosTecnico = await api('GET', '/api/inventario/gastos', cookieTecnico);
  ok(gastosTecnico.status === 403, 'API de gastos bloqueada para técnico', String(gastosTecnico.status));

  titulo('Exclusão administrativa da OS');
  const exclusao = await api('DELETE', `/api/ordens/${osId}`, cookieAdmin);
  ok(exclusao.status === 200, 'admin exclui a OS mesmo com peças no histórico', `${exclusao.status} ${JSON.stringify(exclusao.dados).slice(0, 140)}`);
  const hoje = new Date().toISOString().slice(0, 10);
  const gastosApos = await api('GET', `/api/inventario/gastos?de=${hoje}&ate=${hoje}`, cookieAdmin);
  ok(
    Math.abs((gastosApos.dados.gastos?.totalGeral ?? 0)) < 0.01,
    'os gastos deixam de contar a OS excluída',
    String(gastosApos.dados.gastos?.totalGeral),
  );

  titulo('Consolidação');
  const inesperados = redeComErro.filter(
    (linha) => !/^401 \/api\/auth\/me$|^403 \/api\/inventario/.test(linha),
  );
  ok(inesperados.length === 0, 'nenhuma resposta HTTP inesperada', inesperados.join(' | '));
  ok(excecoes.length === 0, 'nenhuma exceção não tratada', excecoes.slice(0, 3).join(' | '));
  ok(
    errosConsole.filter((m) => !/Failed to load resource.*403|status of 403/i.test(m)).length === 0,
    'nenhum erro de console inesperado',
    errosConsole.slice(0, 3).join(' | '),
  );

  console.log('\n────────────────────────────────────────────────────');
  console.log(`  ${passos - falhas}/${passos} verificações passaram`);
  console.log('────────────────────────────────────────────────────');
  process.exitCode = falhas ? 1 : 0;
} catch (erro) {
  console.error('\nFalha inesperada: ' + (erro?.stack ?? erro));
  process.exitCode = 1;
} finally {
  try {
    cdp?.ws?.close();
  } catch {
    /* ignore */
  }
  navegador?.kill();
  servidor?.kill();
  await esperar(300);
  try {
    fs.rmSync(dirTemp, { recursive: true, force: true });
  } catch {
    /* perfil do Chrome pode ficar travado por alguns segundos */
  }
}
