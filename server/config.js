import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raizProjeto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function env(chave, padrao) {
  const valor = process.env[chave];
  return valor === undefined || valor === '' ? padrao : valor;
}

export const config = {
  raizProjeto,
  porta: Number(env('PORT', 3000)),
  host: env('HOST', '0.0.0.0'),
  dataDir: path.resolve(raizProjeto, env('DATA_DIR', './data')),
  publicDir: path.join(raizProjeto, 'public'),
  sessionSecret: env('SESSION_SECRET', 'troque-este-segredo-em-producao'),
  sessionTtlDias: Number(env('SESSION_TTL_DIAS', 30)),
  maxUploadBytes: 6 * 1024 * 1024,
  ambiente: env('NODE_ENV', 'development'),
};

export const caminhos = {
  banco: path.join(config.dataDir, 'tecnoflow.db'),
  uploads: path.join(config.dataDir, 'uploads'),
};

export function validarConfig() {
  const problemas = [];
  if (config.ambiente === 'production' && config.sessionSecret === 'troque-este-segredo-em-producao') {
    problemas.push('SESSION_SECRET padrão não pode ser usado em produção. Defina a variável de ambiente.');
  }
  if (!Number.isInteger(config.porta) || config.porta < 0 || config.porta > 65535) {
    problemas.push(`PORT inválida: ${config.porta}`);
  }
  return problemas;
}
