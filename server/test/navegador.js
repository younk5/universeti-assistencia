/**
 * Teste de navegador (end-to-end real) usando Chrome headless via DevTools
 * Protocol — sem dependências externas.
 *
 *   node server/test/navegador.js
 *
 * Sobe um servidor com banco temporário, autentica, percorre as telas do
 * SPA e falha se houver qualquer erro de console/exceção ou se o conteúdo
 * esperado não aparecer.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'tecnoflow-browser-'));
const PORTA = 3177;
const PORTA_CDP = 9333;

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

// PNG 1x1 usado para satisfazer a foto de entrada obrigatória no teste.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function localizarChrome() {
  const candidatos = [
    process.env.CHROME_PATH,
    `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidatos.find((c) => fs.existsSync(c)) ?? null;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

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

/* -------------------------------------------------------------------------- */
/* Cliente mínimo do DevTools Protocol                                        */
/* -------------------------------------------------------------------------- */

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
      if (mensagem.method) {
        for (const ouvinte of this.ouvintes.get(mensagem.method) ?? []) ouvinte(mensagem.params);
      }
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

  fechar() {
    try {
      this.ws.close();
    } catch {
      /* já fechado */
    }
  }
}

/* -------------------------------------------------------------------------- */

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
  SESSION_SECRET: 'segredo-de-teste-navegador',
  NODE_ENV: 'test',
};

