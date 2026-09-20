# UniverseTI Assistência — Ordens de Serviço

Sistema web responsivo (celular e desktop) para controlar o fluxo de assistência
técnica de celulares e outros eletrônicos em uma rede de lojas: entrada com foto,
fila de bancada, conclusão com evidência e retirada com assinatura — tudo com
histórico **auditável e imutável**, além de painel comparativo entre lojas.

Construído **sem nenhuma dependência externa**: servidor HTTP próprio sobre
`node:http`, banco `node:sqlite` (embutido no Node) e front-end em módulos ES
nativos. Não há etapa de build, nem `npm install`.

> **Versão de teste** — esta cópia inclui melhorias que ainda não estão na versão
> publicada: portal público do cliente (rastreio por QR e aprovação de
> orçamento), checklist técnico na entrada, financeiro com comissão e garantia.
> Veja [MELHORIAS.md](./MELHORIAS.md).

---

## Requisitos

- **Node.js 22.5 ou superior** (o banco usa o módulo `node:sqlite`). Testado no Node 26.

```bash
node --version
```

---

## Como rodar

### Windows

Dê duplo clique em **`iniciar.cmd`**. Ele cria o banco na primeira execução e abre
o navegador em `http://localhost:3000`.

### Qualquer sistema (linha de comando)

```bash
npm run seed     # cria o banco com dados de demonstração (só na 1ª vez)
npm start        # sobe o servidor em http://localhost:3000
```

### Acessar pelo celular (uso real no balcão)

1. Conecte o celular na **mesma rede Wi-Fi** do computador que roda o sistema.
2. Descubra o IP da máquina (`ipconfig` no Windows, `hostname -I` no Linux/macOS).
3. Abra no celular: `http://192.168.x.x:3000` (o servidor já escuta em `0.0.0.0`).
4. No Chrome/Safari use **“Adicionar à tela de início”** para virar um app.

> O upload de fotos usa a câmera traseira direto pelo navegador
> (`<input capture="environment">`) e comprime a imagem antes de enviar,
> para não estourar o 4G do balcão.

---

## Contas de acesso

O campo de login aceita **usuário** (sem formato de e-mail) ou e-mail.
Senha única para todos os perfis: **`galaxy2026!`**

| Perfil | Usuário |
| --- | --- |
| Administrador / dono | `UniverseTI` |
| Atendente — Guarulhos Centro | `atendente.centro@universeti.com.br` |
| Atendente — Guarulhos Cumbica | `atendente.cumbica@universeti.com.br` |
| Técnico — Guarulhos Centro | `tecnico.centro@universeti.com.br` |
| Técnico — Guarulhos Cumbica | `tecnico.cumbica@universeti.com.br` |
| Técnico — Guarulhos Pimentas | `tecnico.pimentas@universeti.com.br` |

> Em banco vazio, o primeiro administrador é criado com `ADMIN_NOME`,
> `ADMIN_EMAIL` e `ADMIN_SENHA` (`UniverseTI` / `galaxy2026!` por padrão).

> A caixa de contas rápidas só aparece quando o sistema está rodando em
> `localhost`/`127.0.0.1`. Em produção ela não é renderizada.

Para recomeçar do zero: `npm run reset`.

---

## O fluxo de trabalho

```
ENTRADA (atendente)         BANCADA (técnico)              RETIRADA (atendente)
──────────────────          ─────────────────              ────────────────────
foto + dados do aparelho →  assume o aparelho         →    marca como retirado
status: Aguardando          adiciona diagnóstico           coleta assinatura
gera etiqueta PDF            (pausa se faltar peça)          confirma pagamento
                            conclui com foto + valor        status: Retirado
                            status: Pronto p/ retirada
```

Status possíveis: **Aguardando → Em manutenção ⇄ Aguardando peça → Pronto para
retirada → Retirado**, com *Cancelado* como via alternativa. Transições fora
desse grafo são recusadas pelo servidor — o histórico nunca fica incoerente.

---

## O que cada perfil enxerga

| Recurso | Atendente | Técnico | Administrador |
| --- | :---: | :---: | :---: |
| Cadastrar entrada (nova OS) | ✅ | — | ✅ |
| Ver OS da própria loja | ✅ | ✅ | ✅ (todas as lojas) |
| Assumir aparelho na bancada | — | ✅ | ✅ |
| Adicionar diagnóstico / anotação | ✅ | ✅ | ✅ |
| Concluir serviço (foto + valor) | — | ✅ | ✅ |
| Registrar retirada + assinatura | ✅ | — | ✅ |
| Cancelar / reabrir / excluir OS | — | — | ✅ |
| Excluir anexos (fotos/assinatura) | ✅ | ✅ | ✅ |
| Painel comparativo entre lojas | própria loja | própria loja | rede inteira |
| Exportar CSV | ✅ | ✅ | ✅ |
| Gerenciar lojas e usuários (criar, editar, desativar, excluir) | — | — | ✅ |

Regras aplicadas **no servidor** (não apenas escondendo botões na interface).

