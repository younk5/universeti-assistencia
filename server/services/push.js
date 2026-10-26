import crypto from 'node:crypto';
import { lerConfig, definirConfig } from './configuracoes.js';
import { consultar, executar } from '../db.js';
import { agoraISO } from '../utils.js';

/**
 * Web Push sem dependências externas.
 *
 * Duas partes do protocolo são implementadas na mão:
 *   1. VAPID (RFC 8292) — assinatura ES256 do JWT que identifica o servidor
 *      para o serviço de push do navegador (FCM, Mozilla, Apple);
 *   2. Criptografia da carga (RFC 8291 sobre RFC 8188 / "aes128gcm") — o
 *      payload trafega cifrado com uma chave derivada do par do navegador e de
 *      um par efêmero gerado a cada envio.
 *
 * As chaves VAPID ficam na tabela `configuracoes` (uma vez por instalação), e
 * não em variável de ambiente: assim o recurso funciona em produção sem etapa
 * manual e todas as instâncias serverless usam a mesma chave.
 */

const CHAVE_PUBLICA = 'push_vapid_publica';
const CHAVE_PRIVADA = 'push_vapid_privada';
const ASSUNTO_VAPID = 'mailto:suporte@universeti.com.br';
const VALIDADE_JWT_SEGUNDOS = 12 * 60 * 60;
const TAMANHO_REGISTRO = 4096;
const LIMITE_ENVIO_MS = 8000;

let chavesEmCache = null;
let gerando = null;

const base64url = (valor) => Buffer.from(valor).toString('base64url');

/** Converte a chave pública EC em ponto não comprimido (65 bytes), formato do VAPID. */
function chavePublicaBruta(chavePublica) {
  const jwk = chavePublica.export({ format: 'jwk' });
  return Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, 'base64url'),
    Buffer.from(jwk.y, 'base64url'),
  ]);
}

function montarChaves(privadaPem) {
  // A chave pública é sempre derivada da privada: se por algum motivo o valor
  // gravado no banco divergir, o navegador continua recebendo a chave que
  // realmente assina os JWT.
  const privada = crypto.createPrivateKey(privadaPem);
  const publica = crypto.createPublicKey(privada);
  const bruta = chavePublicaBruta(publica);
  return { publica, privada, publicaBase64Url: base64url(bruta), bruta };
}

/**
 * Devolve o par VAPID da instalação, criando-o na primeira chamada.
 * A gravação usa "ON CONFLICT DO NOTHING" e relê o valor: duas instâncias que
 * subam juntas terminam com a mesma chave, sem trocar a inscrição dos clientes.
 */
