import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { config, caminhos } from './config.js';
import { carregarDriver, prepararBanco, transacao, consultarUm, executar, fecharBanco, driverAtual } from './db.js';
import { gerarHashSenha } from './auth.js';
import { salvarImagem } from './storage.js';
import { agoraISO } from './utils.js';

/* -------------------------------------------------------------------------- */
/* Gerador de PNG sólido — usado para as fotos de exemplo do seed              */
/* -------------------------------------------------------------------------- */

const TABELA_CRC = (() => {
  const tabela = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c;
  }
  return tabela;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = TABELA_CRC[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function bloco(tipo, dados) {
  const comprimento = Buffer.alloc(4);
  comprimento.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([comprimento, corpo, crc]);
}

export function pngSolido(largura, altura, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const linha = Buffer.alloc(1 + largura * 3);
  for (let x = 0; x < largura; x += 1) {
    linha[1 + x * 3] = r;
    linha[2 + x * 3] = g;
    linha[3 + x * 3] = b;
  }
  const cru = Buffer.concat(Array.from({ length: altura }, () => linha));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', zlib.deflateSync(cru, { level: 9 })),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------------- */

const LOJAS = [
  { codigo: 'GUA', nome: 'Guarulhos Centro', endereco: 'Av. Paulo Faccini, 1200 - Centro, Guarulhos/SP', telefone: '(11) 2408-1122' },
  { codigo: 'GUM', nome: 'Guarulhos Cumbica', endereco: 'Rua Siqueira Bueno, 455 - Cumbica, Guarulhos/SP', telefone: '(11) 2412-3344' },
  { codigo: 'GUP', nome: 'Guarulhos Pimentas', endereco: 'Estrada do Capão Bonito, 890 - Pimentas, Guarulhos/SP', telefone: '(11) 2229-7788' },
];

const SENHA_PADRAO = 'galaxy2026!';

const USUARIOS = [
  { nome: 'UniverseTI', email: 'universeti', papel: 'admin', loja: null, telefone: '(11) 99811-0001' },
  { nome: 'Camila Ribeiro', email: 'atendente.centro@universeti.com.br', papel: 'atendente', loja: 'GUA', telefone: '(11) 99811-0002' },
  { nome: 'Juliana Prado', email: 'atendente.cumbica@universeti.com.br', papel: 'atendente', loja: 'GUM', telefone: '(11) 99811-0003' },
  { nome: 'Rafael Souza', email: 'tecnico.centro@universeti.com.br', papel: 'tecnico', loja: 'GUA', telefone: '(11) 99811-0004' },
  { nome: 'Diego Martins', email: 'tecnico.cumbica@universeti.com.br', papel: 'tecnico', loja: 'GUM', telefone: '(11) 99811-0005' },
  { nome: 'Patrícia Lopes', email: 'tecnico.pimentas@universeti.com.br', papel: 'tecnico', loja: 'GUP', telefone: '(11) 99811-0006' },
];

const CLIENTES = [
  ['Anderson Lima', '(11) 98765-4321'],
  ['Beatriz Nogueira', '(11) 97654-3210'],
  ['Carlos Eduardo Santos', '(11) 96543-2109'],
  ['Débora Alves', '(11) 95432-1098'],
  ['Eduardo Nakamura', '(11) 94321-0987'],
  ['Fabiana Costa', '(11) 93210-9876'],
  ['Gustavo Peixoto', '(11) 92109-8765'],
  ['Helena Barros', '(11) 91098-7654'],
  ['Igor Menezes', '(11) 90987-6543'],
  ['Jéssica Ferraz', '(11) 99876-5432'],
];

const APARELHOS = [
  ['Celular', 'Apple', 'iPhone 13', 'Meia-noite', 'Tela trincada após queda; touch funcionando.'],
  ['Celular', 'Samsung', 'Galaxy A54', 'Prata', 'Não carrega, suspeita de conector de carga.'],
  ['Celular', 'Motorola', 'Moto G84', 'Azul', 'Bateria acaba muito rápido.'],
  ['Celular', 'Xiaomi', 'Redmi Note 12', 'Graphite', 'Aparelho reiniciando sozinho.'],
  ['Tablet', 'Apple', 'iPad 9ª geração', 'Espaço cinza', 'Vidro trincado no canto inferior.'],
  ['Notebook', 'Dell', 'Inspiron 15 3520', 'Preto', 'Teclado com teclas não respondendo.'],
  ['Notebook', 'Acer', 'Aspire 5', 'Prata', 'Superaquecendo e desligando sozinho.'],
  ['Celular', 'Apple', 'iPhone 11', 'Branco', 'Câmera frontal embaçada.'],
  ['Smartwatch', 'Samsung', 'Galaxy Watch 5', 'Preto', 'Não sincroniza e descarrega rápido.'],
  ['Celular', 'Samsung', 'Galaxy S22', 'Verde', 'Alto-falante com som baixo.'],
];

const DEFEITOS_EXTRA = [
  'Cliente relata que o aparelho caiu na água.',
  'Aparelho chegou sem carregador.',
  'Película aplicada, remover na bancada.',
  'Aparelho com traseira amassada.',
];

const diasAtras = (dias, hora = 10, minuto = 30) => {
  const data = new Date();
  data.setDate(data.getDate() - dias);
  data.setHours(hora, minuto, 0, 0);
  return data;
};

const iso = (data) => data.toISOString();
const sortear = (lista, indice) => lista[indice % lista.length];

/* -------------------------------------------------------------------------- */

async function limparDados() {
  if (driverAtual() === 'turso') {
    for (const tabela of ['eventos_os', 'fotos_os', 'ordens_servico', 'sessoes', 'usuarios', 'lojas']) {
      await executar(`DELETE FROM ${tabela}`);
    }
    return;
  }
  await fecharBanco();
  for (const arquivo of fs.existsSync(caminhos.uploads) ? fs.readdirSync(caminhos.uploads) : []) {
    fs.rmSync(path.join(caminhos.uploads, arquivo), { force: true });
  }
  for (const sufixo of ['', '-wal', '-shm']) {
    fs.rmSync(`${caminhos.banco}${sufixo}`, { force: true });
  }
}

async function semear() {
  const cores = {
    entrada: [90, 116, 158],
    saida: [76, 149, 108],
    retirada: [168, 132, 74],
    assinatura: [120, 96, 150],
  };

  const cenarios = [
    { status: 'retirado', dias: 32, comFotos: ['entrada', 'saida', 'retirada'] },
    { status: 'retirado', dias: 28, comFotos: ['entrada', 'saida', 'retirada'] },
    { status: 'retirado', dias: 21, comFotos: ['entrada', 'saida'] },
    { status: 'retirado', dias: 18, comFotos: ['entrada', 'saida', 'retirada'] },
    { status: 'retirado', dias: 12, comFotos: ['entrada', 'saida'] },
    { status: 'retirado', dias: 9, comFotos: ['entrada', 'saida', 'retirada'] },
    { status: 'pronto', dias: 6, comFotos: ['entrada', 'saida'] },
    { status: 'pronto', dias: 5, comFotos: ['entrada', 'saida'] },
    { status: 'pronto', dias: 3, comFotos: ['entrada'] },
    { status: 'em_manutencao', dias: 4, comFotos: ['entrada'] },
    { status: 'em_manutencao', dias: 2, comFotos: ['entrada'] },
    { status: 'aguardando_peca', dias: 7, comFotos: ['entrada'] },
    { status: 'aguardando', dias: 1, comFotos: ['entrada'] },
    { status: 'aguardando', dias: 0, comFotos: ['entrada'] },
    { status: 'aguardando', dias: 0, comFotos: [] },
    { status: 'cancelado', dias: 11, comFotos: ['entrada'] },
  ];

  const resumo = await transacao(async (conexao) => {
    const agora = agoraISO();
    const idLoja = {};

    for (const loja of LOJAS) {
      const info = await conexao.run(
        'INSERT INTO lojas (codigo, nome, endereco, telefone, ativo, criado_em) VALUES (?, ?, ?, ?, 1, ?)',
        [loja.codigo, loja.nome, loja.endereco, loja.telefone, agora],
      );
      idLoja[loja.codigo] = Number(info.lastInsertRowid);
    }

    const atendentes = [];
    const tecnicos = [];
    let adminId = null;

    for (const usuario of USUARIOS) {
      const info = await conexao.run(
        `INSERT INTO usuarios (nome, email, senha_hash, papel, loja_id, telefone, ativo, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          usuario.nome,
          usuario.email,
          gerarHashSenha(SENHA_PADRAO),
          usuario.papel,
          usuario.loja ? idLoja[usuario.loja] : null,
          usuario.telefone,
          agora,
        ],
      );
      const id = Number(info.lastInsertRowid);
      if (usuario.papel === 'admin') adminId = id;
      else if (usuario.papel === 'atendente') atendentes.push({ id, loja: idLoja[usuario.loja], nome: usuario.nome });
      else tecnicos.push({ id, loja: idLoja[usuario.loja], nome: usuario.nome });
    }

    const inserirEvento = (osId, tipoEvento, anterior, novo, descricao, usuarioId, data) =>
      conexao.run(
        `INSERT INTO eventos_os (os_id, tipo_evento, status_anterior, status_novo, descricao, usuario_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [osId, tipoEvento, anterior, novo, descricao, usuarioId, iso(data)],
      );

    const fotosParaEnviar = [];

    for (const [indice, cenario] of cenarios.entries()) {
      const lojaCodigo = sortear(LOJAS, indice).codigo;
      const lojaId = idLoja[lojaCodigo];
      const atendente = atendentes.find((a) => a.loja === lojaId) ?? atendentes[0];
      const tecnico = tecnicos.find((t) => t.loja === lojaId) ?? tecnicos[0];
      const [clienteNome, clienteTelefone] = sortear(CLIENTES, indice);
      const [, marca, modelo, cor, defeito] = sortear(APARELHOS, indice);

      const criado = diasAtras(cenario.dias, 9 + (indice % 8), (indice * 7) % 60);
      const ano = criado.getFullYear();
      const prefixo = `${lojaCodigo}-${ano}-`;
      const ultimo = await conexao.get(
        'SELECT numero_os FROM ordens_servico WHERE numero_os LIKE ? ORDER BY numero_os DESC LIMIT 1',
        [`${prefixo}%`],
      );
      const sequencia = ultimo ? Number(String(ultimo.numero_os).slice(prefixo.length)) + 1 : 1;
      const numeroOS = `${prefixo}${String(sequencia).padStart(4, '0')}`;

      const iniciado = ['aguardando', 'cancelado'].includes(cenario.status)
        ? null
        : new Date(criado.getTime() + 3 * 3600 * 1000);
      const concluido = ['pronto', 'retirado'].includes(cenario.status)
        ? new Date(criado.getTime() + (14 + indice * 3) * 3600 * 1000)
        : null;
      const retiradoEm = cenario.status === 'retirado'
        ? new Date(concluido.getTime() + (5 + (indice % 4) * 6) * 3600 * 1000)
        : null;
      const valor = ['pronto', 'retirado'].includes(cenario.status) ? 180 + (indice % 6) * 65 : null;

      const info = await conexao.run(
        `INSERT INTO ordens_servico (
            numero_os, loja_id, cliente_nome, cliente_telefone, tipo_aparelho, marca, modelo, cor, imei,
            acessorios, defeito_relatado, estado_aparelho, status, valor, valor_pago,
            atendente_entrada_id, tecnico_id, recebido_por, iniciado_em, concluido_em, retirado_em, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          numeroOS,
          lojaId,
          clienteNome,
          clienteTelefone,
          'Celular',
          marca,
          modelo,
          cor,
          String(350000000000000 + indice * 137),
          indice % 3 === 0 ? 'Carregador e capa' : null,
          defeito,
          sortear(DEFEITOS_EXTRA, indice),
          cenario.status,
          valor,
          cenario.status === 'retirado' ? 1 : 0,
          atendente.id,
          iniciado ? tecnico.id : null,
          retiradoEm ? clienteNome : null,
          iniciado ? iso(iniciado) : null,
          concluido ? iso(concluido) : null,
          retiradoEm ? iso(retiradoEm) : null,
          iso(criado),
          iso(retiradoEm ?? concluido ?? iniciado ?? criado),
        ],
      );

      const osId = Number(info.lastInsertRowid);

      await inserirEvento(osId, 'criacao', null, 'aguardando', `Entrada registrada por ${atendente.nome}`, atendente.id, criado);

      if (iniciado) {
        await inserirEvento(osId, 'assumir', 'aguardando', 'em_manutencao', `Aparelho assumido por ${tecnico.nome}`, tecnico.id, iniciado);
        await inserirEvento(
          osId,
          'comentario',
          null,
          null,
          `Diagnóstico: ${defeito} Peça encomendada no fornecedor local.`,
          tecnico.id,
          new Date(iniciado.getTime() + 3600 * 1000),
        );
      }
      if (cenario.status === 'aguardando_peca') {
        await inserirEvento(
          osId,
          'status',
          'em_manutencao',
          'aguardando_peca',
          'Aguardando chegada da peça do fornecedor.',
          tecnico.id,
          new Date(iniciado.getTime() + 4 * 3600 * 1000),
        );
      }
      if (concluido) {
        await inserirEvento(
          osId,
          'finalizar',
          'em_manutencao',
          'pronto',
          `Serviço realizado: troca de componente danificado. Valor: R$ ${Number(valor).toFixed(2)} | Garantia: 90 dias`,
          tecnico.id,
          concluido,
        );
      }
      if (retiradoEm) {
        await inserirEvento(
          osId,
          'retirar',
          'pronto',
          'retirado',
          `Entrega registrada por ${atendente.nome} | Recebido por: ${clienteNome} | Pagamento confirmado`,
          atendente.id,
          retiradoEm,
        );
      }
      if (cenario.status === 'cancelado') {
        await inserirEvento(
          osId,
          'status',
          'aguardando',
          'cancelado',
          'Cliente desistiu do reparo — orçamento recusado.',
          adminId,
          new Date(criado.getTime() + 6 * 3600 * 1000),
        );
      }

      cenario.comFotos.forEach((tipoFoto, i) => {
        const quando = tipoFoto === 'entrada' ? criado : tipoFoto === 'saida' ? concluido ?? criado : retiradoEm ?? criado;
        fotosParaEnviar.push({
          osId,
          tipoFoto,
          conteudo: pngSolido(320, 240, cores[tipoFoto]),
          quando: new Date(quando.getTime() + i * 60 * 1000),
          usuarioId: tipoFoto === 'entrada' ? atendente.id : tecnico.id,
          legenda:
            tipoFoto === 'entrada'
              ? 'Estado do aparelho na entrada'
              : tipoFoto === 'saida'
                ? 'Aparelho após o reparo'
                : 'Comprovante de entrega',
        });
      });
    }

    return { lojas: LOJAS.length, usuarios: USUARIOS.length, ordens: cenarios.length, fotos: fotosParaEnviar };
  });

  // As imagens vão para o armazenamento (disco local ou Blob) fora da transação:
  // uploads de rede não devem segurar o lock de escrita do banco.
  for (const foto of resumo.fotos) {
    const nomeArquivo = `seed-${foto.osId}-${foto.tipoFoto}.png`;
    const referencia = await salvarImagem(foto.conteudo, nomeArquivo, 'image/png');
    await executar(
      `INSERT INTO fotos_os (os_id, tipo, arquivo, mime, tamanho, legenda, usuario_id, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      foto.osId,
      foto.tipoFoto,
      referencia,
      'image/png',
      foto.conteudo.length,
      foto.legenda,
      foto.usuarioId,
      iso(foto.quando),
    );
  }

  return resumo;
}

async function main() {
  const resetar = process.argv.includes('--reset');
  const apenasLimpar = process.argv.includes('--limpar');

  await carregarDriver();
  await prepararBanco();

  if (resetar || apenasLimpar) {
    await limparDados();
    await carregarDriver();
    await prepararBanco();
    console.log(`Dados anteriores removidos de ${driverAtual()}.`);
    if (apenasLimpar) {
      const restante = await consultarUm('SELECT COUNT(*) AS total FROM usuarios');
      console.log(`Usuários restantes: ${restante.total}. A aplicação criará o administrador no próximo acesso.`);
      await fecharBanco();
      return;
    }
  }

  const existentes = await consultarUm('SELECT COUNT(*) AS total FROM usuarios');
  if (Number(existentes.total) > 0) {
    console.log('O banco já possui dados. Use "npm run reset" para recriar do zero.');
    await fecharBanco();
    return;
  }

  const resumo = await semear();

  console.log(`\nSeed concluído em ${driverAtual()}:`);
  console.log(`  Lojas:    ${resumo.lojas}`);
  console.log(`  Usuários: ${resumo.usuarios}`);
  console.log(`  Ordens:   ${resumo.ordens}`);
  console.log(`  Fotos:    ${resumo.fotos.length}`);
  console.log('\nAcessos (senha padrão para todos):', SENHA_PADRAO);
  for (const usuario of USUARIOS) console.log(`  ${usuario.papel.padEnd(9)} ${usuario.email}`);
  console.log();
  await fecharBanco();
}

main().catch(async (erro) => {
  console.error('\n[seed] falhou:', erro.message);
  if (config.ambiente !== 'production') console.error(erro);
  await fecharBanco().catch(() => {});
  process.exit(1);
});