---

## Rastreabilidade: o coração do sistema

Cada OS tem uma **linha do tempo** com data/hora, autor e papel em cada etapa:

- entrada registrada → aparelho assumido → anotações técnicas → serviço concluído
  → entregue ao cliente;
- todas as fotos (entrada, saída, retirada) e a assinatura digital do cliente.

Esses registros são **imutáveis no próprio banco de dados**. O `schema.sql` cria
*triggers* que abortam qualquer `UPDATE` ou `DELETE` em `eventos_os` e `fotos_os`:

```sql
CREATE TRIGGER trg_eventos_imutavel_delete
BEFORE DELETE ON eventos_os
BEGIN
  SELECT RAISE(ABORT, 'Registro de auditoria: eventos_os nao pode ser excluido.');
END;
```

Além disso, campos-chave da OS (loja de entrada, número, nome do cliente, data de
criação) não podem ser alterados depois do cadastro, e uma OS já retirada não
volta para trás.

---

## Segurança

- Senhas com **scrypt** (salt aleatório por usuário, comparação em tempo constante).
- Sessão por **cookie `HttpOnly` + `SameSite=Lax`** validado no banco, com
  expiração configurável (padrão 30 dias).
- Bloqueio temporário após 8 tentativas de login erradas por IP/usuário.
- Toda rota de API exige sessão e valida a permissão do papel.
- **Isolamento entre lojas**: um técnico de Cumbica recebe `403` ao abrir uma OS
  do Centro, inclusive nas fotos.
- Validação de dados no servidor (tipos, tamanhos, enums, formato de telefone).
- Uploads validados por assinatura binária (não apenas pela extensão/mimetype).
- Cabeçalhos de segurança: CSP restritiva, `nosniff`, `X-Frame-Options: DENY`,
  `Permissions-Policy`.
- Nenhuma foto é servida sem autenticação: todas passam por `/api/fotos/:id/raw`.
- **Exclusão definitiva** de lojas, usuários, ordens de serviço e anexos. Lojas e
  usuários podem ser excluídos mesmo com vínculos (o histórico antigo continua
  exibido, com o autor/loja como removido). Excluir uma OS apaga junto fotos,
  assinatura e eventos — é irreversível e restrita ao administrador. A proteção
  dos registros de auditoria é suspensa apenas nessa operação e religada em
  seguida.
- **Registro de exclusões**: cada exclusão administrativa (OS, anexo, loja,
  usuário) grava quem apagou, o quê e quando em `exclusoes_log` — visível em
  Gestão → Auditoria. Não guarda o conteúdo apagado, apenas a rastreabilidade.
- **Backup do banco em JSON**: exportar e restaurar todas as tabelas pela tela de
  Gestão (restrito ao administrador). A restauração substitui os dados e encerra
  as sessões; os arquivos das fotos ficam no armazenamento e não entram no
  arquivo.

---

## Detalhes de produto

- **Foto na entrada e na conclusão** com compressão no cliente (redimensiona para
  até 1600 px e recomprime em JPEG até caber em ~900 KB).
- **Etiqueta e comprovante em PDF** (gerados no navegador, sem dependências): a
  etiqueta traz a marca, o número da OS em destaque, os dados do cliente e do
  aparelho, o defeito e o código de barras Code 128; o comprovante sai em A4 com
  todas as seções, o histórico do atendimento, as fotos e a **assinatura do
  cliente**.
- **Assinatura digital** do cliente na retirada (canvas + pointer events, funciona
  com dedo, caneta e mouse), recortada automaticamente no traço.
- **Aviso por WhatsApp** com mensagem pronta quando o aparelho fica pronto.
- **Exportação CSV** (separador `;`, com BOM — abre direto no Excel brasileiro) por
  período, loja, status, técnico e busca.
- **Modo escuro** com persistência e respeito à preferência do sistema.
- **Estados vazios, esqueletos de carregamento, toasts e confirmações** em todas as
  ações — nenhuma tela em branco.
- **Mensagens de erro específicas**: falta de conexão, câmera não permitida,
  formato de imagem não suportado (inclui orientação para HEIC do iPhone).
- **Navegação mobile** com barra inferior e alvos de toque de 64 px; nenhum scroll
  horizontal em telas de 360 px.
- **Atalho `Ctrl/Cmd + K`** foca a busca de OS.

---

## Estrutura do projeto

