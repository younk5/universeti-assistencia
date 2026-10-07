# Versão de teste — melhorias da UniverseTI Assistência

> **Status:** todo este pacote já está **publicado em produção** em
> https://assistenciauniverse.vercel.app (com backup do banco feito antes do
> deploy — veja o fim deste arquivo).


Esta pasta (`teste-universeti-v2`) é uma cópia separada do sistema que está
online. Nada aqui afeta a versão publicada. Rode localmente, teste à vontade e,
quando estiver satisfeito, é só levar os arquivos para o repositório oficial.

## O que foi adicionado

### 1. Portal público do cliente (sem login)
- **Rastreio da OS**: o cliente abre `/#/rastreio/NUMERO-OS` e informa os
  **4 últimos dígitos do telefone** cadastrado. Vê status, linha do tempo,
  garantia e telefone da loja — sem expor dados internos.
- **Aprovação de orçamento**: o cliente recebe um link com token e responde
  **Aprovar** ou **Recusar**, com observação. A resposta entra no histórico.
- Segurança: a consulta exige número da OS + final do telefone, com a mesma
  mensagem para OS inexistente e telefone errado (evita varredura de números).

### 2. Orçamento com aprovação
- Novo botão **Enviar orçamento** na OS (técnico/admin): valor, peças previstas
  e observação.
- Gera **link + QR Code** para mandar no WhatsApp.
- A loja também pode registrar a resposta dada por telefone/balcão.
- Todo orçamento e sua decisão ficam na trilha de auditoria imutável.

### 3. Checklist técnico na entrada
- Marcações: liga, tela trincada, carcaça amassada, oxidação, queda, molhou,
  senha informada, backup autorizado.
- Campos de itens deixados e observações da vistoria.
- Aparece no detalhe da OS (com marcado/riscado) e no histórico.
- Salvo como JSON na OS e validado no servidor (apenas chaves conhecidas).

### 4. Financeiro e garantia
- **Painel financeiro**: faturamento, ticket médio, recebido e a receber.
- **Formas de pagamento** no momento da retirada.
- **Garantia**: dias definidos na conclusão e data-limite calculada na retirada,
  exibida no detalhe, no comprovante e no rastreio.
- **Faturamento por técnico** no ranking de produtividade (sem comissão).
- CSV ganhou colunas de orçamento, forma de pagamento e garantia.

### 5. QR Code e visual
- Gerador de **QR Code embutido** (sem dependências externas e sem internet) —
  biblioteca `qrcode-generator` (MIT) em `public/js/vendor/qrcode.js`.
- QR do rastreio na tela da OS, no envio de orçamento e no **comprovante PDF**.
- Tela do cliente com identidade visual própria (`public/css/app.css`).

## Como rodar

```bash
# dentro de teste-universeti-v2
npm install          # só na primeira vez (Turso/Blob, usados só na nuvem)
npm run seed         # cria o banco de demonstração
npm start            # http://localhost:3000
```

No celular, use `http://SEU-IP:3000` (o servidor escuta em `0.0.0.0`).

Contas de demonstração (senha **`galaxy2026!`**):
`universeti`, `atendente.centro@universeti.com.br`,
`tecnico.centro@universeti.com.br` etc.

## Banco já existente

Não é preciso recriar o banco. Ao subir, o sistema aplica **migrações
automáticas** (`ALTER TABLE`) que incluem as novas colunas sem apagar nada:

`checklist`, `orcamento_*`, `forma_pagamento`, `garantia_dias`, `garantia_ate`.

## Testes

```bash
npm test        # estática + PDF + API
npm run check   # só a verificação estática do front-end
```

Os testes de navegador (`npm run test:ui`) exigem Chrome/Edge instalado
(`CHROME_PATH` para apontar o executável).

## Observação sobre a Vercel

Na Vercel o disco não é persistente: use **Turso** (`LIBSQL_URL`,
`LIBSQL_AUTH_TOKEN`) para o banco e **Vercel Blob** para as fotos. O driver
Turso e o storage em Blob já existem no projeto.

## Login público

