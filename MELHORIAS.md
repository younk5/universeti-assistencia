# Versão de teste — melhorias da UniverseTI Assistência

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

### 4. Financeiro, comissão e garantia
- **Painel financeiro**: faturamento, ticket médio, recebido, a receber e
  **comissão estimada** (percentual configurável no Admin → Regras).
- **Formas de pagamento** no momento da retirada.
- **Garantia**: dias definidos na conclusão e data-limite calculada na retirada,
  exibida no detalhe, no comprovante e no rastreio.
- Comissão e faturamento por técnico no ranking de produtividade.
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