export async function obterChavesVapid() {
  if (chavesEmCache) return chavesEmCache;
  if (gerando) return gerando;

  gerando = (async () => {
    const [publicaSalva, privadaSalva] = await Promise.all([
      lerConfig(CHAVE_PUBLICA, null),
      lerConfig(CHAVE_PRIVADA, null),
    ]);
    if (publicaSalva && privadaSalva) {
      chavesEmCache = montarChaves(privadaSalva);
      return chavesEmCache;
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicaPem = publicKey.export({ type: 'spki', format: 'pem' });
    const privadaPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

    // As duas chaves entram na MESMA instrução (atômica no SQLite): duas
    // instâncias que subam juntas não correm o risco de gravar a pública de uma
    // com a privada de outra. Quem chegar depois não sobrescreve nada.
    await executar(
      `INSERT INTO configuracoes (chave, valor, atualizado_em) VALUES (?, ?, ?), (?, ?, ?)
       ON CONFLICT(chave) DO NOTHING`,
      CHAVE_PUBLICA,
      publicaPem,
      agoraISO(),
      CHAVE_PRIVADA,
      privadaPem,
      agoraISO(),
    );

    const privadaFinal = await lerConfig(CHAVE_PRIVADA, null);
    chavesEmCache = montarChaves(privadaFinal ?? privadaPem);
    return chavesEmCache;
  })();

  try {
    return await gerando;
  } finally {
    gerando = null;
  }
}

/** Cabeçalho `Authorization: vapid t=<jwt>, k=<chave pública>`. */
function autorizacaoVapid(chaves, endpoint) {
  const cabecalho = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corpo = base64url(
    JSON.stringify({
      aud: new URL(endpoint).origin,
      exp: Math.floor(Date.now() / 1000) + VALIDADE_JWT_SEGUNDOS,
      sub: ASSUNTO_VAPID,
    }),
  );
  const assinatura = crypto.sign('sha256', Buffer.from(`${cabecalho}.${corpo}`), {
    key: chaves.privada,
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${cabecalho}.${corpo}.${base64url(assinatura)}, k=${chaves.publicaBase64Url}`;
}

/**
 * Cifra o payload no formato `aes128gcm` (RFC 8291).
 * Cabeçalho do corpo: salt (16) | rs (4) | idlen (1) | chave efêmera (65) | cifra.
 */
export function cifrarPayload(texto, { p256dh, auth }) {
  const chaveNavegador = Buffer.from(String(p256dh), 'base64url');
  if (chaveNavegador.length !== 65 || chaveNavegador[0] !== 0x04) {
    throw new Error('Chave p256dh da inscrição é inválida.');
  }
  const segredoAuth = Buffer.from(String(auth), 'base64url');
  if (segredoAuth.length !== 16) {
    throw new Error('Segredo auth da inscrição é inválido.');
  }

  const efemea = crypto.createECDH('prime256v1');
  const chaveEfemea = efemea.generateKeys();
  const segredo = efemea.computeSecret(chaveNavegador);

  // PRK da RFC 8291: HKDF(salt = auth_secret, ikm = ecdh_secret).
  const infoChave = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), chaveNavegador, chaveEfemea]);
  const prkChave = Buffer.from(crypto.hkdfSync('sha256', segredo, segredoAuth, infoChave, 32));

  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(
    crypto.hkdfSync('sha256', prkChave, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16),
  );
  const nonce = Buffer.from(
    crypto.hkdfSync('sha256', prkChave, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12),
  );

  // Registro único: conteúdo + delimitador 0x02 (último registro).
  const registro = Buffer.concat([Buffer.from(texto, 'utf8'), Buffer.from([0x02])]);
  const cifra = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const corpoCifrado = Buffer.concat([cifra.update(registro), cifra.final(), cifra.getAuthTag()]);

  const cabecalho = Buffer.alloc(5);
  cabecalho.writeUInt32BE(TAMANHO_REGISTRO, 0);
  cabecalho.writeUInt8(chaveEfemea.length, 4);

  return Buffer.concat([salt, cabecalho, chaveEfemea, corpoCifrado]);
}

/**
 * Entrega uma notificação a uma inscrição. Devolve o status HTTP do serviço de
 * push; 404/410 significam inscrição morta e são tratados por quem chama.
 */
export async function enviarPush(inscricao, dados) {
  const chaves = await obterChavesVapid();
  const corpo = cifrarPayload(JSON.stringify(dados ?? {}), inscricao);
  const resposta = await fetch(inscricao.endpoint, {
    method: 'POST',
    headers: {
      Authorization: autorizacaoVapid(chaves, inscricao.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(dados?.ttl ?? 3600),
      Urgency: dados?.urgente === false ? 'normal' : 'high',
      'Content-Length': String(corpo.length),
    },
    body: corpo,
    signal: AbortSignal.timeout(LIMITE_ENVIO_MS),
  });
  // Consome o corpo para liberar o socket (a resposta do serviço é irrelevante).
  await resposta.arrayBuffer().catch(() => {});
  return resposta.status;
}

/** Inscrições de um usuário, prontas para envio. */
export async function inscricoesDoUsuario(usuarioId) {
  return consultar(
    'SELECT id, usuario_id, endpoint, p256dh, auth FROM push_inscricoes WHERE usuario_id = ? ORDER BY id',
    usuarioId,
  );
}

/**
 * Envia o mesmo aviso para todas as inscrições de vários usuários.
 * Inscrições expiradas (404/410) são removidas na hora; falhas viram contador
 * para que uma inscrição problemática possa ser identificada depois.
 */
export async function enviarPushParaUsuarios(usuarios, dados) {
  const resumo = { enviados: 0, removidos: 0, falhas: 0 };
  if (!usuarios?.length) return resumo;

  const agora = agoraISO();
  for (const usuario of usuarios) {
    const inscricoes = await inscricoesDoUsuario(usuario.id);
    for (const inscricao of inscricoes) {
      try {
        const status = await enviarPush(inscricao, dados);
        if (status === 404 || status === 410) {
          await executar('DELETE FROM push_inscricoes WHERE id = ?', inscricao.id);
          resumo.removidos += 1;
        } else if (status >= 400) {
          resumo.falhas += 1;
          await executar('UPDATE push_inscricoes SET falhas = falhas + 1 WHERE id = ?', inscricao.id);
          console.warn(`[push] serviço respondeu ${status} para a inscrição ${inscricao.id}`);
        } else {
          resumo.enviados += 1;
          await executar('UPDATE push_inscricoes SET falhas = 0, ultimo_envio_em = ? WHERE id = ?', agora, inscricao.id);
        }
      } catch (erro) {
        resumo.falhas += 1;
        console.warn('[push] falha ao enviar:', erro?.message ?? erro);
      }
    }
  }
  return resumo;
}
