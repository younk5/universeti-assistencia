# Manual de uso — UniverseTI Assistência

Guia prático do sistema de Ordens de Serviço (OS) para toda a equipe:
**Atendente**, **Técnico** e **Administrador**.

- Site: https://assistenciauniverse.vercel.app
- Funciona no computador e no celular (no celular, use **"Adicionar à tela de
  início"** no Chrome/Safari para abrir como um aplicativo).

---

## 1. Perfis e o que cada um pode fazer

Existem só dois níveis de acesso:

- **Atendente** — trabalha no balcão de **uma loja**. Vê apenas as OS da própria loja.
- **Técnico e Administrador** — têm **exatamente as mesmas permissões**: veem a
  rede inteira (todas as lojas) e têm acesso a todas as funções, inclusive a
  **Gestão**.

| O que fazer | Atendente | Técnico / Administrador |
| --- | :---: | :---: |
| Abrir nova OS (entrada do aparelho) | ✅ na própria loja | ✅ escolhe a loja |
| Ver ordens de serviço | só da própria loja | todas as lojas |
| Assumir aparelho da fila | — | ✅ |
| Adicionar anotação / anexar foto | ✅ | ✅ |
| Enviar orçamento para o cliente | — | ✅ |
| Finalizar serviço (marcar como pronto) | — | ✅ |
| Registrar retirada com assinatura | ✅ | ✅ |
| Avisar cliente pelo WhatsApp | ✅ | ✅ |
| Etiqueta e comprovante em PDF | ✅ | ✅ |
| Abrir OS em garantia | — | ✅ |
| Cancelar, reabrir ou excluir OS | — | ✅ |
| Painel e relatórios | própria loja | rede inteira |
| Exportar CSV | ✅ | ✅ |
| Gestão (lojas, usuários, regras, auditoria, backup) | — | ✅ |
| Trocar a própria senha | — (pede à gestão) | ✅ |

> Se aparecer **"Sem permissão para esta tela"**, a função não faz parte do seu
> perfil. Fale com um técnico ou administrador.

---

## 2. Primeiro acesso

1. Abra o site e digite seu **usuário** (ou e-mail) e **senha**.
2. Após várias tentativas erradas o acesso é bloqueado por alguns minutos —
   aguarde e tente de novo.
3. No canto da tela (seu nome/avatar) você abre **Minha conta**:
   - **Técnico/Administrador:** podem trocar a senha (mínimo 8 caracteres, com
     letras e números).
   - **Atendente:** não troca a própria senha. Peça a um técnico ou
     administrador para redefinir em **Gestão → Usuários → Redefinir senha**.
4. Também é possível alternar entre **modo claro e escuro**.

### Menu principal

| Menu | Para que serve |
| --- | --- |
| **Painel** | Números do período, financeiro e ordens recentes |
| **Nova OS** | Cadastrar a entrada de um aparelho |
| **Fila** | Aparelhos aguardando/em manutenção (bancada) |
| **Ordens** | Busca e lista de todas as OS, com filtros e exportação |
| **Gestão** | Lojas, usuários, regras, auditoria e backup (técnico/admin) |

Atalho: **Ctrl + K** (ou Cmd + K) vai direto para a busca de OS.

---

## 3. O ciclo de uma OS

```
ENTRADA              BANCADA                         RETIRADA
Aguardando  →  Em manutenção  ⇄  Aguardando peça  →  Pronto para retirada  →  Retirado
                                                          (Cancelado: via alternativa)
```

O sistema só aceita avanços válidos, e **tudo fica registrado** na linha do
tempo da OS (quem fez, o quê e quando). Esse histórico não pode ser apagado ou
alterado.

---

## 4. Guia do Atendente

### 4.1 Abrir uma nova OS (entrada)

Menu **Nova OS** e preencha as seções:

1. **Cliente** — nome e **WhatsApp do cliente** (obrigatório; é por ele que o
   cliente consulta a OS e recebe avisos).
2. **Aparelho** — tipo, marca, modelo, IMEI/série, acessórios deixados.
3. **Estado e defeito** — defeito relatado pelo cliente e estado geral.
4. **Checklist técnico** — marque o que foi observado na vistoria (tela
   trincada, traseira, câmera, conector, botões, bateria inchada, oxidação,
   queda, molhou, conta Google/iCloud ativa etc.) e registre a **senha do
   aparelho**:
   - **Numérica (PIN)** ou **com letras** → digite no campo;
   - **Desenho (padrão)** → desenhe na grade 3×3; o sistema guarda a ordem dos
     pontos (use **Desfazer** se errar).
5. **Foto de entrada** (obrigatória) — tire a foto pelo próprio celular,
   mostrando o estado do aparelho.
6. **Termo de entrada** — o cliente **assina na tela** (dedo, caneta ou mouse).
7. Salve. O sistema gera o número da OS (ex.: `GUA-0123`).
8. Clique em **Etiqueta PDF** para imprimir e colar no aparelho.

> Técnicos e administradores veem também o campo **Loja de entrada**, para
> escolher em qual loja o aparelho foi recebido.

### 4.2 Acompanhar as OS

- Menu **Ordens**: busque por número, nome ou telefone, e filtre por período,
  status, loja e técnico. **Limpar filtros** volta ao padrão.
- Clique em **Ver detalhes** para abrir a OS: dados, checklist, fotos,
  orçamento e a linha do tempo completa.
- **Adicionar anotação**: registre contatos com o cliente (ex.: "cliente ligou
  pedindo previsão").
- **Anexar foto**: inclua fotos extras quando necessário.

### 4.3 Avisar o cliente

Quando a OS estiver **Pronta para retirada**, use **Avisar cliente** /
**WhatsApp**: o sistema abre o WhatsApp com a mensagem pronta.

O cliente também pode acompanhar sozinho pelo **link/QR Code de rastreio**
(veja a seção 7).

### 4.4 Registrar a retirada

1. Abra a OS com status **Pronto para retirada**.
2. Clique em **Registrar retirada**.
3. Informe quem retirou, se o valor foi pago e a **forma de pagamento**.
4. O cliente **assina na tela**.
5. Confirme. A OS vira **Retirado**, a data-limite da **garantia** é calculada
   e você pode baixar o **Comprovante PDF** (com histórico, fotos, assinatura e
   QR Code).

### 4.5 Garantia

Se o cliente voltar dentro do prazo, chame um técnico ou administrador: eles
abrem a OS retirada e clicam em **Abrir OS em garantia**. É criada uma nova OS
ligada à original, sem valor, direto na fila do técnico.

---

## 5. Guia do Técnico e do Administrador

Técnico e administrador fazem **tudo o que o atendente faz** (seção 4) e também
o que está abaixo. Ambos enxergam **todas as lojas** da rede.

### 5.1 Fila de atendimento (bancada)

Menu **Fila**: mostra os aparelhos **Aguardando**, **Em manutenção** e
**Aguardando peça**.

1. Clique em **Assumir aparelho** — a OS passa para **Em manutenção** em seu
   nome.
2. Registre o diagnóstico em **Adicionar anotação**.
3. Faltou peça? No detalhe da OS, clique em **Aguardando peça**, informe qual
   peça falta e **Pausar reparo**. A OS vai para a aba **Aguardando peça** da
   Fila. Quando a peça chegar, use **Peça chegou · retomar** (no detalhe ou na
   Fila).

### 5.2 Enviar orçamento

1. Na OS, clique em **Enviar orçamento**: informe valor, peças previstas e
   observação.
2. O sistema gera um **link + QR Code** — use **Enviar no WhatsApp** ou
   **Enviar link**.
3. O cliente abre o link (sem login) e escolhe **Aprovar** ou **Recusar**.
4. Se o cliente responder por telefone ou no balcão, registre a resposta na
   própria OS. Tudo entra no histórico.

### 5.3 Finalizar o serviço

1. Clique em **Finalizar serviço**.
2. Tire a **foto de saída**, informe o **valor cobrado** e os **dias de
   garantia**.
3. **Concluir e marcar como pronto** — a OS passa para **Pronto para
   retirada** e o balcão pode avisar o cliente.

### 5.4 Cancelar, reabrir e excluir

- **Cancelar OS** — exige o motivo.
- **Reabrir OS** — devolve uma OS cancelada para a fila.
- **Excluir OS** — apaga a OS **definitivamente**, com fotos, assinatura e
  histórico. **Não tem volta.** A exclusão fica registrada em Gestão →
  Auditoria.

### 5.5 Painel e relatórios

Menu **Painel**:

- Escolha o período (ex.: **Mês atual**) e clique em **Aplicar**.
- Veja **entradas no período**, status, **valor em serviços**, faturamento,
  ticket médio, recebido/a receber, formas de pagamento e comparação com o
  período anterior.
- Ranking de produtividade e faturamento por técnico, com comparativo entre
  lojas.
- **Relatório PDF** e **Exportar CSV** (abre direto no Excel).

### 5.6 Gestão

Menu **Gestão**, com as abas:

| Aba | O que faz |
| --- | --- |
| **Lojas** | **Nova loja**, editar, **Desativar/Reativar** e **Excluir**. Loja desativada não recebe novas OS. |
| **Usuários** | **Novo usuário**, editar, **Desativar/Reativar**, **Excluir** e **Redefinir senha** (com botão de gerar senha forte e copiar). Atendente precisa de loja; técnico e administrador podem ficar sem loja. |
| **Regras** | Garantia padrão (dias) e prazo padrão de retirada. |
| **Auditoria** | Registro de todas as exclusões: quem apagou, o quê e quando. **Exportar backup (.json)** e **Restaurar backup**. |

> **Restaurar backup** substitui todos os dados do sistema e desconecta todo
> mundo. Faça um **Exportar backup** antes. Fotos não entram no arquivo de
> backup.
>
> O sistema não deixa excluir ou desativar o **último administrador**, nem
> excluir a própria conta.

---

## 6. Dicas para o dia a dia

- **Foto não envia?** Libere a câmera para o site no navegador. Fotos HEIC do
  iPhone: ajuste a câmera para "Mais compatível" (JPEG).
- **Sem internet?** O sistema avisa; aguarde a conexão e tente de novo — nada é
  salvo pela metade.
- **Não achou a OS?** Atendentes só veem a própria loja; confira os filtros de
  período e status em **Ordens**.
- Anote tudo na OS: o histórico é a proteção da loja e do cliente.

---

## 7. Para o cliente (sem login)

- **Rastreio:** pelo QR Code do comprovante/etiqueta ou pelo link
  `…/#/rastreio/NÚMERO-DA-OS`, o cliente informa os **4 últimos dígitos do
  telefone** cadastrado e vê status, previsão, histórico, garantia e telefone
  da loja. Pode também **Baixar comprovante (PDF)**.
- **Orçamento:** pelo link recebido, o cliente **aprova ou recusa** e pode
  deixar um recado.
