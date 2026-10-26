/**
 * Verificação do Web Push feito na mão (VAPID + AES128GCM).
 *
 * O teste sobe um "serviço de push" local, entrega uma notificação real e
 * decifra o corpo com a chave do navegador — se a criptografia ou a assinatura
 * VAPID estiverem erradas, o payload não abre. Também confere a limpeza de
 * inscrições mortas (410) e o contador de falhas.
 *
 *   npm run test:push
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';

const dirTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'tecnoflow-push-'));
process.env.DATA_DIR = dirTemp;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'segredo-de-teste-push';

const { prepararBanco, consultarUm, consultar, executar, fecharBanco } = await import('../db.js');
const { obterChavesVapid, enviarPush, enviarPushParaUsuarios, cifrarPayload } = await import('../services/push.js');

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

const base64url = (buffer) => Buffer.from(buffer).toString('base64url');
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------------------------------- */
/* Serviço de push falso                                                      */
/* -------------------------------------------------------------------------- */

const recebidas = [];
const servidor = http.createServer((req, res) => {
  const partes = [];
  req.on('data', (parte) => partes.push(parte));
  req.on('end', () => {
    const corpo = Buffer.concat(partes);
    recebidas.push({ url: req.url, metodo: req.method, cabecalhos: req.headers, corpo });
    if (req.url.startsWith('/morto')) {
      res.writeHead(410).end();
      return;
    }
    if (req.url.startsWith('/falha')) {
      res.writeHead(500).end();
      return;
    }
    res.writeHead(201).end();
  });
});

await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
const origemFalsa = `http://127.0.0.1:${servidor.address().port}`;

/* -------------------------------------------------------------------------- */
/* Par de chaves do "navegador"                                               */
/* -------------------------------------------------------------------------- */

const navegador = crypto.createECDH('prime256v1');
const p256dh = navegador.generateKeys();
const auth = crypto.randomBytes(16);
const inscricao = { endpoint: `${origemFalsa}/ok`, p256dh: base64url(p256dh), auth: base64url(auth) };

/** Decifra o corpo aes128gcm como o navegador faria (RFC 8188/8291). */
function decifrar(corpo) {
  const salt = corpo.subarray(0, 16);
  const tamanhoRegistro = corpo.readUInt32BE(16);
  const tamanhoChave = corpo.readUInt8(20);
  const chaveServidor = corpo.subarray(21, 21 + tamanhoChave);
  const cifra = corpo.subarray(21 + tamanhoChave);

  const segredo = navegador.computeSecret(chaveServidor);
  const info = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), p256dh, chaveServidor]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', segredo, auth, info, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12));

  const decifrador = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decifrador.setAuthTag(cifra.subarray(cifra.length - 16));
  const texto = Buffer.concat([decifrador.update(cifra.subarray(0, cifra.length - 16)), decifrador.final()]).toString('utf8');
  return { texto, tamanhoRegistro, tamanhoChave, chaveServidor };
}

