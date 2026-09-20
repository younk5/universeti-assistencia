export const ROTULOS_STATUS = Object.freeze({
  aguardando: 'Aguardando',
  em_manutencao: 'Em manutenção',
  aguardando_peca: 'Aguardando peça',
  pronto: 'Pronto para retirada',
  retirado: 'Retirado',
  cancelado: 'Cancelado',
});

export const DESCRICAO_STATUS = Object.freeze({
  aguardando: 'Na fila da loja, ainda sem técnico responsável.',
  em_manutencao: 'Um técnico está trabalhando no aparelho.',
  aguardando_peca: 'Reparo pausado esperando a chegada de uma peça.',
  pronto: 'Serviço concluído, aguardando o cliente buscar.',
  retirado: 'Entregue ao cliente. Registro encerrado.',
  cancelado: 'Fluxo encerrado sem reparo.',
});

export const ORDEM_STATUS = ['aguardando', 'em_manutencao', 'aguardando_peca', 'pronto', 'retirado', 'cancelado'];

export const COR_STATUS = Object.freeze({
  aguardando: 'var(--cor-aviso)',
  em_manutencao: 'var(--cor-info)',
  aguardando_peca: 'var(--cor-roxo)',
  pronto: 'var(--cor-sucesso)',
  retirado: 'var(--cor-texto-fraco)',
  cancelado: 'var(--cor-perigo)',
});

export const ROTULOS_TIPO_FOTO = Object.freeze({
  entrada: 'Entrada',
  saida: 'Saída',
  retirada: 'Retirada',
  assinatura: 'Assinatura',
});

export const ROTULOS_TIPO_EVENTO = Object.freeze({
  criacao: 'Entrada registrada',
  status: 'Mudança de status',
  assumir: 'Aparelho assumido',
  finalizar: 'Serviço concluído',
  retirar: 'Entregue ao cliente',
  comentario: 'Anotação',
  foto: 'Foto anexada',
  edicao: 'Dados atualizados',
  reabertura: 'OS reaberta',
  orcamento: 'Orçamento enviado',
  orcamento_aprovado: 'Orçamento aprovado',
  orcamento_recusado: 'Orçamento recusado',
  garantia: 'Retorno em garantia',
});

export const CHECKLIST_ITENS = [
  { chave: 'liga', rotulo: 'Liga / dá sinal de vida' },
  { chave: 'telaTrincada', rotulo: 'Tela trincada' },
  { chave: 'telaManchada', rotulo: 'Tela com manchas/linhas' },
  { chave: 'carcacaAmassada', rotulo: 'Carcaça amassada' },
  { chave: 'traseiraTrincada', rotulo: 'Traseira/tampa trincada' },
  { chave: 'cameraDanificada', rotulo: 'Câmera danificada' },
  { chave: 'conectorCargaDanificado', rotulo: 'Conector de carga danificado' },
  { chave: 'botoesDanificados', rotulo: 'Botões danificados' },
  { chave: 'altoFalanteDanificado', rotulo: 'Alto-falante danificado' },
  { chave: 'bateriaInchada', rotulo: 'Bateria inchada' },
  { chave: 'oxidacao', rotulo: 'Sinais de oxidação' },
  { chave: 'queda', rotulo: 'Já sofreu queda' },
  { chave: 'molhou', rotulo: 'Já molhou' },
  { chave: 'aquecendo', rotulo: 'Esquenta ao carregar' },
  { chave: 'riscosUso', rotulo: 'Riscos de uso' },
  { chave: 'comConta', rotulo: 'Veio com conta (Google/iCloud) ativa' },
  { chave: 'pelicula', rotulo: 'Com película aplicada' },
  { chave: 'senhaInformada', rotulo: 'Cliente informou a senha' },
  { chave: 'backupAutorizado', rotulo: 'Autoriza backup dos dados' },
];

export const ROTULOS_SENHA = {
  numerica: 'Senha numérica (PIN)',
  texto: 'Senha com letras',
  padrao: 'Desenho (padrão)',
};

export const ETAPAS_FLUXO = [
  { status: 'aguardando', rotulo: 'Entrada', icone: 'caixa' },
  { status: 'em_manutencao', rotulo: 'Em bancada', icone: 'ferramenta' },
  { status: 'pronto', rotulo: 'Pronto', icone: 'check' },
  { status: 'retirado', rotulo: 'Retirado', icone: 'assinatura' },
];

export function indiceEtapa(status) {
  switch (status) {
    case 'aguardando':
      return 0;
    case 'em_manutencao':
    case 'aguardando_peca':
      return 1;
    case 'pronto':
      return 2;
    case 'retirado':
      return 3;
    default:
      return 0;
  }
}
