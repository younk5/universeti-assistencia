/**
 * Teste de fumaça ponta-a-ponta: sobe o servidor em uma porta efêmera,
 * com banco temporário, e percorre o fluxo real da OS via HTTP.
 *
 *   npm test
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'tecnoflow-test-'));
process.env.DATA_DIR = dirTemp;
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'segredo-de-teste';
process.env.ADMIN_EMAIL = 'admin@teste.com';
process.env.ADMIN_SENHA = 'Teste@123';
process.env.ADMIN_NOME = 'Admin Teste';

const { iniciar } = await import('../index.js');
const { carregarDriver, executar, consultarUm, fecharBanco, driverAtual } = await import('../db.js');
const { gerarHashSenha } = await import('../auth.js');

let passos = 0;
let falhas = 0;

function ok(condicao, descricao, extra = '') {
  passos += 1;
  if (condicao) {
    console.log(`  \u2713 ${descricao}`);
  } else {
    falhas += 1;
    console.error(`  \u2717 ${descricao}${extra ? ` -> ${extra}` : ''}`);
  }
}

function titulo(texto) {
  console.log(`\n${texto}`);
}

let base = '';
let cookie = '';

async function api(metodo, caminho, corpo = null, opcoes = {}) {
  const headers = { ...(opcoes.headers ?? {}) };
  if (cookie && opcoes.cookie !== false) headers.Cookie = cookie;
  let body;
  if (corpo instanceof Buffer) {
    body = corpo;
  } else if (corpo !== null && corpo !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(corpo);
  }
  const resposta = await fetch(`${base}${caminho}`, { method: metodo, headers, body });
  const setCookie = resposta.headers.getSetCookie?.() ?? [];
  if (setCookie.length && opcoes.cookie !== false) {
    cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  }
  const tipo = resposta.headers.get('content-type') ?? '';
  if (tipo.includes('application/json')) {
    return { status: resposta.status, dados: await resposta.json() };
  }
  return { status: resposta.status, dados: await resposta.text(), tipo };
}

function png1x1() {
  const crcTabela = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTabela[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const bloco = (tipo, dados) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(dados.length);
    const corpo = Buffer.concat([Buffer.from(tipo), dados]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(corpo));
    return Buffer.concat([len, corpo, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = zlib.deflateSync(Buffer.from([0, 255, 0, 0]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', idat),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

async function prepararUsuarios() {
  await carregarDriver();
  const agora = new Date().toISOString();
  const lojaA = Number((await executar('INSERT INTO lojas (codigo, nome, ativo, criado_em) VALUES (?, ?, 1, ?)', 'TST', 'Loja Teste Centro', agora)).lastInsertRowid);
  const lojaB = Number((await executar('INSERT INTO lojas (codigo, nome, ativo, criado_em) VALUES (?, ?, 1, ?)', 'TSB', 'Loja Teste Bairro', agora)).lastInsertRowid);
  const senha = gerarHashSenha('Teste@123');
  const inserir = (nome, email, papel, lojaId) =>
    executar(
      'INSERT INTO usuarios (nome, email, senha_hash, papel, loja_id, ativo, criado_em) VALUES (?, ?, ?, ?, ?, 1, ?)',
      nome, email, senha, papel, lojaId, agora,
    );
  await inserir('Atendente A', 'atendente@teste.com', 'atendente', lojaA);
  await inserir('Atendente B', 'atendente.b@teste.com', 'atendente', lojaB);
  await inserir('Tecnico A', 'tecnico@teste.com', 'tecnico', lojaA);
  await inserir('Tecnico B', 'tecnico.b@teste.com', 'tecnico', lojaB);
  await inserir('Tecnico sem loja', 'tecnico.rede@teste.com', 'tecnico', null);
  return { lojaA, lojaB };
}

const servidor = await iniciar();
await new Promise((resolve) => servidor.once('listening', resolve));
base = `http://127.0.0.1:${servidor.address().port}`;

await prepararUsuarios();
console.log(`\n  Driver de banco em teste: ${driverAtual()}`);

try {
  titulo('Autenticação');
  let r = await api('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'errada' });
  ok(r.status === 401, 'login com senha errada é recusado (401)', `status=${r.status}`);

  r = await api('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'Teste@123' });
  ok(r.status === 200 && r.dados.usuario.papel === 'admin', 'login do admin funciona');
  ok(cookie.includes('tecnoflow_sessao'), 'cookie de sessão é emitido');

  r = await api('GET', '/api/auth/me');
  ok(r.status === 200 && r.dados.usuario.email === 'admin@teste.com', 'GET /api/auth/me devolve o usuário logado');

  r = await api('GET', '/api/ordens', null, { cookie: false });
  ok(r.status === 401, 'rota protegida sem cookie responde 401', `status=${r.status}`);

  titulo('Criação de OS (atendente)');
  await api('POST', '/api/auth/login', { email: 'atendente@teste.com', senha: 'Teste@123' });
  const payload = {
    clienteNome: 'Cliente Smoke Test',
    clienteTelefone: '(11) 91234-5678',
    tipoAparelho: 'Celular',
    marca: 'Apple',
    modelo: 'iPhone 13',
    cor: 'Preto',
    imei: '356789012345678',
    defeitoRelatado: 'Tela trincada após queda',
    estadoAparelho: 'Tela trincada, aparelho liga',
    checklist: { telaTrincada: true, queda: true, itensDeixados: 'capa e chip', senhaInformada: true, senha: { tipo: 'padrao', valor: '1-2-5-8' } },
  };
  r = await api('POST', '/api/ordens', payload);
  ok(r.status === 201, 'atendente cria OS (201)', JSON.stringify(r.dados).slice(0, 200));
  const osId = r.dados.ordem?.id;
  const numeroOS = r.dados.ordem?.numero_os;
  ok(Boolean(numeroOS && numeroOS.startsWith('TST-')), `número de OS gerado: ${numeroOS}`);
  ok(
    Boolean(r.dados.ordem?.checklist && JSON.parse(r.dados.ordem.checklist).telaTrincada === true),
    'checklist técnico é gravado na OS',
  );
  ok(
    Boolean(r.dados.ordem?.checklist && JSON.parse(r.dados.ordem.checklist).senha?.valor === '1-2-5-8'),
    'senha do aparelho (desenho) é gravada com a ordem',
  );

  r = await api('POST', '/api/ordens', { ...payload, clienteTelefone: '123' });
  ok(r.status === 422, 'telefone inválido é rejeitado (422)', `status=${r.status}`);

  r = await api('POST', '/api/ordens', { ...payload, clienteNome: '' });
  ok(r.status === 422, 'campo obrigatório vazio é rejeitado');

  titulo('Foto de entrada');
  const png = png1x1();
  r = await api('POST', `/api/ordens/${osId}/fotos?tipo=entrada`, png, {
    headers: { 'Content-Type': 'image/png' },
  });
  ok(r.status === 201, 'upload de foto de entrada (201)', JSON.stringify(r.dados).slice(0, 160));
  const fotoId = r.dados.foto?.id;

  r = await api('POST', `/api/ordens/${osId}/fotos?tipo=entrada`, Buffer.from('nao é imagem'), {
    headers: { 'Content-Type': 'image/png' },
  });
  ok(r.status === 422, 'arquivo que não é imagem é rejeitado (422)', `status=${r.status}`);

  r = await api('GET', `/api/fotos/${fotoId}/raw`);
  ok(r.status === 200 && r.dados?.length > 0, 'download da foto autenticado funciona');

  titulo('Fluxo técnico');
  r = await api('POST', `/api/ordens/${osId}/finalizar`, { servicoRealizado: 'teste indevido' });
  ok(r.status === 403, 'atendente não pode finalizar OS (403)', `status=${r.status}`);

  await api('POST', '/api/auth/login', { email: 'tecnico@teste.com', senha: 'Teste@123' });
  r = await api('GET', '/api/ordens?status=aguardando');
  ok(r.status === 200 && r.dados.itens.some((o) => o.id === osId), 'técnico vê a OS na fila da sua loja');

  r = await api('POST', `/api/ordens/${osId}/assumir`, {});
  ok(r.status === 200 && r.dados.ordem.status === 'em_manutencao', 'técnico assume a OS');
  ok(Boolean(r.dados.ordem.iniciado_em), 'data de início registrada ao assumir');

  r = await api('POST', `/api/ordens/${osId}/comentarios`, { descricao: 'Diagnóstico: conector oxidado.' });
  ok(r.status === 201, 'anotação técnica registrada');

  r = await api('POST', `/api/ordens/${osId}/finalizar`, {
    servicoRealizado: 'Troca de tela e vedação',
    pecasUtilizadas: 'Tela OLED, adesivo',
    valor: 480.5,
    garantiaDias: 90,
  });
  ok(r.status === 200 && r.dados.ordem.status === 'pronto', 'técnico finaliza a OS', JSON.stringify(r.dados).slice(0, 200));
  ok(Number(r.dados.ordem.valor) === 480.5, 'valor cobrado gravado');
  ok(Boolean(r.dados.whatsapp), 'link de WhatsApp montado para avisar o cliente');

  titulo('Orçamento com aprovação do cliente');
  r = await api('POST', `/api/ordens/${osId}/orcamento`, { valor: 480.5, observacao: 'Troca de tela' });
  ok(r.status === 200 && r.dados.orcamento?.status === 'pendente', 'orçamento enviado fica pendente', JSON.stringify(r.dados).slice(0, 160));
  ok(typeof r.dados.link === 'string' && r.dados.link.includes('/aprovacao/'), 'link público de aprovação gerado');
  const tokenOrc = String(r.dados.link ?? '').split('/').pop();

  r = await api('GET', `/api/publico/orcamento/${tokenOrc}`, null, { cookie: false });
  ok(r.status === 200 && Number(r.dados.orcamento?.valor) === 480.5, 'orçamento é acessível sem login');

  r = await api('POST', `/api/publico/orcamento/${tokenOrc}`, { decisao: 'aprovado' }, { cookie: false });
  ok(r.status === 200, 'cliente aprova o orçamento sem login', JSON.stringify(r.dados).slice(0, 120));

  r = await api('POST', `/api/publico/orcamento/${tokenOrc}`, { decisao: 'recusado' }, { cookie: false });
  ok(r.status === 409, 'responder o mesmo orçamento duas vezes é bloqueado (409)', `status=${r.status}`);

  r = await api('GET', `/api/ordens/${osId}`);
  ok(r.dados.orcamento?.status === 'aprovado', 'decisão do cliente aparece na OS');
  ok(r.dados.eventos.some((e) => e.tipo_evento === 'orcamento_aprovado'), 'aprovação entra na trilha de auditoria');

  r = await api('POST', `/api/ordens/${osId}/retirar`, { recebidoPor: 'Cliente Smoke Test' });
  ok(r.status === 403, 'técnico não pode registrar retirada (403)', `status=${r.status}`);

  titulo('Retirada (atendente) e auditoria');
  await api('POST', '/api/auth/login', { email: 'atendente@teste.com', senha: 'Teste@123' });
  r = await api('POST', `/api/ordens/${osId}/retirar`, { recebidoPor: 'Cliente Smoke Test', valorPago: true, formaPagamento: 'pix' });
  ok(r.status === 200 && r.dados.ordem.status === 'retirado', 'atendente registra a retirada');
  ok(Boolean(r.dados.ordem.retirado_em), 'data de retirada gravada');
  ok(r.dados.ordem.forma_pagamento === 'pix', 'forma de pagamento gravada');
  ok(Boolean(r.dados.ordem.garantia_ate), 'data-limite de garantia calculada na retirada');

  r = await api('GET', `/api/ordens/${osId}`);
  const tipos = r.dados.eventos.map((e) => e.tipo_evento);
  ok(r.dados.eventos.length >= 5, `timeline tem ${r.dados.eventos.length} eventos`);
  ok(
    ['criacao', 'assumir', 'comentario', 'finalizar', 'retirar'].every((t) => tipos.includes(t)),
    'timeline contém todas as etapas do fluxo',
    tipos.join(','),
  );
  ok(r.dados.fotos.length >= 1, 'fotos anexadas retornam no detalhe');
  ok(r.dados.transicoes.length === 0, 'OS retirada não oferece novas transições');

  r = await api('GET', `/api/ordens/${osId}`);
  r = await api('POST', `/api/ordens/${osId}/retirar`, {});
  ok(r.status === 409, 'retirada duplicada é bloqueada (409)', `status=${r.status}`);

  titulo('Rastreio público da OS');
  r = await api('GET', `/api/publico/os/${numeroOS}?tel=5678`, null, { cookie: false });
  ok(r.status === 200 && r.dados.ordem?.status === 'retirado', 'cliente acompanha a OS com número + telefone');
  ok(r.dados.linhaDoTempo?.length >= 5, `linha do tempo pública traz ${r.dados.linhaDoTempo?.length ?? 0} passos`);

  r = await api('GET', `/api/publico/os/${numeroOS}?tel=0000`, null, { cookie: false });
  ok(r.status === 422, 'telefone errado não libera a OS (422)', `status=${r.status}`);

  r = await api('GET', '/api/publico/os/NAO-EXISTE-999?tel=5678', null, { cookie: false });
  ok(r.status === 422, 'mesma resposta para OS inexistente (evita varredura)');

  titulo('Garantia como fluxo');
  await api('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'Teste@123' });
  r = await api('GET', `/api/ordens/${osId}`);
  ok(r.dados.acoes?.podeGarantia === true, 'OS retirada dentro da garantia oferece a ação');
  r = await api('POST', `/api/ordens/${osId}/garantia`, { descricao: 'voltou sem áudio' });
  ok(
    r.status === 201 && Number(r.dados.ordem?.garantia_de_os_id) === Number(osId),
    'abre OS em garantia vinculada à original',
    JSON.stringify(r.dados).slice(0, 160),
  );
  ok(r.dados.ordem?.status === 'aguardando' && r.dados.ordem?.valor == null, 'OS de garantia entra sem valor');
  r = await api('POST', `/api/ordens/${osId}/garantia`, {});
  ok(r.status === 409, 'não abre duas garantias abertas para a mesma OS (409)', `status=${r.status}`);

  const banco = await carregarDriver();
  void banco;
  let erroAuditoria = false;
  try {
    await executar('DELETE FROM eventos_os WHERE os_id = ?', osId);
  } catch {
    erroAuditoria = true;
  }
  ok(erroAuditoria, 'eventos_os é imutável (DELETE bloqueado por trigger)');
  erroAuditoria = false;
  try {
    await executar("UPDATE eventos_os SET descricao = 'alterado' WHERE os_id = ?", osId);
  } catch {
    erroAuditoria = true;
  }
  ok(erroAuditoria, 'eventos_os é imutável (UPDATE bloqueado por trigger)');
  erroAuditoria = false;
  try {
    await executar('DELETE FROM fotos_os WHERE os_id = ?', osId);
  } catch {
    erroAuditoria = true;
  }
  ok(erroAuditoria, 'fotos_os é imutável (DELETE bloqueado por trigger)');

  titulo('Escopo de visão (técnico/admin = rede; atendente = loja)');
  await api('POST', '/api/auth/login', { email: 'tecnico.b@teste.com', senha: 'Teste@123' });
  r = await api('GET', `/api/ordens/${osId}`);
  ok(r.status === 200, 'técnico acessa OS de outra loja (visão de rede)', `status=${r.status}`);
  r = await api('GET', '/api/ordens');
  ok(r.dados.itens.some((o) => o.loja_codigo === 'TST'), 'técnico vê OS de loja diferente da dele');

  await api('POST', '/api/auth/login', { email: 'tecnico.rede@teste.com', senha: 'Teste@123' });
  r = await api('GET', `/api/ordens/${osId}`);
  ok(r.status === 200, 'técnico sem loja também enxerga a rede', `status=${r.status}`);
  r = await api('GET', '/api/meta');
  ok(r.status === 200 && r.dados.lojas.length >= 2, 'técnico sem loja recebe a lista de lojas da rede');

  await api('POST', '/api/auth/login', { email: 'atendente.b@teste.com', senha: 'Teste@123' });
  r = await api('GET', `/api/ordens/${osId}`);
  ok(r.status === 403, 'atendente de outra loja não acessa a OS (403)', `status=${r.status}`);
  r = await api('GET', '/api/ordens');
  ok(r.dados.itens.every((o) => o.loja_codigo === 'TSB'), 'listagem do atendente fica restrita à loja dele');

  titulo('Permissões administrativas');
  r = await api('GET', '/api/usuarios');
  ok(r.status === 403, 'não-admin não lista usuários (403)', `status=${r.status}`);
  r = await api('POST', '/api/lojas', { nome: 'Loja Nova' });
  ok(r.status === 403, 'não-admin não cria loja (403)');

  await api('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'Teste@123' });
  r = await api('POST', '/api/lojas', { nome: 'Guarulhos São João', codigo: 'GSJ' });
  ok(r.status === 201 && r.dados.loja.codigo === 'GSJ', 'admin cria loja');
  const novaLojaId = r.dados.loja?.id;

  r = await api('POST', '/api/usuarios', {
    nome: 'Novo Técnico',
    email: 'novo.tecnico@teste.com',
    senha: 'fraco',
    papel: 'tecnico',
    lojaId: novaLojaId,
  });
  ok(r.status === 422, 'senha fraca é rejeitada (422)', `status=${r.status}`);

  r = await api('POST', '/api/usuarios', {
    nome: 'Novo Técnico',
    email: 'novo.tecnico@teste.com',
    senha: 'Forte@123',
    papel: 'tecnico',
    lojaId: novaLojaId,
  });
  ok(r.status === 201, 'admin cria usuário técnico');
  const novoUsuarioId = r.dados.usuario?.id;

  r = await api('POST', '/api/usuarios', {
    nome: 'Duplicado',
    email: 'novo.tecnico@teste.com',
    senha: 'Forte@123',
    papel: 'tecnico',
    lojaId: novaLojaId,
  });
  ok(r.status === 409, 'e-mail duplicado é rejeitado (409)', `status=${r.status}`);

  r = await api('POST', '/api/usuarios', {
    nome: 'Técnico Rede',
    email: 'tecnico.rede2@teste.com',
    senha: 'Forte@123',
    papel: 'tecnico',
  });
  ok(r.status === 201 && r.dados.usuario?.loja_id === null, 'técnico pode ser criado sem loja', `status=${r.status}`);

  r = await api('POST', '/api/usuarios', {
    nome: 'Atendente Sem Loja',
    email: 'sem.loja@teste.com',
    senha: 'Forte@123',
    papel: 'atendente',
  });
  ok(r.status === 422, 'atendente sem loja é rejeitado (422)', `status=${r.status}`);

  r = await api('PATCH', '/api/usuarios/1', { ativo: false });
  ok(r.status === 200 || r.status === 422 || r.status === 404, 'PATCH de usuário responde de forma controlada', `status=${r.status}`);

  titulo('Dashboard e relatórios');
  r = await api('GET', '/api/dashboard');
  ok(r.status === 200, 'dashboard responde');
  ok(typeof r.dados.status?.total === 'number', 'dashboard traz contagem por status');
  ok(Array.isArray(r.dados.porLoja) && r.dados.porLoja.length >= 3, 'dashboard traz comparativo por loja');
  ok(Array.isArray(r.dados.produtividade), 'dashboard traz produtividade por técnico');
  ok(typeof r.dados.periodoResumo?.total === 'number', 'dashboard resume o período');
  ok(typeof r.dados.financeiro?.faturamento === 'number', 'dashboard traz bloco financeiro');
  ok(r.dados.financeiro.faturamento >= 480.5, 'faturamento inclui a OS retirada', `faturamento=${r.dados.financeiro.faturamento}`);
  ok(Array.isArray(r.dados.financeiro.porFormaPagamento), 'dashboard lista formas de pagamento');
  ok(!('comissaoTotal' in r.dados.financeiro), 'financeiro não tem mais comissão');

  titulo('Configurações da rede');
  r = await api('PATCH', '/api/admin/configuracoes', { garantiaDiasPadrao: 120, prazoDiasPadrao: 7 });
  ok(r.status === 200 && r.dados.configuracoes?.garantia_dias_padrao === '120', 'admin salva regras da rede', JSON.stringify(r.dados).slice(0, 160));
  r = await api('GET', '/api/admin/configuracoes');
  ok(r.dados.configuracoes?.prazo_dias_padrao === '7', 'regra de prazo fica persistida');

  r = await api('GET', '/api/relatorios/ordens.csv');
  ok(r.status === 200 && String(r.dados).includes('numero_os'), 'exportação CSV gera conteúdo');
  ok(String(r.dados).includes('TST-'), 'CSV contém a OS criada');

  titulo('Busca e filtros');
  r = await api('GET', '/api/ordens?busca=Smoke');
  ok(r.dados.total >= 1, 'busca por nome do cliente funciona');
  r = await api('GET', `/api/ordens?busca=${numeroOS}`);
  ok(r.dados.total === 1, 'busca por número da OS funciona');
  r = await api('GET', '/api/ordens?busca=xyzabcnaoexiste');
  ok(r.dados.total === 0, 'busca sem correspondência retorna zero (termo sem dígitos não casa com tudo)', `total=${r.dados.total}`);
  r = await api('GET', '/api/ordens?busca=912345678');
  ok(r.dados.total >= 1, 'busca por telefone (somente dígitos) encontra a OS');
  r = await api('GET', '/api/ordens?status=retirado');
  ok(r.dados.itens.every((o) => o.status === 'retirado'), 'filtro por status funciona');

  titulo('Ciclo de vida das lojas');
  // Deixa uma OS em aberto na loja principal para validar a regra de bloqueio.
  await api('POST', '/api/auth/login', { email: 'atendente@teste.com', senha: 'Teste@123' });
  await api('POST', '/api/ordens', {
    clienteNome: 'Cliente Loja Ocupada',
    clienteTelefone: '(11) 90000-1111',
    tipoAparelho: 'Tablet',
    marca: 'Samsung',
    modelo: 'Galaxy Tab A9',
    defeitoRelatado: 'Não liga após descarga total de bateria.',
  });

  await api('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'Teste@123' });
  r = await api('POST', '/api/lojas', { nome: 'Loja Temporária', codigo: 'TMP' });
  const lojaTemporaria = r.dados.loja?.id;
  ok(r.status === 201, 'loja temporária criada');

  r = await api('PATCH', `/api/lojas/${lojaTemporaria}`, { ativo: false });
  ok(r.status === 200 && r.dados.loja.ativo === 0, 'loja sem OS em aberto pode ser desativada');

  r = await api('PATCH', `/api/lojas/${lojaTemporaria}`, { ativo: true });
  ok(r.status === 200 && r.dados.loja.ativo === 1, 'loja pode ser reativada');

  r = await api('PATCH', `/api/lojas/${lojaTemporaria}`, { nome: 'Loja Temporária Renomeada' });
  ok(r.status === 200 && r.dados.loja.nome === 'Loja Temporária Renomeada', 'renomear loja preserva os demais campos');

  const lojaComOS = await fetch(`${base}/api/lojas`, { headers: { Cookie: cookie } }).then((x) => x.json());
  const lojaCheia = lojaComOS.lojas.find((l) => l.os_abertas > 0);
  r = await api('PATCH', `/api/lojas/${lojaCheia.id}`, { ativo: false });
  ok(r.status === 422, 'loja com OS em aberto não pode ser desativada (422)', `status=${r.status} loja=${lojaCheia?.nome}`);

  r = await api('POST', '/api/usuarios', {
    nome: 'Técnico Alocável',
    email: 'alocavel@teste.com',
    senha: 'Forte@123',
    papel: 'tecnico',
    lojaId: lojaTemporaria,
  });
  const tecnicoAlocavel = r.dados.usuario?.id;
  ok(r.status === 201, 'usuário vinculado à loja temporária');

  r = await api('POST', '/api/usuarios', {
    nome: 'Atendente Alocável',
    email: 'alocavel.atendente@teste.com',
    senha: 'Forte@123',
    papel: 'atendente',
    lojaId: lojaTemporaria,
  });
  ok(r.status === 201, 'atendente vinculado à loja temporária');

  await api('POST', '/api/auth/login', { email: 'alocavel.atendente@teste.com', senha: 'Forte@123' });
  r = await api('GET', '/api/ordens');
  ok(r.dados.total === 0, 'loja nova começa sem ordens');
  ok(r.dados.itens.length === 0, 'listagem vazia é válida (não erro)');
  ok(Array.isArray(r.dados.itens), 'resposta de listagem sempre traz array');

  await api('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'Teste@123' });
  r = await api('PATCH', `/api/usuarios/${tecnicoAlocavel}`, { ativo: false });
  ok(r.status === 200 && r.dados.usuario.ativo === 0, 'usuário sem OS em andamento pode ser desativado');

  titulo('Exclusão definitiva');

  r = await api('POST', '/api/lojas', { nome: 'Loja Descartável', codigo: 'DSC' });
  const lojaDescartavel = r.dados.loja?.id;
  r = await api('DELETE', `/api/lojas/${lojaDescartavel}`);
  ok(r.status === 200, 'loja sem vínculos pode ser excluída', `status=${r.status}`);

  r = await api('DELETE', `/api/lojas/${lojaTemporaria}`);
  ok(r.status === 200, 'loja com usuários vinculados também pode ser excluída', `status=${r.status}`);

  r = await api('DELETE', '/api/usuarios/1');
  ok(r.status === 422, 'admin não pode excluir a própria conta (422)', `status=${r.status}`);

  await api('POST', '/api/auth/login', { email: 'atendente@teste.com', senha: 'Teste@123' });
  r = await api('DELETE', '/api/usuarios/1');
  ok(r.status === 403, 'não-admin não exclui usuários (403)', `status=${r.status}`);
  await api('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'Teste@123' });

  const idAtendente = Number((await consultarUm("SELECT id FROM usuarios WHERE email = 'atendente@teste.com'")).id);
  r = await api('DELETE', `/api/usuarios/${idAtendente}`);
  ok(r.status === 200, 'usuário com histórico pode ser excluído', `status=${r.status}`);

  titulo('Exclusão de OS e anexos');
  const lojaTST = Number((await consultarUm("SELECT id FROM lojas WHERE codigo = 'TST'")).id);
  r = await api('POST', '/api/ordens', {
    clienteNome: 'Cliente Descartável',
    clienteTelefone: '(11) 90000-0000',
    marca: 'Marca X',
    modelo: 'Modelo Y',
    defeitoRelatado: 'Registro criado apenas para o teste de exclusão.',
    lojaId: lojaTST,
  });
  const osDescartavel = r.dados.ordem?.id;
  ok(r.status === 201, 'OS descartável criada', `status=${r.status}`);

  r = await api('POST', `/api/ordens/${osDescartavel}/fotos?tipo=entrada`, png1x1(), {
    headers: { 'Content-Type': 'image/png' },
  });
  const fotoDescartavel = r.dados.foto?.id;
  ok(r.status === 201, 'anexo adicionado à OS descartável');

  r = await api('DELETE', `/api/fotos/${fotoDescartavel}`);
  ok(r.status === 200, 'anexo pode ser excluído', `status=${r.status}`);
  r = await api('GET', `/api/fotos/${fotoDescartavel}/raw`);
  ok(r.status === 404, 'anexo excluído não é mais servido (404)', `status=${r.status}`);

  r = await api('DELETE', `/api/ordens/${osDescartavel}`);
  ok(r.status === 200, 'OS pode ser excluída definitivamente', `status=${r.status}`);
  r = await api('GET', `/api/ordens/${osDescartavel}`);
  ok(r.status === 404, 'OS excluída não é mais encontrada (404)', `status=${r.status}`);

  let protecaoAtiva = false;
  try {
    await executar('DELETE FROM eventos_os WHERE os_id = ?', osId);
  } catch {
    protecaoAtiva = true;
  }
  ok(protecaoAtiva, 'proteção de auditoria continua ativa após as exclusões');

  titulo('Tratamento de erros');
  r = await api('GET', '/api/ordens/999999');
  ok(r.status === 404, 'OS inexistente responde 404');
  r = await api('GET', '/api/rota-inexistente');
  ok(r.status === 404, 'rota de API inexistente responde 404 com JSON', `status=${r.status}`);

  titulo('Troca de senha');
  await api('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'Teste@123' });
  const lojasParaSenha = await api('GET', '/api/lojas');
  await api('POST', '/api/usuarios', {
    nome: 'Atendente Senha',
    email: 'atendente.senha@teste.com',
    senha: 'Teste@123',
    papel: 'atendente',
    lojaId: lojasParaSenha.dados.lojas?.[0]?.id,
  });
  await api('POST', '/api/auth/login', { email: 'atendente.senha@teste.com', senha: 'Teste@123' });
  r = await api('POST', '/api/auth/senha', { senhaAtual: 'Teste@123', novaSenha: 'Nova@123' });
  ok(r.status === 403, 'atendente não pode alterar a própria senha (403)', `status=${r.status}`);
  await api('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'Teste@123' });
  r = await api('POST', '/api/auth/senha', { senhaAtual: 'errada', novaSenha: 'Nova@123' });
  ok(r.status === 422, 'senha atual incorreta é rejeitada');
  r = await api('POST', '/api/auth/senha', { senhaAtual: 'Teste@123', novaSenha: 'Nova@123' });
  ok(r.status === 200, 'troca de senha funciona');

  titulo('Auditoria de exclusões e backup');
  await api('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'Nova@123' });

  r = await api('GET', '/api/admin/exclusoes');
  ok(r.status === 200, 'registro de exclusões responde');
  ok(r.dados.exclusoes.some((e) => e.tipo === 'os'), 'exclusão de OS fica registrada');
  ok(r.dados.exclusoes.some((e) => e.tipo === 'foto'), 'exclusão de anexo fica registrada');
  ok(r.dados.exclusoes.some((e) => e.tipo === 'usuario'), 'exclusão de usuário fica registrada');
  ok(r.dados.exclusoes.some((e) => e.tipo === 'loja'), 'exclusão de loja fica registrada');
  ok(r.dados.exclusoes.every((e) => e.usuario_nome), 'o registro aponta quem excluiu');

  r = await api('GET', '/api/admin/backup');
  const backup = r.dados.backup;
  ok(r.status === 200 && Array.isArray(backup?.tabelas?.ordens_servico), 'backup exporta as tabelas do banco');
  const totalOrdensBackup = backup.tabelas.ordens_servico.length;
  ok(totalOrdensBackup > 0, `backup traz ${totalOrdensBackup} OS`);

  r = await api('POST', '/api/admin/backup', { backup });
  ok(r.status === 200, 'backup pode ser restaurado', `status=${r.status}`);

  await api('POST', '/api/auth/login', { email: 'admin@teste.com', senha: 'Nova@123' });
  r = await api('GET', '/api/ordens');
  ok(r.dados.total === totalOrdensBackup, 'dados permanecem íntegros após restaurar', `${r.dados.total} vs ${totalOrdensBackup}`);

  titulo('Logout');
  r = await api('POST', '/api/auth/logout');
  ok(r.status === 200, 'logout responde 200');
  r = await api('GET', '/api/auth/me');
  ok(r.status === 401, 'sessão encerrada após logout (401)', `status=${r.status}`);
} catch (erro) {
  falhas += 1;
  console.error('\n[teste interrompido]', erro);
} finally {
  servidor.close();
  await fecharBanco().catch(() => {});
  try {
    fs.rmSync(dirTemp, { recursive: true, force: true });
  } catch {
    /* Windows pode manter o handle do WAL por alguns ms */
  }
}

console.log(`\n${'─'.repeat(52)}`);
console.log(`  ${passos - falhas}/${passos} verificações passaram`);
console.log(`${'─'.repeat(52)}\n`);
process.exit(falhas === 0 ? 0 : 1);
