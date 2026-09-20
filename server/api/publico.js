import { consultar, consultarUm } from '../db.js';
import { exigirTexto, normalizarDigitos } from '../utils.js';
import { ROTULOS_STATUS } from '../services/ordens.js';
import { orcamentoPublico, decidirOrcamentoPorToken, STATUS_ORCAMENTO, ROTULOS_ORCAMENTO } from '../services/orcamentos.js';
import { lerNumeroConfig, CHAVES } from '../services/configuracoes.js';
import { invalido } from '../erros.js';

/**
 * Rotas públicas (sem login) usadas pelo cliente final:
 *   • acompanhamento da OS por número + 4 últimos dígitos do telefone;
 *   • aprovação/recusa de orçamento por link com token.
 *
 * Expõem apenas o necessário — nunca valores internos, custos ou anotações
 * técnicas completas.
 */

const ROTULOS_EVENTO_PUBLICO = {
  criacao: 'Entrada registrada',
  assumir: 'Aparelho na bancada',
  finalizar: 'Serviço concluído',
  retirar: 'Aparelho retirado',
  orcamento: 'Orçamento enviado para aprovação',
  orcamento_aprovado: 'Orçamento aprovado pelo cliente',
  orcamento_recusado: 'Orçamento recusado pelo cliente',
};

function linhaDoTempo(eventos) {
  return eventos
    .filter((e) => ROTULOS_EVENTO_PUBLICO[e.tipo_evento])
    .map((e) => ({
      tipo: e.tipo_evento,
      rotulo: ROTULOS_EVENTO_PUBLICO[e.tipo_evento],
      quando: e.criado_em,
    }));
}

export function registrar(rota) {
  /* ---------------------- Acompanhamento da OS ---------------------------- */
  rota.get('/api/publico/os/:numero', async (ctx) => {
    const numero = exigirTexto(ctx.params.numero, 'número da OS', { max: 40 }).toUpperCase();
    const digitos = normalizarDigitos(ctx.query.tel ?? '');
    if (digitos.length < 4) {
      throw invalido('Informe os 4 últimos dígitos do telefone cadastrado.', { campo: 'tel' });
    }

    const os = await consultarUm(
      `SELECT o.id, o.numero_os, o.status, o.marca, o.modelo, o.cor, o.criado_em, o.concluido_em,
              o.retirado_em, o.garantia_ate, o.orcamento_status, o.orcamento_valor,
              o.cliente_telefone, l.nome AS loja_nome, l.telefone AS loja_telefone
         FROM ordens_servico o
         LEFT JOIN lojas l ON l.id = o.loja_id
        WHERE o.numero_os = ?`,
      numero,
    );

    // Sem revelar se o número existe: a mesma mensagem para OS inexistente e
    // telefone que não bate evita varredura de números de OS.
    const cadastrado = os ? normalizarDigitos(os.cliente_telefone) : '';
    if (!os || !cadastrado.endsWith(digitos)) {
      throw invalido('Não encontramos uma OS com esse número e telefone.', { campo: 'tel' });
    }

    const eventos = await consultar(
      'SELECT tipo_evento, criado_em FROM eventos_os WHERE os_id = ? ORDER BY id ASC',
      os.id,
    );

    // Previsão de retirada: prazo padrão a partir da entrada, enquanto o
    // aparelho ainda está em fluxo. Quando pronto, já está liberado.
    const prazoDias = await lerNumeroConfig(CHAVES.PRAZO_DIAS, 5);
    let previsaoRetirada = null;
    if (['aguardando', 'em_manutencao', 'aguardando_peca'].includes(os.status) && prazoDias > 0) {
      previsaoRetirada = new Date(new Date(os.criado_em).getTime() + prazoDias * 86400000).toISOString();
    }

    return {
      ordem: {
        numeroOS: os.numero_os,
        status: os.status,
        statusRotulo: ROTULOS_STATUS[os.status] ?? os.status,
        marca: os.marca,
        modelo: os.modelo,
        cor: os.cor,
        lojaNome: os.loja_nome,
        lojaTelefone: os.loja_telefone,
        criadoEm: os.criado_em,
        concluidoEm: os.concluido_em,
        retiradoEm: os.retirado_em,
        garantiaAte: os.garantia_ate,
        orcamentoStatus: os.orcamento_status ?? STATUS_ORCAMENTO.SEM_ORCAMENTO,
        orcamentoRotulo: ROTULOS_ORCAMENTO[os.orcamento_status ?? STATUS_ORCAMENTO.SEM_ORCAMENTO],
        orcamentoValor: os.orcamento_valor,
        previsaoRetirada,
      },
      linhaDoTempo: linhaDoTempo(eventos),
    };
  });

  /* ------------------------ Orçamento público ----------------------------- */
  rota.get('/api/publico/orcamento/:token', async (ctx) => {
    return { orcamento: await orcamentoPublico(ctx.params.token) };
  });

  rota.post('/api/publico/orcamento/:token', async (ctx) => {
    const decisao = exigirTexto(ctx.corpo.decisao, 'decisão', { max: 20 });
    const observacao = exigirTexto(ctx.corpo.observacao, 'observação', { max: 300, opcional: true });
    const resultado = await decidirOrcamentoPorToken(ctx.params.token, { decisao, observacao });
    return {
      resultado,
      mensagem:
        decisao === STATUS_ORCAMENTO.APROVADO
          ? 'Orçamento aprovado. Obrigado! Já avisamos a loja.'
          : 'Resposta registrada. A loja entrará em contato.',
    };
  });
}