```
server/
  index.js            servidor HTTP, arquivos estáticos, tratamento de erros
  router.js           roteador por padrões de caminho (/api/ordens/:id/fotos)
  config.js           leitura de variáveis de ambiente
  db.js               conexão SQLite, transações, helpers de consulta
  schema.sql          DDL + índices + triggers de imutabilidade
  auth.js             scrypt, sessões, matriz de permissões, escopo por loja
  erros.js            erros de domínio com status HTTP e código estável
  utils.js            validação, cookies, leitura de corpo, formatação
  seed.js             dados de demonstração (3 lojas, 6 usuários, 16 OS)
  api/                rotas HTTP (auth, ordens, dashboard, admin)
  services/           regras de negócio (ordens, fotos, lojas, usuarios, dashboard)
  test/               testes automatizados

public/
  index.html          shell da SPA
  css/app.css         design system (tokens, componentes, modo escuro)
  js/
    app.js            bootstrap, roteador e guarda de sessão
    router.js         casamento de rotas por hash
    api.js            cliente HTTP com tratamento de erro amigável
    store.js          estado da sessão, permissões e tema
    dom.js            criação de DOM declarativa (h())
    ui.js             toasts, modais, badges, estados vazios, visualizador de fotos
    format.js         datas, moeda, telefone e durações em pt-BR
    image.js          compressão de imagem e recorte de assinatura
    assinatura.js     canvas de assinatura digital
    barcode.js        codificador Code 128
    documento.js      layout de documentos em canvas (etiqueta e comprovante)
    pdf.js            gerador de PDF sem dependências (imagem JPEG por página)
    etiqueta.js       monta a etiqueta e o comprovante e baixa em PDF
    components/       captura de foto, cartão de OS, modais do fluxo
    pages/            login, painel, nova OS, fila, ordens, detalhe, gestão, conta

data/                 criado em tempo de execução (banco + fotos) — não versionar
```

### Modelo de dados

- **lojas** — id, codigo, nome, endereco, telefone, ativo
- **usuarios** — id, nome, email, senha_hash, papel, loja_id, telefone, ativo
- **ordens_servico** — numero_os, loja_id, dados do cliente e do aparelho,
  defeito, estado, status, valor, técnico, marcos de tempo
- **fotos_os** — os_id, tipo (entrada/saída/retirada/assinatura), arquivo, autor
- **eventos_os** — trilha de auditoria (tipo, status anterior/novo, autor, data)
- **exclusoes_log** — registro das exclusões administrativas (tipo, referência, autor, data)
- **sessoes** — tokens de sessão com expiração

---

## Testes

```bash
npm test           # todas as etapas
npm run check      # estática do front-end (sintaxe, imports, CSS) — instantâneo
npm run test:api   # fluxo completo da OS por HTTP
npm run test:ui    # SPA real no Chrome headless (DevTools Protocol)
```

- **Verificação estática** — valida a sintaxe de cada módulo ES, garante que todo
  `import` relativo existe (pegou um `import` quebrado que só apareceria no login),
  confere os assets do `index.html` e aponta classes usadas sem estilo no CSS.
- **Testes de API** — autenticação, criação de OS, upload e download de foto,
  bloqueio de arquivo que não é imagem, permissões por papel, isolamento entre
  lojas, transições de status, **imutabilidade dos registros de auditoria
  (tentativas de `UPDATE`/`DELETE` bloqueadas por trigger)**, ciclo de vida de
  lojas, busca/filtros e exportação CSV.
- **Testes de navegador** — sobe o sistema de verdade em um banco temporário,
  controla o Chrome por DevTools Protocol e percorre as telas verificando conteúdo,
  ausência de erros de console e de exceções, formulário de entrada ponta a ponta,
  validação, modais, tema claro/escuro, responsividade (sem scroll horizontal em
  360 px e em 1440 px) e o tratamento de rota inexistente. Se o Chrome/Edge não
  estiver instalado, a etapa é ignorada com aviso (`CHROME_PATH` para apontar o
  executável).

---

## Configuração (variáveis de ambiente)

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP |
| `HOST` | `0.0.0.0` | Interface de escuta (permite acesso pelo celular) |
| `DATA_DIR` | `./data` | Pasta do banco SQLite e das fotos |
| `SESSION_SECRET` | `troque-este-segredo-em-producao` | Segredo do HMAC dos tokens |
| `SESSION_TTL_DIAS` | `30` | Validade da sessão |
| `ADMIN_NOME` | `UniverseTI` | Nome do admin criado quando o banco está vazio |
| `ADMIN_EMAIL` | `universeti` | Login do admin inicial |
| `ADMIN_SENHA` | `galaxy2026!` | Senha do admin inicial |
| `NODE_ENV` | `development` | Em `production` exige `SESSION_SECRET` próprio |

Veja `.env.example`. Copie para `.env` e ajuste (o Node 22+ lê `.env` com
`node --env-file=.env server/index.js`).

---

## Colocando em produção

O sistema está pronto para uso interno, mas antes de expor na internet:

1. **Defina um `SESSION_SECRET` forte** (`node -e "console.log(crypto.randomUUID())"`).
2. **Sirva por HTTPS** — coloque Nginx/Caddy à frente e ajuste o cookie para
   `Secure` em `server/api/auth.js` (hoje `secure: false` para funcionar em rede local).
3. **Faça backup da pasta `data/`** — ela contém o banco e as fotos. O SQLite roda
   em modo WAL; copie com o servidor parado ou use `VACUUM INTO`.
4. **Trocar as senhas** das contas (`npm run reset` antes de subir, ou pelo menu Minha conta).
5. **Não versionar `data/`** (já está no `.gitignore`).
