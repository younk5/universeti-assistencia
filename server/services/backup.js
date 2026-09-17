import {
  consultar,
  executar,
  semChavesEstrangeiras,
  suspenderProtecaoAuditoria,
  restaurarProtecaoAuditoria,
} from '../db.js';
import { agoraISO } from '../utils.js';
import { invalido } from '../erros.js';

/**
 * Backup do banco em JSON (dados, não os arquivos das fotos).
 *
 * As fotos ficam no armazenamento (Blob na Vercel ou disco local); o backup
 * guarda apenas as referências. Serve para recuperação do banco e para migrar
 * entre ambientes.
 */

const TABELAS = [
  { nome: 'lojas', colunas: ['id', 'codigo', 'nome', 'endereco', 'telefone', 'ativo', 'criado_em'] },
  {
    nome: 'usuarios',
    colunas: ['id', 'nome', 'email', 'senha_hash', 'papel', 'loja_id', 'telefone', 'ativo', 'criado_em'],
  },
  {
    nome: 'ordens_servico',
    colunas: [
      'id', 'numero_os', 'loja_id', 'cliente_nome', 'cliente_telefone', 'tipo_aparelho', 'marca', 'modelo',
      'cor', 'imei', 'acessorios', 'defeito_relatado', 'estado_aparelho', 'status', 'prioridade', 'valor',
      'valor_pago', 'atendente_entrada_id', 'tecnico_id', 'recebido_por', 'iniciado_em', 'concluido_em',
      'retirado_em', 'criado_em', 'atualizado_em',
    ],
  },
  {
    nome: 'fotos_os',
    colunas: ['id', 'os_id', 'tipo', 'arquivo', 'mime', 'tamanho', 'legenda', 'usuario_id', 'criado_em'],
  },
  {
    nome: 'eventos_os',
    colunas: ['id', 'os_id', 'tipo_evento', 'status_anterior', 'status_novo', 'descricao', 'usuario_id', 'criado_em'],
  },
  {
    nome: 'exclusoes_log',
    colunas: ['id', 'tipo', 'referencia', 'detalhes', 'usuario_id', 'usuario_nome', 'criado_em'],
  },
];

export async function exportarBanco() {
  const tabelas = {};
  for (const tabela of TABELAS) {
    tabelas[tabela.nome] = await consultar(`SELECT * FROM ${tabela.nome} ORDER BY id ASC`);
  }
  return { app: 'universeti-assistencia', versao: 1, geradoEm: agoraISO(), tabelas };
}

export async function importarBanco(backup) {
  const tabelas = backup?.tabelas;
  if (!backup || typeof backup !== 'object' || !tabelas || typeof tabelas !== 'object') {
    throw invalido('Arquivo de backup inválido: estrutura não reconhecida.');
  }
  for (const tabela of TABELAS) {
    if (tabelas[tabela.nome] !== undefined && !Array.isArray(tabelas[tabela.nome])) {
      throw invalido(`O backup traz a tabela "${tabela.nome}" em formato inesperado.`);
    }
  }

  const resumo = {};
  await suspenderProtecaoAuditoria();
  try {
    await semChavesEstrangeiras(async () => {
      for (const nome of ['eventos_os', 'fotos_os', 'ordens_servico', 'exclusoes_log', 'usuarios', 'lojas', 'sessoes']) {
        await executar(`DELETE FROM ${nome}`);
      }
      for (const tabela of TABELAS) {
        const linhas = tabelas[tabela.nome] ?? [];
        for (const linha of linhas) {
          const valores = tabela.colunas.map((coluna) => (linha[coluna] === undefined ? null : linha[coluna]));
          await executar(
            `INSERT INTO ${tabela.nome} (${tabela.colunas.join(', ')}) VALUES (${tabela.colunas.map(() => '?').join(', ')})`,
            ...valores,
          );
        }
        resumo[tabela.nome] = linhas.length;
      }
    });
  } finally {
    await restaurarProtecaoAuditoria();
  }
  return resumo;
}