As rotas públicas (`#/rastreio/...` e `#/aprovacao/...`) funcionam mesmo com o
usuário logado — só a tela de login redireciona quem já está autenticado.

---

## Pacote final aplicado (e já em produção)

### Escopo de acesso
- **Administrador e técnico enxergam a rede inteira** (todas as lojas). **Só o
  atendente** fica restrito à própria loja.
- **Técnico pode ser criado sem loja** (o campo some no cadastro).
- Migração automática relaxa o vínculo de loja em `usuarios` sem perder dados.

### Garantia como fluxo
- Na OS retirada, dentro do prazo, aparece **“Abrir OS em garantia”**: cria uma
  nova OS vinculada à original (`garantia_de_os_id`), sem valor, já na fila.
- Bloqueia abrir duas garantias abertas para a mesma origem.

### Entrada com evidência
- **Foto de entrada obrigatória** e **termo assinado pelo cliente** no cadastro
  da OS (a assinatura é anexada ao histórico como `assinatura`).

### Cliente
- Rastreio com **previsão de retirada**, **histórico**, **garantia** e
  **comprovante em PDF** gerado para o próprio cliente (sem login).
- Página de aprovação de orçamento com o **layout novo** (painel de marca +
  cartão), aprovar/recusar com recado.
- **Modo escuro** segue o tema do sistema (via `boot.js`).

### Gestão
- Painel com **financeiro** (faturamento, ticket, formas de pagamento),
  **comparativo vs. período anterior** e **relatório em PDF**.
- Gestão → **Regras**: garantia padrão e **prazo de retirada**.

### Infra
- **Backup automático diário**: Vercel Cron `GET /api/cron/backup` (protegido por
  `CRON_SECRET`) exporta todas as tabelas para o Vercel Blob, em `backups/`.
- **CI** em `.github/workflows/ci.yml` (estático + PDF + API + navegador).
- **Previews com banco separado** (Turso `universeti-teste-preview` no ambiente
  Preview).

---

## Produção

- **Site:** https://assistenciauniverse.vercel.app
- **Backup do banco antes do deploy:** `Default Project/backup-prod-2026-09-20.json`
  (arquivo JSON com todas as tabelas — dá para restaurar em Gestão → Backup).
- Dados preservados no deploy (lojas, usuários, OS, fotos e histórico conferidos).

### Pendente: deploy automático via GitHub
O repositório online (`younk5/universeti-assistencia`) ainda **não tem** estas
mudanças — o commit já existe na pasta local. Para ativar o deploy automático:

```bash
cd "Default Project/teste-universeti-v2"
git push origin master   # o GitHub vai pedir usuário/token
vercel git connect       # conecta o projeto à Vercel (deploy a cada push)
```


## Deploy de teste na Vercel

Publicado como projeto **separado**, sem tocar na versão online:

| Item | Valor |
| --- | --- |
| Projeto | `universeti-teste` (`younk5s-projects`) |
| URL | https://universeti-teste.vercel.app |
| Banco | Turso `universeti-teste` (integrado à Vercel) |
| Fotos | Vercel Blob `universeti-teste-fotos` (privado) |

Variáveis definidas no projeto: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`BLOB_READ_WRITE_TOKEN`, `SESSION_SECRET`, `ADMIN_NOME`, `ADMIN_EMAIL`,
`ADMIN_SENHA`.

### Comandos úteis

```bash
# novo deploy de produção a partir desta pasta
vercel deploy --prod

# recriar os dados de demonstração no banco remoto (fotos vão para o Blob)
STORAGE_DRIVER=blob npm run reset:remote

# checar a saúde do banco remoto
curl -s https://universeti-teste.vercel.app/api/health
```

> No reset remoto, os triggers de imutabilidade são suspensos e religados em
> volta da limpeza (`server/seed.js`) — sem isso o Turso recusa o `DELETE`.

## Atualização: checklist ampliado e senha do aparelho

- **Checklist com 19 itens** (tela trincada/manchada, traseira, câmera, conector
  de carga, botões, alto-falante, bateria inchada, oxidação, queda, molhou,
  esquenta, riscos, conta Google/iCloud ativa, película etc.).
