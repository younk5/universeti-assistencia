import { consultarUm, executar } from '../db.js';
import {
  NOME_COOKIE,
  criarSessao,
  encerrarSessao,
  conferirSenha,
  gerarHashSenha,
  validarForcaSenha,
} from '../auth.js';
import { definirCookie, limparCookie, exigirLogin, exigirTexto } from '../utils.js';
import { ErroApp, invalido, naoAutenticado } from '../erros.js';
import { PERMISSOES } from '../auth.js';

const MAX_TENTATIVAS = 8;
const JANELA_BLOQUEIO_MS = 10 * 60 * 1000;
const tentativas = new Map();

function chaveTentativa(req, email) {
  const ip = req.socket?.remoteAddress ?? 'desconhecido';
  return `${ip}|${email}`;
}

function verificarBloqueio(chave) {
  const registro = tentativas.get(chave);
  if (!registro) return;
  if (Date.now() - registro.desde > JANELA_BLOQUEIO_MS) {
    tentativas.delete(chave);
    return;
  }
  if (registro.total >= MAX_TENTATIVAS) {
    const restanteMin = Math.ceil((JANELA_BLOQUEIO_MS - (Date.now() - registro.desde)) / 60000);
    throw new ErroApp(
      `Muitas tentativas de login. Tente novamente em ${restanteMin} minuto(s) ou fale com o administrador.`,
      { status: 429, codigo: 'muitas_tentativas' },
    );
  }
}

function registrarFalha(chave) {
  const registro = tentativas.get(chave) ?? { total: 0, desde: Date.now() };
  registro.total += 1;
  tentativas.set(chave, registro);
}

export function limparTentativas() {
  tentativas.clear();
}

export function registrar(rota) {
  rota.post('/api/auth/login', async (ctx) => {
    const login = exigirLogin(ctx.corpo.login ?? ctx.corpo.email);
    const senha = exigirTexto(ctx.corpo.senha, 'senha', { min: 1, max: 128 });
    const chave = chaveTentativa(ctx.req, login);
    verificarBloqueio(chave);

    const registro = await consultarUm('SELECT * FROM usuarios WHERE email = ? COLLATE NOCASE', login);
    const senhaOk = registro ? conferirSenha(senha, registro.senha_hash) : false;

    if (!registro || !senhaOk) {
      registrarFalha(chave);
      throw new ErroApp('Usuário ou senha incorretos.', { status: 401, codigo: 'credenciais_invalidas' });
    }
    if (!registro.ativo) {
      throw new ErroApp('Este usuário está desativado. Procure o administrador.', {
        status: 403,
        codigo: 'usuario_inativo',
      });
    }
    tentativas.delete(chave);

    const loja = registro.loja_id
      ? await consultarUm('SELECT id, nome, codigo, ativo FROM lojas WHERE id = ?', registro.loja_id)
      : null;

    const sessao = await criarSessao(registro.id, ctx.req.headers['user-agent'] ?? '');
    definirCookie(ctx.res, NOME_COOKIE, sessao.valor, {
      maxAgeSegundos: (new Date(sessao.expiraEm).getTime() - Date.now()) / 1000,
      sameSite: 'Lax',
      secure: Boolean(process.env.VERCEL) || process.env.COOKIE_SECURE === '1',
    });

    return {
      usuario: {
        id: registro.id,
        nome: registro.nome,
        email: registro.email,
        papel: registro.papel,
        lojaId: registro.loja_id,
        lojaNome: loja?.nome ?? null,
        lojaCodigo: loja?.codigo ?? null,
      },
      permissoes: PERMISSOES[registro.papel] ?? [],
      expiraEm: sessao.expiraEm,
    };
  });

  rota.post('/api/auth/logout', async (ctx) => {
    await encerrarSessao(ctx.req.cookies?.[NOME_COOKIE]);
    limparCookie(ctx.res, NOME_COOKIE);
    return { ok: true };
  });

  rota.get('/api/auth/me', async (ctx) => {
    if (!ctx.usuario) throw naoAutenticado();
    return {
      usuario: ctx.usuario,
      permissoes: PERMISSOES[ctx.usuario.papel] ?? [],
    };
  });

  rota.post('/api/auth/senha', async (ctx) => {
    if (!ctx.usuario) throw naoAutenticado();
    const atual = exigirTexto(ctx.corpo.senhaAtual, 'senha atual', { max: 128 });
    const nova = validarForcaSenha(ctx.corpo.novaSenha);
    const registro = await consultarUm('SELECT senha_hash FROM usuarios WHERE id = ?', ctx.usuario.id);
    if (!conferirSenha(atual, registro.senha_hash)) {
      throw invalido('A senha atual informada está incorreta.', { campo: 'senhaAtual' });
    }
    if (atual === nova) throw invalido('A nova senha precisa ser diferente da atual.', { campo: 'novaSenha' });
    await executar('UPDATE usuarios SET senha_hash = ? WHERE id = ?', gerarHashSenha(nova), ctx.usuario.id);
    return { ok: true, mensagem: 'Senha alterada com sucesso.' };
  });
}