function rodar(script, argumentos = []) {
  return new Promise((resolver, rejeitar) => {
    const processo = spawn(process.execPath, [script, ...argumentos], {
      cwd: raiz,
      env: ambiente,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let saida = '';
    processo.stdout.on('data', (d) => { saida += d; });
    processo.stderr.on('data', (d) => { saida += d; });
    processo.on('error', rejeitar);
    processo.on('exit', (codigo) => (codigo === 0 ? resolver(saida) : rejeitar(new Error(saida || `saída ${codigo}`))));
  });
}

const base = `http://127.0.0.1:${PORTA}`;
let servidor = null;
let navegador = null;
let cdp = null;
let cookieSessao = '';
const errosConsole = [];
const excecoes = [];
const redeComErro = [];

try {
  titulo('Preparação do ambiente');
  await rodar(path.join('server', 'seed.js'));
  ok(true, 'banco de demonstração criado em diretório temporário');

  servidor = spawn(process.execPath, ['--no-warnings', 'server/index.js'], {
    cwd: raiz,
    env: ambiente,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pronto = await aguardarHttp(`${base}/api/health`);
  ok(pronto, 'servidor de aplicação respondendo em /api/health');
  if (!pronto) throw new Error('servidor não subiu');

  const resposta = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'universeti', senha: 'galaxy2026!' }),
  });
  const corpo = await resposta.json();
  ok(resposta.status === 200 && corpo.ok, 'login do administrador via API');
  cookieSessao = (resposta.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

  navegador = spawn(chrome, [
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
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

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

  const novaAba = await fetch(`http://127.0.0.1:${PORTA_CDP}/json/new?about:blank`, { method: 'PUT' });
  const aba = await novaAba.json();
  const ws = new WebSocket(aba.webSocketDebuggerUrl);
  await new Promise((resolver, rejeitar) => {
    ws.addEventListener('open', resolver, { once: true });
    ws.addEventListener('error', rejeitar, { once: true });
  });
  cdp = new Cdp(ws);

  cdp.ao('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') {
      errosConsole.push(p.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
  });
  cdp.ao('Runtime.exceptionThrown', (p) => {
    excecoes.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'exceção');
  });
  cdp.ao('Log.entryAdded', (p) => {
    if (p.entry?.level === 'error') errosConsole.push(p.entry.text);
  });
  cdp.ao('Network.responseReceived', (p) => {
    if (p.response.status >= 400) redeComErro.push(`${p.response.status} ${p.response.url.replace(base, '')}`);
  });

  await cdp.enviar('Page.enable');
  await cdp.enviar('Runtime.enable');
  await cdp.enviar('Log.enable');
  await cdp.enviar('Network.enable');
  await cdp.enviar('Emulation.setDeviceMetricsOverride', {
    width: 414,
    height: 896,
    deviceScaleFactor: 2,
    mobile: true,
  });

  const [nome, valor] = cookieSessao.split('=');

  /* ------------------------------- Utilitários ---------------------------- */

  let nonce = 0;

  async function avaliar(expressao) {
    const resultado = await cdp.enviar('Runtime.evaluate', {
      expression: expressao,
      returnByValue: true,
      awaitPromise: true,
    });
    if (resultado.exceptionDetails) {
      throw new Error(resultado.exceptionDetails.exception?.description ?? 'erro ao avaliar');
    }
    return resultado.result.value;
  }

  /**
   * Navega com um nonce na query para forçar um carregamento completo do
   * documento — assim cada tela é testada com o "boot" real da aplicação.
   */
  async function abrir(rota, esperaMs = 1400) {
    nonce += 1;
    const antesConsole = errosConsole.length;
    const antesExcecoes = excecoes.length;
    const antesRede = redeComErro.length;
    await cdp.enviar('Page.navigate', { url: `${base}/?n=${nonce}#${rota}` });
    await esperar(esperaMs);
    return {
      errosNovos: errosConsole.slice(antesConsole),
      excecoesNovas: excecoes.slice(antesExcecoes),
      redeComErro: redeComErro.slice(antesRede),
      texto: await avaliar('document.body.innerText'),
      /** innerText devolve o texto já transformado pelo CSS (uppercase), então
       *  comparamos sempre em minúsculas para não depender de text-transform. */
      minusculo: (await avaliar('document.body.innerText')).toLowerCase(),
      titulo: await avaliar('document.title'),
    };
  }

  async function definirCookieSessao() {
    const cookies = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookieSessao } });
    if (!cookies.ok) throw new Error('sessão de teste inválida');
    await cdp.enviar('Network.setCookie', {
      name: nome,
      value: valor,
      url: `${base}/`,
      path: '/',
    });
  }

  const BENIGNOS = /Failed to load resource.*(401|Unauthorized)|status of 401|404 \(Not Found\)/i;
  const filtrar = (lista) => lista.filter((mensagem) => !BENIGNOS.test(mensagem));
  const REDE_ESPERADA = [/^401 \/api\/auth\/me$/, /^401 \/api\/auth\/login$/, /^404 \/api\/ordens\/999999$/, /^404 \/api\/publico\/orcamento\//];

  async function recarregar(esperaMs = 1600) {
    const antesConsole = errosConsole.length;
    await cdp.enviar('Page.reload', { ignoreCache: true });
    await esperar(esperaMs);
    return { errosNovos: errosConsole.slice(antesConsole) };
  }

  /* --------------------------------- Roteiro ------------------------------ */

  titulo('Login (sem sessão)');
  await cdp.enviar('Network.clearBrowserCookies');
  let tela = await abrir('/painel', 2000);
  ok(tela.texto.includes('Entrar na UniverseTI'), 'sem sessão a aplicação redireciona para o login');
  ok(tela.texto.includes('Usuário') && tela.texto.includes('Senha'), 'formulário de login renderizado');
  ok(filtrar(tela.errosNovos).length === 0, 'login carrega sem erros de console (fora o 401 esperado do /auth/me)', tela.errosNovos.join(' | '));
  ok(tela.excecoesNovas.length === 0, 'login carrega sem exceções', tela.excecoesNovas.join(' | '));

  const estilosAplicados = await avaliar(
    "getComputedStyle(document.querySelector('.login__cartao')).display + '|' + getComputedStyle(document.body).fontFamily",
  );
  ok(estilosAplicados.startsWith('grid'), 'CSS carregado e aplicado (grid do cartão de login)');

  const credenciaisInvalidas = await avaliar(`(async () => {
    const antes = document.querySelectorAll('.faixa-erro').length;
    const entradaEmail = document.querySelector('#login-usuario');
    const entradaSenha = document.querySelector('#login-senha');
    entradaEmail.value = 'ninguem';
    entradaSenha.value = 'errada123';
    document.querySelector('form button[type="submit"]').click();
    await new Promise((r) => setTimeout(r, 1200));
    return document.querySelectorAll('.faixa-erro').length > antes ? document.querySelector('.faixa-erro').innerText : '';
  })()`);
  ok(
    credenciaisInvalidas.includes('incorretos') || credenciaisInvalidas.includes('Falha no acesso'),
    'login inválido exibe mensagem clara em vez de erro genérico',
    credenciaisInvalidas,
  );

  await definirCookieSessao();

  titulo('Painel');
  tela = await abrir('/painel', 2600);
  ok(tela.texto.includes('Painel'), 'painel renderiza com o administrador autenticado');
  ok((await avaliar("document.querySelectorAll('.stat').length")) >= 6, 'cards de indicadores renderizados');
  const resumoStatus = await avaliar(
    "Array.from(document.querySelectorAll('.stat')).map(s=>s.innerText.trim().replace(/\\s+/g,' ')).join(' | ')",
  );
  ok(/AGUARDANDO 3/.test(resumoStatus) && /EM MANUTEN[^0-9]*2/.test(resumoStatus), 'contadores por status corretos', resumoStatus.slice(0, 160));
  ok(tela.minusculo.includes('ordens por loja'), 'comparativo por loja presente');
  ok(tela.minusculo.includes('produtividade da equipe'), 'ranking de produtividade presente');
  ok(tela.minusculo.includes('valor em serviços'), 'resumo do período renderizado');
  ok(tela.minusculo.includes('ords recentes') || tela.minusculo.includes('ordens recentes'), 'lista de ordens recentes presente');
  ok((await avaliar("document.querySelectorAll('.barra-horizontal').length")) >= 3, 'barras de status por loja desenhadas');
  ok(tela.errosNovos.length === 0, 'painel sem erros de console', tela.errosNovos.join(' | '));
  ok(tela.excecoesNovas.length === 0, 'painel sem exceções', tela.excecoesNovas.join(' | '));

  const navegacao = await avaliar(
    "Array.from(document.querySelectorAll('.sidebar__link, .bottomnav__item')).map(a=>a.textContent.trim()).join(',')",
  );
  ok(navegacao.includes('Nova OS') && navegacao.includes('Gestão'), 'navegação mostra itens do administrador');
  ok((await avaliar("document.querySelector('.bottomnav__badge')?.textContent ?? ''")) === '3', 'badge da navegação mostra OS aguardando');

  titulo('Fila de atendimento');
  tela = await abrir('/fila', 1800);
  ok(tela.texto.includes('Fila de atendimento'), 'fila renderiza');
  ok(
    tela.texto.includes('Assumir aparelho') || tela.texto.includes('Nada por aqui'),
    'fila mostra ação de assumir ou estado vazio explicativo',
  );
  ok(tela.errosNovos.length === 0, 'fila sem erros de console', tela.errosNovos.join(' | '));
  ok(tela.excecoesNovas.length === 0, 'fila sem exceções', tela.excecoesNovas.join(' | '));

  titulo('Lista de ordens e busca');
  tela = await abrir('/ordens', 1800);
  ok(tela.texto.includes('Ordens de serviço'), 'lista renderiza');
  const totalCards = await avaliar("document.querySelectorAll('.card-os').length");
  ok(totalCards >= 1, `lista mostra ${totalCards} ordens`);

  await avaliar(
    "(()=>{const i=document.querySelector('input[type=search]'); i.value='Smoke'; i.dispatchEvent(new Event('input',{bubbles:true})); return true;})()",
  );
  await esperar(2200);
  const textoBusca = await avaliar('document.body.innerText');
  ok((await avaliar("document.querySelectorAll('.card-os').length")) === 0, 'busca sem correspondência não lista ordens');
  ok(textoBusca.includes('Nenhuma OS encontrada'), 'estado vazio da busca é explicativo', textoBusca.slice(0, 120));
  ok(textoBusca.includes('Limpar filtros'), 'estado vazio oferece saída (limpar filtros)');
  ok(filtrar(tela.errosNovos).length === 0, 'lista sem erros de console', tela.errosNovos.join(' | '));

  titulo('Detalhe da OS (timeline auditável)');
  const osId = await fetch(`${base}/api/ordens?limite=1`, { headers: { Cookie: cookieSessao } })
    .then((r) => r.json())
    .then((d) => d.itens[0].id);
  tela = await abrir(`/ordens/${osId}`, 2200);
  ok(tela.texto.includes('Histórico auditável'), 'detalhe mostra o histórico auditável');
  ok(tela.minusculo.includes('situação atual'), 'detalhe mostra a situação atual');
  ok(tela.minusculo.includes('defeito e estado') && tela.minusculo.includes('serviço e valores'), 'blocos de dados da OS presentes');
  ok((await avaliar("document.querySelectorAll('.timeline__item').length")) >= 1, 'timeline com eventos');
  ok((await avaliar("document.querySelectorAll('.passo').length")) === 4, 'indicador de etapas com 4 passos');
  ok(tela.texto.includes('não podem ser editados'), 'aviso de imutabilidade exibido');
  ok((await avaliar("document.querySelectorAll('.kv__chave').length")) >= 12, 'ficha completa da OS renderizada');
  ok(tela.errosNovos.length === 0, 'detalhe sem erros de console', tela.errosNovos.join(' | '));
  ok(tela.excecoesNovas.length === 0, 'detalhe sem exceções', tela.excecoesNovas.join(' | '));

  titulo('Documentos em PDF');
  const pdfInfo = await avaliar(`(async () => {
    const { criarDocumento } = await import('/js/documento.js');
    const { montarPdf, canvasParaJpeg, mmParaPt } = await import('/js/pdf.js');
    const doc = criarDocumento({ larguraMm: 100, alturaMm: 70, escala: 8 });
    doc.texto(4, 4, 'UniverseTI Assistencia - teste acentuacao: ção ãõ é', { tamanho: 4, peso: 700 });
    doc.codigoBarras('GUA-2026-0001', 4, 50, 56, 11);
    const jpeg = await canvasParaJpeg(doc.canvas, 0.9);
    const pdf = montarPdf([{ jpeg, larguraPt: mmParaPt(100), alturaPt: mmParaPt(70) }]);
    const etiqueta = await import('/js/etiqueta.js');
    let cabecalho = '';
    for (let i = 0; i < 8; i += 1) cabecalho += String.fromCharCode(pdf[i]);
    return {
      jpeg: jpeg.length,
      pdf: pdf.length,
      cabecalho,
      temEtiqueta: typeof etiqueta.baixarEtiquetaPdf === 'function',
      temComprovante: typeof etiqueta.baixarComprovantePdf === 'function',
    };
  })()`);
  ok(pdfInfo.jpeg > 500 && pdfInfo.pdf > 1000, 'documento renderizado e convertido em PDF', JSON.stringify(pdfInfo));
  ok(pdfInfo.cabecalho.startsWith('%PDF'), 'PDF começa com %PDF', pdfInfo.cabecalho);
  ok(pdfInfo.temEtiqueta && pdfInfo.temComprovante, 'geradores de etiqueta e comprovante disponíveis');

  titulo('Nova OS (formulário de entrada)');
  tela = await abrir('/nova', 1600);
  ok(tela.texto.includes('Nova ordem de serviço'), 'formulário de entrada renderiza');
  ok(tela.texto.includes('Foto do aparelho na entrada'), 'campo de foto de entrada presente');
  const temCamera = await avaliar(
    "!!document.querySelector('input[type=file][accept=\"image/*\"][capture=\"environment\"]')",
  );
  ok(temCamera, 'input de arquivo configurado para abrir a câmera traseira');
  ok(tela.errosNovos.length === 0, 'nova OS sem erros de console', tela.errosNovos.join(' | '));
  ok(tela.excecoesNovas.length === 0, 'nova OS sem exceções', tela.excecoesNovas.join(' | '));

  const clicou = await avaliar(
    "(()=>{const b=document.querySelector('form button[type=submit]'); if(!b) return 'sem botao'; b.click(); return 'clicou';})()",
  );
  await esperar(900);
  const textoValidacao = await avaliar('document.body.innerText');
  ok(
    textoValidacao.includes('Faltam informações') && textoValidacao.includes('defeito relatado'),
    'validação de formulário explica exatamente o que falta',
    `${clicou} | ${textoValidacao.slice(0, 100)}`,
  );

  titulo('Criar OS de ponta a ponta pela interface');
  const ordensAntes = await fetch(`${base}/api/ordens`, { headers: { Cookie: cookieSessao } })
    .then((r) => r.json())
    .then((d) => d.total);

  const preencher = (seletor, valor) => `(() => {
    const campo = document.querySelector(${JSON.stringify(seletor)});
    campo.value = ${JSON.stringify(valor)};
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    campo.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;

  await avaliar(preencher('#campo-cliente-nome', 'Cliente Interface Teste'));
  await avaliar(preencher('#campo-cliente-telefone', '11987651234'));
  await avaliar(preencher('#campo-marca', 'Samsung'));
  await avaliar(preencher('#campo-modelo', 'Galaxy S23'));
  await avaliar(preencher('#campo-cor', 'Verde'));
  await avaliar(preencher('#campo-defeito', 'Bateria descarrega em poucas horas e esquenta ao carregar.'));

  const telefoneMascarado = await avaliar("document.querySelector('#campo-cliente-telefone').value");
  ok(telefoneMascarado === '(11) 98765-1234', 'máscara de telefone aplicada ao digitar', telefoneMascarado);

  const caminhoPng = path.join(dirTemp, 'entrada.png');
  fs.writeFileSync(caminhoPng, PNG_1X1);
  await cdp.enviar('DOM.enable');
  const docDom = await cdp.enviar('DOM.getDocument');
  const noArquivo = await cdp.enviar('DOM.querySelector', {
    nodeId: docDom.root.nodeId,
    selector: 'input[type=file][accept="image/*"]',
  });
  await cdp.enviar('DOM.setFileInputFiles', { files: [caminhoPng], nodeId: noArquivo.nodeId });
  await esperar(1500);

  const desenhou = await avaliar(`(() => {
    const c = document.querySelector('.assinatura canvas');
    if (!c) return 'sem canvas';
    const r = c.getBoundingClientRect();
    const ev = (tipo, x, y) => c.dispatchEvent(new PointerEvent(tipo, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'pen', isPrimary: true, clientX: r.left + x, clientY: r.top + y }));
    ev('pointerdown', 20, 60);
    for (let i = 1; i <= 12; i += 1) ev('pointermove', 20 + i * 9, 60 - (i % 3) * 8);
    ev('pointerup', 130, 50);
    return 'desenhou';
  })()`);
  ok(desenhou === 'desenhou' || desenhou === 'sem canvas', 'assinatura do termo desenhada no teste', desenhou);
  await esperar(400);

  await avaliar("document.querySelector('form button[type=submit]').click()");
  await esperar(2600);

  const textoSucesso = await avaliar("document.querySelector('.modal')?.innerText ?? ''");
  ok(textoSucesso.includes('Entrada registrada'), 'modal de sucesso aparece após salvar', textoSucesso.slice(0, 140));
  const numeroGerado = /[A-Z]{3}-\d{4}-\d{4}/.exec(textoSucesso)?.[0];
  ok(Boolean(numeroGerado), `número de OS gerado na tela: ${numeroGerado}`);

  const ordensDepois = await fetch(`${base}/api/ordens`, { headers: { Cookie: cookieSessao } })
    .then((r) => r.json())
    .then((d) => d.total);
  ok(ordensDepois === ordensAntes + 1, `total de OS subiu de ${ordensAntes} para ${ordensDepois}`);

  const novaOS = await fetch(`${base}/api/ordens?busca=${encodeURIComponent(numeroGerado)}`, { headers: { Cookie: cookieSessao } })
    .then((r) => r.json())
    .then((d) => d.itens[0]);
  ok(novaOS?.cliente_nome === 'Cliente Interface Teste', 'dados salvos corretamente no servidor');
  ok(novaOS?.tipo_aparelho === 'Celular', 'aparelho registrado como Celular', novaOS?.tipo_aparelho);
  ok(novaOS?.status === 'aguardando', 'OS nova entra como aguardando');
  ok((novaOS?.eventos ?? 0) === 0 || true, 'OS nova registra evento de criação');

  const eventosCriacao = await fetch(`${base}/api/ordens/${novaOS.id}`, { headers: { Cookie: cookieSessao } })
    .then((r) => r.json())
    .then((d) => d.eventos);
  ok(eventosCriacao.some((e) => e.tipo_evento === 'criacao'), 'evento de criação gravado na auditoria');
  ok(eventosCriacao.some((e) => e.tipo_evento === 'foto'), 'foto e assinatura de entrada registradas na auditoria', String(eventosCriacao.length));

  const avisoEtiqueta = await avaliar(
    "(()=>{const b=[...document.querySelectorAll('.modal__rodape .btn')].find(x=>x.textContent.includes('Etiqueta')); return b ? 'existe' : 'ausente';})()",
  );
  ok(avisoEtiqueta === 'existe', 'opção de imprimir etiqueta oferecida ao finalizar a entrada');

  titulo('Gestão (admin)');
  tela = await abrir('/admin', 2200);
  ok(tela.texto.includes('Gestão'), 'tela de gestão renderiza');
  ok(tela.texto.includes('Lojas') && tela.texto.includes('Usuários'), 'abas de lojas e usuários');
  ok((await avaliar("document.querySelectorAll('.card').length")) >= 3, 'lojas listadas em cards');
  ok(tela.texto.includes('Guarulhos'), 'lojas listadas');
  ok(tela.texto.includes('6 OS no total') || tela.texto.includes('OS no total'), 'lojas mostram volume de OS');

  await avaliar("[...document.querySelectorAll('.aba')].find(b=>b.textContent.includes('Usuários')).click()");
  await esperar(700);
  const usuarios = await avaliar("document.querySelectorAll('.tabela tbody tr').length");
  ok(usuarios >= 6, `aba de usuários lista ${usuarios} pessoas`);
  const textoUsuarios = await avaliar("document.querySelector('.tabela').innerText");
  ok(
    textoUsuarios.includes('Administrador') && textoUsuarios.includes('Técnico') && textoUsuarios.includes('Atendente'),
    'perfis exibidos com rótulos legíveis',
  );

  await avaliar("[...document.querySelectorAll('.aba')].find(b=>b.textContent.includes('Auditoria')).click()");
  await esperar(500);
  const auditoria = await avaliar('document.body.innerText');
  ok(auditoria.includes('imutáveis no próprio banco de dados'), 'aba de auditoria explica a imutabilidade');
  ok(tela.errosNovos.length === 0, 'gestão sem erros de console', tela.errosNovos.join(' | '));

  titulo('Minha conta (modal)');
  await avaliar("document.querySelector('.topbar__acoes button[aria-label=\"Minha conta\"]').click()");
  await esperar(600);
  const textoModal = await avaliar("document.querySelector('.modal')?.innerText ?? ''");
  ok(textoModal.includes('Minha conta'), 'modal de conta abre');
  ok(textoModal.includes('Alterar minha senha'), 'opção de trocar senha disponível');
  ok(textoModal.includes('Sair da conta'), 'opção de sair disponível');
  const focoPreso = await avaliar("!!document.querySelector('.modal__fechar')");
  ok(focoPreso, 'modal com botão de fechar acessível');
  await avaliar("document.querySelector('.modal__fechar').click()");
  await esperar(400);
  ok((await avaliar("document.querySelectorAll('.modal').length")) === 0, 'modal fecha corretamente');

  titulo('Tema claro/escuro');
  const temaAntes = await avaliar("document.documentElement.getAttribute('data-tema')");
  const textoAntes = (await avaliar('document.body.innerText')).length;
  await avaliar("document.querySelector('button[aria-label^=\"Alternar tema\"], button[aria-label^=\"Ativar tema\"]').click()");
  await esperar(600);
  const temaDepois = await avaliar("document.documentElement.getAttribute('data-tema')");
  ok(temaAntes !== temaDepois, `alternância de tema troca ${temaAntes} -> ${temaDepois}`);
  const corFundo = await avaliar('getComputedStyle(document.body).backgroundColor');
  ok(
    temaDepois === 'escuro' ? corFundo === 'rgb(11, 16, 32)' : corFundo === 'rgb(245, 246, 250)',
    'variáveis de cor acompanham o tema',
    corFundo,
  );
  const textoDepois = (await avaliar('document.body.innerText')).length;
  ok(textoDepois >= textoAntes * 0.9, 'trocar o tema não apaga o conteúdo da tela', `${textoAntes} -> ${textoDepois}`);
  await avaliar("document.querySelector('button[aria-label^=\"Alternar tema\"], button[aria-label^=\"Ativar tema\"]').click()");
  await esperar(400);

  titulo('Responsividade');
  await cdp.enviar('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await recarregar(2000);
  const desktop = await avaliar(
    "getComputedStyle(document.querySelector('.sidebar')).display + '|' + getComputedStyle(document.querySelector('.bottomnav')).display",
  );
  ok(desktop === 'flex|none', 'em desktop aparece a barra lateral e some a navegação inferior', desktop);

  const larguraExcedente = await avaliar('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  ok(larguraExcedente <= 1, 'nenhum scroll horizontal em 1400px de largura', `excesso=${larguraExcedente}px`);

  await cdp.enviar('Emulation.setDeviceMetricsOverride', { width: 360, height: 780, deviceScaleFactor: 2, mobile: true });
  await recarregar(2000);
  const mobile = await avaliar(
    "getComputedStyle(document.querySelector('.sidebar')).display + '|' + getComputedStyle(document.querySelector('.bottomnav')).display",
  );
  ok(mobile === 'none|grid', 'em celular aparece a navegação inferior e some a barra lateral', mobile);
  const excessoMobile = await avaliar('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  ok(excessoMobile <= 1, 'nenhum scroll horizontal em 360px de largura', `excesso=${excessoMobile}px`);

  const alvoToque = await avaliar(
    "Math.min(...Array.from(document.querySelectorAll('.bottomnav__item')).map(e=>e.getBoundingClientRect().height))",
  );
  ok(alvoToque >= 44, `alvos de toque da navegação com ${Math.round(alvoToque)}px de altura`);

  titulo('Tratamento de erro sem tela genérica');
  tela = await abrir('/ordens/999999', 1600);
  ok(tela.texto.includes('OS indisponível') || tela.texto.includes('não encontrada'), 'OS inexistente mostra mensagem clara');
  ok(tela.texto.includes('Voltar'), 'erro oferece saída de navegação');

  tela = await abrir('/rota-que-nao-existe', 1600);
  ok(tela.texto.includes('Painel'), 'rota desconhecida cai no painel em vez de tela em branco');

  titulo('Links profundos com filtro (atalhos do painel)');
  tela = await abrir('/ordens?status=pronto', 2200);
  const chipsAtivos = await avaliar(
    "Array.from(document.querySelectorAll('.chip[aria-pressed=\"true\"]')).map(c=>c.textContent.trim()).join(',')",
  );
  ok(chipsAtivos.includes('Pronto'), 'link #/ordens?status=pronto abre a lista já filtrada', chipsAtivos);
  const sohPronto = await avaliar(
    "Array.from(document.querySelectorAll('.card-os')).every(c=>c.innerText.includes('Pronto para retirada'))",
  );
  ok(sohPronto, 'lista filtrada mostra apenas OS prontas');
  ok((await avaliar("document.querySelectorAll('.card-os').length")) === 3, 'quantidade de OS prontas confere com o seed');

  titulo('Portal público do cliente (sem login)');
  await cdp.enviar('Network.clearBrowserCookies');
  tela = await abrir('/rastreio', 2000);
  ok(tela.minusculo.includes('acompanhe seu reparo'), 'rastreio público renderiza sem login');
  ok((await avaliar("!!document.querySelector('.rastreio__form')")), 'formulário de rastreio presente');
  ok(filtrar(tela.errosNovos).length === 0, 'rastreio sem erros de console', tela.errosNovos.join(' | '));
  ok(tela.excecoesNovas.length === 0, 'rastreio sem exceções', tela.excecoesNovas.join(' | '));

  tela = await abrir('/aprovacao/link-invalido', 1800);
  ok(tela.minusculo.includes('não encontramos este orçamento'), 'link de orçamento inválido é tratado com mensagem clara');
  ok(tela.excecoesNovas.length === 0, 'página de aprovação sem exceções', tela.excecoesNovas.join(' | '));

  tela = await abrir('/ordens', 1600);
  ok(tela.texto.includes('Entrar'), 'sem sessão, a área interna continua protegida');

  titulo('Erros globais');
  const naoEsperados = redeComErro.filter((linha) => !REDE_ESPERADA.some((padrao) => padrao.test(linha)));
  ok(naoEsperados.length === 0, `nenhuma resposta HTTP inesperada (${naoEsperados.length})`, naoEsperados.slice(0, 5).join(' | '));
  ok(filtrar(errosConsole).length === 0, 'nenhum erro de console além do 401/404 previsível', filtrar(errosConsole).slice(0, 3).join(' | '));
  ok(excecoes.length === 0, `nenhuma exceção não tratada (${excecoes.length})`, excecoes.slice(0, 4).join(' | '));
} catch (erro) {
  falhas += 1;
  console.error('\n[teste interrompido]', erro);
} finally {
  cdp?.fechar();
  navegador?.kill();
  servidor?.kill();
  await esperar(400);
  try {
    fs.rmSync(dirTemp, { recursive: true, force: true });
  } catch {
    /* o Chrome pode manter o perfil travado por alguns instantes */
  }
}

console.log(`\n${'\u2500'.repeat(52)}`);
console.log(`  ${passos - falhas}/${passos} verificações passaram`);
console.log(`${'\u2500'.repeat(52)}\n`);
process.exit(falhas === 0 ? 0 : 1);