- **Senha do aparelho** registrada na entrada, com tipo:
  - **Numérica (PIN)** ou **com letras** → campo de texto;
  - **Desenho (padrão)** → área 3x3 para desenhar, e o sistema guarda a
    **ordem dos pontos** (ex.: `1 → 2 → 5 → 8`), exibida no detalhe da OS.
  - Validação no servidor (`checklist.senha = { tipo, valor }`).
- **Atendente não altera a própria senha** — a troca é feita pelo administrador
  em **Gestão → Usuários → Redefinir senha** (com botão de gerar senha forte e
  copiar). O servidor recusa a troca pelo próprio atendente (403).

## Atualização: admin/técnico consultam a senha dos usuários

- Na aba **Gestão → Usuários** há a coluna **Senha**. Admin e técnico clicam no
  ícone de olho e veem a senha daquele usuário (com opção de ocultar).
- Endpoint `GET /api/usuarios/:id/senha`, restrito a admin/técnico (o atendente
  recebe 403).
- **Como funciona:** a senha continua sendo guardada com hash scrypt para o
  login e, além disso, uma cópia **cifrada com AES-256-GCM** (`usuarios.senha_cifrada`)
  é gravada para permitir a consulta. A chave vem de `SENHA_SECRET` (ou
  `SESSION_SECRET` como reserva).
- **Senhas antigas:** as que existiam antes deste recurso não são recuperáveis
  (só havia hash) e aparecem como "—". Redefina uma vez para que fiquem visíveis.
- **Atenção de segurança:** este é um acesso deliberado da gestão às senhas.
  Quem tiver a chave do servidor **e** o banco consegue ler todas elas. Mantenha
  `SENHA_SECRET` estável e protegida (não a troque sem necessidade — isso
  invalida as senhas cifradas).


## Atualização: edição da OS pelo admin e foto/vídeo no celular

- **Editar dados da OS** (admin/técnico): botão na tela da OS corrige nome e
  WhatsApp do cliente, **loja de entrada**, marca, modelo, cor, IMEI,
  acessórios, defeito relatado, estado do aparelho e o valor do serviço. Cada
  mudança real vira um evento `edicao` no histórico com o valor **antes →
  depois** e o autor. **Ao trocar a loja, o número da OS é renumerado para a
  loja de destino** (o número antigo fica em `numero_os_anterior`, continua
  achando a OS na busca e no rastreio do cliente). A data de criação segue
  imutável, e a migração automática libera nome do cliente, loja e número para
  o fluxo auditado.
- **Foto da galeria no celular**: a área de anexo agora tem dois botões —
  **Tirar foto** (câmera traseira, como antes) e **Foto ou vídeo da galeria**
  (rolete de fotos e vídeos, sem o atributo `capture`). Vale para entrada,
  saída, retirada e anexos avulsos.
- **Vídeos**: MP4/MOV/WebM de até 128 MB (ajustável em `VIDEO_MAX_MB`), com
  pré-visualização no player, miniaturas com selo de reprodução e visualizador
  em tela cheia. Na Vercel o vídeo sobe **direto do navegador para o Vercel
  Blob**, autorizado por um token de cliente gerado pelo servidor (o limite de
  4,5 MB de corpo da função serverless não se aplica); a API confere os
  metadados reais (`head`) antes de registrar no histórico. Fora da Vercel, o
  vídeo passa pelo próprio servidor (disco local).
- **Range requests**: `/api/fotos/:id/raw` responde `206`/`416` — o player
  nativo do Safari/iOS exige trechos parciais para tocar vídeo.
- **Bundle do SDK**: `public/js/vendor/blob-client.js` (gerado com
  `npm run vendor:blob`) empacota o `@vercel/blob/client` para o navegador;
  ele só é baixado quando alguém envia um vídeo.
- **Testes**: fumaça (upload de vídeo, Range 206/416, edição com auditoria e
  403 do atendente) e navegador (modal de edição e envio de vídeo pela
  galeria). O fluxo do Blob foi verificado de ponta a ponta contra o storage
  real (upload simples e multipart, confirmação, download, Range e exclusão).