try {
  console.log('\nChaves VAPID da instalação');
  await prepararBanco();
  const chaves = await obterChavesVapid();
  const publica = Buffer.from(chaves.publicaBase64Url, 'base64url');
  ok(publica.length === 65 && publica[0] === 0x04, 'chave pública VAPID em ponto não comprimido (65 bytes)');
  const repetida = await obterChavesVapid();
  ok(repetida.publicaBase64Url === chaves.publicaBase64Url, 'chave é reaproveitada entre chamadas');
  const salva = await consultarUm("SELECT valor FROM configuracoes WHERE chave = 'push_vapid_privada'");
  ok(Boolean(salva?.valor), 'chave privada fica guardada no banco (não em variável de ambiente)');

  console.log('\nCriptografia e entrega');
  const payload = { titulo: 'Novo aparelho · GUA-0012', mensagem: 'Apple iPhone 13 · Cliente Teste', url: '/#/ordens/12' };
  const status = await enviarPush(inscricao, payload);
  ok(status === 201, 'serviço de push aceita a entrega (201)', String(status));
  ok(recebidas.length === 1, 'uma requisição foi enviada');
  const recebida = recebidas[0];
  ok(recebida.metodo === 'POST', 'entrega usa POST');
  ok(recebida.cabecalhos['content-encoding'] === 'aes128gcm', 'cabeçalho Content-Encoding: aes128gcm');
  ok(Boolean(recebida.cabecalhos.ttl), 'cabeçalho TTL presente', String(recebida.cabecalhos.ttl));

  const autorizacao = String(recebida.cabecalhos.authorization ?? '');
  ok(autorizacao.startsWith('vapid t='), 'cabeçalho Authorization usa esquema vapid');
  const [, jwtBruto] = /vapid t=([^,]+),\s*k=(.+)$/.exec(autorizacao) ?? [];
  ok(Boolean(jwtBruto), 'VAPID traz JWT e chave pública', autorizacao.slice(0, 40));
  ok(
    String(autorizacao).includes(`k=${chaves.publicaBase64Url}`),
    'chave anunciada é a mesma do servidor',
  );

  const [cabecalhoJwt, corpoJwt, assinaturaJwt] = String(jwtBruto).split('.');
  const verifica = crypto.verify(
    'sha256',
    Buffer.from(`${cabecalhoJwt}.${corpoJwt}`),
    { key: chaves.publica, dsaEncoding: 'ieee-p1363' },
    Buffer.from(assinaturaJwt, 'base64url'),
  );
  ok(verifica, 'assinatura ES256 do JWT confere com a chave pública');
  const claims = JSON.parse(Buffer.from(corpoJwt, 'base64url').toString('utf8'));
  ok(claims.aud === origemFalsa, 'JWT tem "aud" da origem do serviço de push', String(claims.aud));
  ok(claims.exp > Math.floor(Date.now() / 1000), 'JWT ainda é válido (exp no futuro)');
  ok(String(claims.sub).startsWith('mailto:'), 'JWT identifica o contato do servidor (sub)');

  const aberto = decifrar(recebida.corpo);
  ok(aberto.tamanhoChave === 65, 'corpo carrega a chave efêmera do servidor (65 bytes)');
  ok(aberto.chaveServidor[0] === 0x04, 'chave efêmera em formato não comprimido');
  ok(aberto.tamanhoRegistro >= 18, 'tamanho de registro coerente', String(aberto.tamanhoRegistro));
  ok(aberto.texto.endsWith('\u0002'), 'registro termina com o delimitador de último bloco');
  const decifrado = JSON.parse(aberto.texto.slice(0, -1));
  ok(
    decifrado.titulo === payload.titulo && decifrado.mensagem === payload.mensagem && decifrado.url === payload.url,
    'navegador decifra exatamente o conteúdo enviado',
    JSON.stringify(decifrado).slice(0, 140),
  );

  console.log('\nInscrição com chave inválida');
  let recusou = false;
  try {
    cifrarPayload('{}', { p256dh: base64url(Buffer.alloc(10)), auth: base64url(auth) });
  } catch {
    recusou = true;
  }
  ok(recusou, 'chave p256dh inválida é recusada antes do envio');

  console.log('\nInscrições mortas e falhas');
  await executar(
    'INSERT INTO usuarios (nome, email, senha_hash, papel, loja_id, ativo, criado_em) VALUES (?, ?, ?, ?, NULL, 1, ?)',
    'Dono Teste',
    'push@teste.com',
    'hash',
    'admin',
    new Date().toISOString(),
  );
  const usuario = await consultarUm("SELECT id FROM usuarios WHERE email = 'push@teste.com'");
  const agora = new Date().toISOString();
  const inserirInscricao = (endpoint) =>
    executar(
      'INSERT INTO push_inscricoes (usuario_id, endpoint, p256dh, auth, criado_em) VALUES (?, ?, ?, ?, ?)',
      usuario.id,
      endpoint,
      base64url(p256dh),
      base64url(auth),
      agora,
    );

  await inserirInscricao(`${origemFalsa}/ok`);
  await inserirInscricao(`${origemFalsa}/morto`);
  await inserirInscricao(`${origemFalsa}/falha`);

  const resumo = await enviarPushParaUsuarios([{ id: usuario.id }], { titulo: 'Teste', mensagem: 'Resumo' });
  ok(resumo.enviados === 1, 'uma inscrição recebeu a notificação', JSON.stringify(resumo));
  ok(resumo.removidos === 1, 'inscrição que respondeu 410 é removida', JSON.stringify(resumo));
  ok(resumo.falhas === 1, 'inscrição com erro 500 conta como falha', JSON.stringify(resumo));

  const restantes = await consultar('SELECT endpoint, falhas FROM push_inscricoes WHERE usuario_id = ?', usuario.id);
  ok(restantes.length === 2, 'inscrição morta sai da tabela', JSON.stringify(restantes));
  const comFalha = restantes.find((linha) => linha.endpoint.endsWith('/falha'));
  ok(Number(comFalha?.falhas) === 1, 'falha fica registrada na inscrição', JSON.stringify(comFalha));
  const bemSucedida = restantes.find((linha) => linha.endpoint.endsWith('/ok'));
  const linhaOk = await consultarUm('SELECT ultimo_envio_em FROM push_inscricoes WHERE endpoint = ?', bemSucedida.endpoint);
  ok(Boolean(linhaOk?.ultimo_envio_em), 'envio bem-sucedido registra a data do último uso');

  await esperar(20);
} catch (erro) {
  falhas += 1;
  console.error('\n[teste interrompido]', erro);
} finally {
  servidor.close();
  await fecharBanco().catch(() => {});
  try {
    fs.rmSync(dirTemp, { recursive: true, force: true });
  } catch {
    /* arquivo em uso no Windows */
  }
}

console.log(`\n${'\u2500'.repeat(52)}`);
console.log(`  ${passos - falhas}/${passos} verificações passaram`);
console.log(`${'\u2500'.repeat(52)}\n`);
process.exit(falhas === 0 ? 0 : 1);
