/**
 * Erros de domínio. Todo erro previsto carrega um status HTTP e um código
 * estável, para que o front-end exiba mensagens úteis em vez de "erro genérico".
 */
export class ErroApp extends Error {
  constructor(mensagem, { status = 400, codigo = 'erro_validacao', detalhes = null } = {}) {
    super(mensagem);
    this.name = 'ErroApp';
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
    this.esperado = true;
  }
}

export const naoAutenticado = (msg = 'Você precisa entrar para continuar.') =>
  new ErroApp(msg, { status: 401, codigo: 'nao_autenticado' });

export const semPermissao = (msg = 'Seu perfil não tem permissão para esta ação.') =>
  new ErroApp(msg, { status: 403, codigo: 'sem_permissao' });

export const naoEncontrado = (msg = 'Registro não encontrado.') =>
  new ErroApp(msg, { status: 404, codigo: 'nao_encontrado' });

export const conflito = (msg) => new ErroApp(msg, { status: 409, codigo: 'conflito' });

export const invalido = (msg, detalhes = null) =>
  new ErroApp(msg, { status: 422, codigo: 'erro_validacao', detalhes });
