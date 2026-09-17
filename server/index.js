import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, caminhos, validarConfig } from './config.js';
import { fecharBanco, driverAtual, descreverBanco } from './db.js';
import { criarHandler, prepararAplicacao } from './app.js';
import { limparSessoesExpiradas } from './auth.js';

export function criarServidor() {
  return http.createServer(criarHandler({ servirEstaticos: true }));
}

export async function iniciar() {
  const problemas = validarConfig();
  if (problemas.length) {
    console.error('\n[configuração inválida]');
    problemas.forEach((p) => console.error(` • ${p}`));
    process.exit(1);
  }

  try {
    await prepararAplicacao();
  } catch (erro) {
    console.error('\n[falha ao preparar o banco]', erro.message);
    process.exit(1);
  }

  setInterval(() => {
    limparSessoesExpiradas().catch((erro) => console.warn('[sessoes] limpeza falhou:', erro.message));
  }, 6 * 60 * 60 * 1000).unref();

  const servidor = criarServidor();
  servidor.listen(config.porta, config.host, () => {
    console.log(
      [
        '',
        '  UniverseTI Assistência — Ordens de Serviço',
        '  ──────────────────────────────────────────────────────',
        `  Local:    http://localhost:${config.porta}`,
        `  Rede:     http://<ip-da-maquina>:${config.porta}  (acesse pelo celular)`,
        `  Banco:    ${descreverBanco()} [${driverAtual()}]`,
        `  Fotos:    ${caminhos.uploads}`,
        '',
      ].join('\n'),
    );
  });

  const encerrar = (sinal) => {
    console.log(`\n[${sinal}] encerrando servidor...`);
    servidor.close(async () => {
      await fecharBanco().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => encerrar('SIGINT'));
  process.on('SIGTERM', () => encerrar('SIGTERM'));

  return servidor;
}

const ehPontoDeEntrada =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (ehPontoDeEntrada) {
  iniciar();
}
