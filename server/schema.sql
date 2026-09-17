PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
  versao     INTEGER PRIMARY KEY,
  aplicado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lojas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo    TEXT    NOT NULL UNIQUE,
  nome      TEXT    NOT NULL,
  endereco  TEXT,
  telefone  TEXT,
  ativo     INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS usuarios (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT    NOT NULL,
  email      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT    NOT NULL,
  papel      TEXT    NOT NULL CHECK (papel IN ('atendente', 'tecnico', 'admin')),
  loja_id    INTEGER REFERENCES lojas(id) ON DELETE RESTRICT,
  telefone   TEXT,
  ativo      INTEGER NOT NULL DEFAULT 1,
  criado_em  TEXT    NOT NULL,
  CHECK (papel = 'admin' OR loja_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_usuarios_loja ON usuarios(loja_id);

CREATE TABLE IF NOT EXISTS ordens_servico (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_os           TEXT    NOT NULL UNIQUE,
  loja_id             INTEGER NOT NULL REFERENCES lojas(id) ON DELETE RESTRICT,
  cliente_nome        TEXT    NOT NULL,
  cliente_telefone    TEXT    NOT NULL,
  tipo_aparelho       TEXT    NOT NULL,
  marca               TEXT    NOT NULL,
  modelo              TEXT    NOT NULL,
  cor                 TEXT,
  imei                TEXT,
  acessorios          TEXT,
  defeito_relatado    TEXT    NOT NULL,
  estado_aparelho     TEXT,
  status              TEXT    NOT NULL DEFAULT 'aguardando'
                      CHECK (status IN ('aguardando', 'em_manutencao', 'aguardando_peca', 'pronto', 'retirado', 'cancelado')),
  prioridade          TEXT    NOT NULL DEFAULT 'normal'
                      CHECK (prioridade IN ('baixa', 'normal', 'alta')),
  valor               REAL,
  valor_pago          INTEGER NOT NULL DEFAULT 0,
  atendente_entrada_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  tecnico_id          INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT,
  recebido_por        TEXT,
  iniciado_em         TEXT,
  concluido_em        TEXT,
  retirado_em         TEXT,
  criado_em           TEXT    NOT NULL,
  atualizado_em       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_os_loja     ON ordens_servico(loja_id);
CREATE INDEX IF NOT EXISTS idx_os_status   ON ordens_servico(status);
CREATE INDEX IF NOT EXISTS idx_os_criado   ON ordens_servico(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_os_tecnico  ON ordens_servico(tecnico_id);
CREATE INDEX IF NOT EXISTS idx_os_cliente  ON ordens_servico(cliente_nome);

CREATE TABLE IF NOT EXISTS fotos_os (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  os_id      INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
  tipo       TEXT    NOT NULL CHECK (tipo IN ('entrada', 'saida', 'retirada', 'assinatura')),
  arquivo    TEXT    NOT NULL,
  mime       TEXT    NOT NULL,
  tamanho    INTEGER NOT NULL DEFAULT 0,
  legenda    TEXT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  criado_em  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fotos_os ON fotos_os(os_id);

CREATE TABLE IF NOT EXISTS eventos_os (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  os_id           INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
  tipo_evento     TEXT    NOT NULL,
  status_anterior TEXT,
  status_novo     TEXT,
  descricao       TEXT,
  usuario_id      INTEGER REFERENCES usuarios(id) ON DELETE RESTRICT,
  criado_em       TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eventos_os ON eventos_os(os_id, id);

CREATE TABLE IF NOT EXISTS sessoes (
  token      TEXT    PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criado_em  TEXT    NOT NULL,
  expira_em  TEXT    NOT NULL,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id);

-- Registro de exclusões administrativas: não guarda o conteúdo apagado, apenas
-- quem apagou o quê e quando. Sem chave estrangeira para sobreviver à remoção
-- do próprio usuário ou da loja.
CREATE TABLE IF NOT EXISTS exclusoes_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo         TEXT    NOT NULL,
  referencia   TEXT,
  detalhes     TEXT,
  usuario_id   INTEGER,
  usuario_nome TEXT,
  criado_em    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exclusoes_criado ON exclusoes_log(criado_em DESC);

-- ============================================================================
-- Trilha de auditoria imutável
-- Eventos e fotos são o registro legal do que aconteceu com o aparelho.
-- Uma vez gravados, não podem ser alterados nem apagados: apenas acrescentados.
-- ============================================================================
CREATE TRIGGER IF NOT EXISTS trg_eventos_imutavel_update
BEFORE UPDATE ON eventos_os
BEGIN
  SELECT RAISE(ABORT, 'Registro de auditoria: eventos_os nao pode ser alterado.');
END;

CREATE TRIGGER IF NOT EXISTS trg_eventos_imutavel_delete
BEFORE DELETE ON eventos_os
BEGIN
  SELECT RAISE(ABORT, 'Registro de auditoria: eventos_os nao pode ser excluido.');
END;

CREATE TRIGGER IF NOT EXISTS trg_fotos_imutavel_update
BEFORE UPDATE ON fotos_os
BEGIN
  SELECT RAISE(ABORT, 'Registro de auditoria: fotos_os nao pode ser alterado.');
END;

CREATE TRIGGER IF NOT EXISTS trg_fotos_imutavel_delete
BEFORE DELETE ON fotos_os
BEGIN
  SELECT RAISE(ABORT, 'Registro de auditoria: fotos_os nao pode ser excluido.');
END;

-- A OS em si pode evoluir de status, mas nunca volta para 'aguardando' nem
-- muda de loja / cliente depois de criada.
CREATE TRIGGER IF NOT EXISTS trg_os_campos_imutaveis
BEFORE UPDATE ON ordens_servico
BEGIN
  SELECT CASE
    WHEN OLD.loja_id <> NEW.loja_id
      THEN RAISE(ABORT, 'A loja de entrada da OS nao pode ser alterada.')
    WHEN OLD.numero_os <> NEW.numero_os
      THEN RAISE(ABORT, 'O numero da OS nao pode ser alterado.')
    WHEN OLD.cliente_nome <> NEW.cliente_nome
      THEN RAISE(ABORT, 'O nome do cliente nao pode ser alterado apos o cadastro.')
    WHEN OLD.criado_em <> NEW.criado_em
      THEN RAISE(ABORT, 'A data de criacao da OS nao pode ser alterada.')
    WHEN OLD.status = 'retirado' AND NEW.status <> 'retirado'
      THEN RAISE(ABORT, 'Uma OS ja retirada nao pode mudar de status.')
  END;
END;
