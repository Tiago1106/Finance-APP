# Documento de Escopo — App de Controle de Gastos Familiar

Documentação funcional do produto. Este documento descreve **o que** o produto faz e **como** se comporta, sem tratar de tecnologia. Serve como fonte de verdade para design, desenvolvimento e validação.

---

## 1. Visão do produto

Um aplicativo de controle financeiro familiar em que **registrar um gasto é tão fácil quanto mandar uma mensagem**. O usuário conversa com um assistente no Telegram em linguagem natural ("mercado 230 no nubank") e uma inteligência artificial interpreta, categoriza e registra. A análise — dashboards, faturas, orçamentos — acontece em um aplicativo web instalável no celular (PWA).

### Princípios

1. **Entrada sem atrito**: registrar um gasto leva segundos, no app que a pessoa já usa todo dia.
2. **A IA trabalha, o usuário confirma**: o sistema interpreta e sugere; nunca assume silenciosamente quando há dúvida.
3. **A família é a unidade**: contas, cartões, categorias e orçamentos pertencem à família, não ao indivíduo.
4. **Feito para o Brasil**: cartão de crédito com fatura, parcelamento e despesas recorrentes são cidadãos de primeira classe.
5. **Nasce fechado, pronto para abrir**: hoje atende um casal; a estrutura já suporta abertura ao público sem retrabalho.

### Público da v1

Tiago e esposa. Cadastro fechado por convite.

---

## 2. Conceitos fundamentais

### Família (household)
Unidade central do sistema. Tudo — contas, cartões, categorias, transações, orçamentos — pertence a uma família. Cada família é totalmente isolada das demais.

### Membro
Pessoa com login próprio que participa de uma família. Papéis:
- **Dono (owner)**: quem criou a família. Pode convidar e remover membros.
- **Membro (member)**: participa com acesso completo aos dados financeiros da família.

Cada membro tem seu próprio login e seu próprio vínculo com o Telegram. Toda transação registra **quem** a criou, permitindo filtrar por pessoa.

**Regra:** as transações pertencem à família. Se um membro sair, os lançamentos que ele criou permanecem.

### Conta
Origem ou destino de dinheiro. Dois tipos:
- **Conta comum**: conta bancária, carteira/dinheiro físico.
- **Cartão de crédito**: possui **dia de fechamento** e **dia de vencimento**, que determinam em qual fatura cada compra cai. Pode ter limite (opcional).

### Categoria
Classificação dos gastos (Alimentação, Transporte, Lazer...). **Criadas dinamicamente pela IA** com confirmação do usuário — não há cadastro manual obrigatório. Pertencem à família: o que um membro "ensina" vale para todos.

### Transação
Um lançamento financeiro. Tipos: **despesa**, **receita** e **transferência** (entre contas da família). Atributos principais: valor, data, descrição, categoria, conta/cartão, autor.

### Compra parcelada
Uma compra que gera várias transações futuras, uma por fatura. Suporta **parcelas já em andamento** (compras feitas antes de começar a usar o app).

### Recorrência
Despesa ou receita que se repete com **valor fixo** (assinaturas, salário). O sistema gera as transações automaticamente na data certa e avisa o autor.

### Conta a pagar
Despesa mensal com **valor variável** (luz, água, internet com valor flutuante...). Cadastrada uma vez com nome, dia previsto de vencimento e conta de pagamento. Todo mês o sistema gera uma **pendência**: o assistente lembra perto do vencimento e, quando o usuário informa o valor, a conta é lançada e marcada como paga. Uma conta a pagar pode ser configurada como "valor fixo" — nesse caso se comporta como recorrência automática.

### Orçamento
Limite mensal de gasto por categoria, definido pela família. O sistema acompanha o consumo e alerta quando se aproxima do limite.

### Fatura
Agrupamento calculado das transações de um cartão dentro de um ciclo (fechamento a fechamento). Não é algo que o usuário cria — o sistema deriva automaticamente, incluindo a projeção de faturas futuras com as parcelas.

---

## 3. Acesso e onboarding

### 3.1 Criação de conta e da família

1. O primeiro usuário cria sua conta no app (email e senha).
2. Automaticamente, uma família é criada e ele se torna o dono.

### 3.2 Convite de membro

1. O dono acessa "Minha Família" → "Convidar membro".
2. O sistema gera um **código de convite com validade de 48 horas**.
3. O dono envia o código por qualquer canal (WhatsApp, Telegram...).
4. A pessoa convidada cria sua própria conta (email e senha próprios) e informa o código.
5. Ela entra na família como membro, com acesso completo.

Convites expirados ou já utilizados são rejeitados com mensagem clara.

### 3.3 Vínculo com o Telegram

Cada membro vincula seu próprio Telegram, uma única vez:

1. No perfil do app, o membro clica em "Vincular Telegram" → o sistema gera um código único.
2. O membro abre o chat com o assistente no Telegram e envia `/start` com o código.
3. O assistente confirma o vínculo, que é permanente.

A partir daí, o assistente reconhece automaticamente quem está falando. **Mensagens de pessoas não vinculadas nunca são processadas** — recebem apenas um aviso de acesso restrito.

### 3.4 Setup inicial da família

Ordem sugerida (guiada pelo app):

1. Cadastrar contas e cartões (com dias de fechamento e vencimento).
2. Vincular o Telegram de cada membro.
3. Lançar pelo assistente as **compras parceladas em andamento** de cada cartão (ex: "sofá 3000 em 10x, paguei 6"), espelhando a realidade atual.
4. Definir orçamentos conforme as categorias forem surgindo (opcional, pode ser feito aos poucos).

Não há importação de histórico retroativo na v1: o controle começa do mês atual em diante.

---

## 4. O assistente no Telegram

Canal principal de **entrada** de dados e consultas rápidas. Cada membro conversa no seu próprio chat; tudo cai na mesma família.

### 4.1 Comportamento geral

- O usuário escreve em linguagem natural; a IA extrai valor, tipo, categoria, conta, parcelas e recorrência.
- **Toda ação termina com uma confirmação explícita** do que foi feito.
- **Em caso de dúvida, o assistente pergunta com botões** — nunca assume silenciosamente.
- Se a mensagem não for compreendida, o assistente pede reformulação com um exemplo — nunca inventa dados.

### 4.2 Fluxos

**Gasto simples**
> Usuário: "mercado 230 no nubank"
> Assistente: "✅ R$ 230,00 — Mercado → Alimentação (Nubank crédito) — fatura de julho"

**Compra parcelada nova**
> Usuário: "tv 4500 em 12x no itaú"
> Assistente: "✅ TV R$ 4.500,00 em 12x de R$ 375,00 — 1ª parcela na fatura de agosto"

**Parcela em andamento**
> Usuário: "sofá 3000 em 10x no nubank, paguei 6"
> Assistente: "✅ Sofá — registradas as 4 parcelas restantes de R$ 300,00, a partir da fatura de agosto"

**Recorrência**
> Usuário: "netflix 55 todo mês"
> Assistente: "✅ Netflix R$ 55,00 — recorrência mensal criada. Lanço automaticamente e te aviso."

Quando uma recorrência é lançada automaticamente, o autor recebe uma notificação no chat.

**Conta a pagar (valor variável)**
> Usuário: "cadastra conta de luz, vence todo dia 10"
> Assistente: "✅ Conta de Luz cadastrada — vencimento previsto dia 10. Te lembro quando estiver perto."

Perto do vencimento (com pendência aberta):
> Assistente: "📋 Conta de Luz vence dia 10. Quando chegar, me manda o valor."
> Usuário: "luz 187"
> Assistente: "✅ Luz R$ 187,00 paga (Nubank débito) — Moradia"

Se o vencimento passar sem pagamento, o assistente lembra novamente e a pendência aparece destacada no app.

**Consulta**
> Usuário: "quanto gastei com mercado esse mês?"
> Assistente: "🛒 Alimentação em julho: R$ 890,00 de R$ 1.200,00 (74% do orçamento)"

Consultas suportadas na v1: total por categoria, situação do orçamento, total do mês, fatura atual de um cartão e **o que falta pagar** ("o que falta pagar esse mês?" → lista de pendências com vencimentos).

**Correção e exclusão**
> Usuário: "o último foi 250, não 230" → assistente corrige e confirma.
> Usuário: "apaga o último" → assistente remove o último lançamento **do próprio autor** e confirma.

**Ambiguidade (informação faltando)**
> Usuário: "farmácia 80"
> Assistente: "Em qual conta?" com botões: [Nubank crédito] [Nubank débito] [Dinheiro]

**Receita**
> Usuário: "recebi 500 de freela"
> Assistente: "✅ Receita R$ 500,00 — Freelance (conta padrão)"

### 4.3 Categorias criadas pela IA

- Antes de classificar, a IA sempre considera as categorias que a família já possui.
- **Prioridade é encaixar em categoria existente.** Só sugere criar nova quando nada se aproxima — evitando duplicatas como "Alimentação" / "Mercado" / "Comida".
- Quando não há encaixe:
  > "Não achei categoria para isso. Criar **Pets**?" [Criar] [Usar existente] [Sem categoria]
- Ao criar, o assistente oferece (opcional) definir um orçamento mensal para a nova categoria.

### 4.4 Alertas de orçamento

Ao registrar um gasto que leva a categoria a **80% ou mais** do limite mensal, a confirmação inclui o alerta:

> "✅ R$ 130,00 — Restaurante → Alimentação
> ⚠️ Alimentação em 92% do orçamento do mês"

Ao **ultrapassar 100%**, o alerta muda de tom: "🚨 Alimentação estourou o orçamento (R$ 1.310 de R$ 1.200)".

---

## 5. O aplicativo (PWA)

Canal de **análise e gestão**. Instalável no celular; pensado mobile-first, tema escuro, identidade roxa.

### 5.1 Dashboard (tela inicial)

- Resumo do mês: total gasto, total recebido, saldo.
- Gráfico de gastos por categoria (com a paleta derivada da marca).
- Situação dos orçamentos: barra de progresso por categoria, destacando as próximas do limite.
- Próximos compromissos: faturas a vencer, contas a pagar pendentes (com destaque para vencidas) e recorrências dos próximos dias.
- Filtro por pessoa: gastos meus / do outro membro / da família toda.

### 5.2 Transações

- Lista do mês com busca e filtros (categoria, conta, pessoa, tipo).
- Cada item mostra: descrição, valor, categoria, conta, data e quem lançou.
- Edição completa e exclusão de qualquer lançamento.
- Criação manual de transação (alternativa ao assistente).

### 5.3 Faturas de cartão

- Visão por cartão: fatura atual (aberta), fechada e **projeção das futuras** com as parcelas.
- Detalhe da fatura: lançamentos do ciclo, total, data de fechamento e vencimento.
- Compras parceladas listadas com progresso (ex: "Sofá — 7 de 10").

### 5.4 Orçamentos

- Definição e ajuste do limite mensal por categoria.
- Acompanhamento visual do consumo no mês corrente e histórico dos meses anteriores.

### 5.5 Categorias

- Lista das categorias da família (criadas pela IA ou manualmente).
- Ações: **renomear**, **mesclar duplicatas** (move todas as transações) e ajustar orçamento.
- Criação manual disponível, mas não é o caminho principal.

### 5.6 Contas e cartões

- Cadastro e edição de contas e cartões (nome, tipo, fechamento/vencimento, limite opcional).
- Arquivamento de contas que deixaram de ser usadas (histórico preservado).

### 5.7 Recorrências e contas a pagar

- Lista das regras ativas (descrição, valor ou "variável", frequência, próxima data, conta).
- Contas a pagar do mês com status: **pendente**, **paga** ou **vencida**.
- Marcar como paga informando o valor (alternativa ao assistente); histórico dos valores mês a mês (útil pra acompanhar a conta de luz subindo 👀).
- Pausar, editar ou encerrar uma regra.

### 5.8 Pagamentos (timeline do mês)

Tela central de "o que falta pagar e o que já foi pago", inspirada em assistentes de pagamento de apps financeiros. Unifica em uma única linha do tempo **todos os compromissos da família**:

- Contas a pagar (luz, água, internet...)
- Faturas de cartão de crédito
- Recorrências de valor fixo **debitadas de conta** (assinaturas ou contas fixas pagas por débito/boleto)

**Regra importante:** recorrência lançada **em cartão de crédito não aparece nesta tela** — ela já está embutida na fatura do cartão, e o compromisso de pagamento é a fatura. Exibi-la separadamente duplicaria o valor visualmente.

**Estrutura da tela:**

- **Filtros no topo (chips):** A vencer · Vencidas · Pagas · Todas
- **Timeline agrupada por data de vencimento**, com marcador de "Hoje" destacado
- **Card de cada compromisso:** tipo (rótulo pequeno: CONTA, FATURA, ASSINATURA), nome, valor (ou "aguardando valor" para conta variável ainda sem fatura), data de vencimento, status com cor:
  - **A vencer** (neutro)
  - **Vence hoje** (destaque de atenção)
  - **Vencida** (vermelho)
  - **Paga** (verde, com data do pagamento)
- **Ação no card:** "Marcar como paga" — abre confirmação com valor (pré-preenchido se fixo, campo aberto se variável) e conta de pagamento. Fatura de cartão marcada como paga gera a transferência conta → cartão automaticamente.
- **Resumo no topo:** total a pagar no mês, total já pago e quanto falta.

Essa tela é a resposta rápida para "o que ainda falta pagar esse mês?" — complementar ao assistente no Telegram, que responde a mesma pergunta por texto ("o que falta pagar?").

### 5.9 Minha Família

- Membros e papéis.
- Geração de código de convite (48h).
- Remoção de membro (apenas o dono) — os lançamentos dele permanecem.

### 5.10 Perfil

- Dados do usuário, vínculo com o Telegram (status + refazer vínculo se necessário).

---

## 6. Regras de negócio

### 6.1 Ciclo de fatura

- Cada cartão tem **dia de fechamento** e **dia de vencimento**.
- Compra feita entre um fechamento e o próximo entra na fatura que vence em seguida.
- Compra feita **no dia do fechamento ou depois** já cai na fatura seguinte.
- Todos os cálculos de data usam o fuso horário de Brasília.

### 6.2 Parcelamento

- Uma compra em N vezes gera N lançamentos de valor igual (valor total ÷ N), um por fatura consecutiva, a partir da fatura em que a compra cai.
- Se a divisão não for exata em centavos, a diferença é ajustada na primeira parcela.
- **Compra em andamento**: informando "paguei X", o sistema registra apenas as parcelas restantes, a partir da próxima fatura. As já pagas não entram (sem histórico retroativo na v1).
- Cada parcela exibe seu progresso ("7 de 10") e referencia a compra original.
- Excluir uma compra parcelada remove todas as parcelas futuras (com confirmação).

### 6.3 Recorrência

- Frequências na v1: **mensal** (dia fixo) — semanal e anual ficam para depois.
- Diariamente, o sistema verifica as regras e gera as transações do dia; o autor é notificado no Telegram.
- Se o dia não existir no mês (ex: 31 em fevereiro), lança no último dia do mês.
- Recorrência em cartão entra na fatura correspondente à data do lançamento — e, por isso, **não gera compromisso próprio na tela de Pagamentos** (o compromisso é a fatura do cartão).

### 6.3.1 Contas a pagar (valor variável)

- Todo mês, o sistema gera uma pendência para cada conta ativa, com o dia previsto de vencimento.
- **Lembretes pelo assistente**: alguns dias antes do vencimento e no próprio dia, se ainda pendente. Após vencer, a pendência fica marcada como **vencida** e o lembrete se repete.
- A pendência só vira transação quando o usuário informa o valor (pelo assistente ou pelo app) — nada é lançado com valor inventado.
- O gasto entra na categoria da conta (ex: Moradia) e conta para o orçamento normalmente, na data do pagamento.
- Uma conta configurada como "valor fixo" é lançada automaticamente, como recorrência.

### 6.4 Orçamento

- Limite mensal por categoria, valendo para a família inteira (soma dos gastos de todos os membros).
- Consumo considera apenas **despesas** do mês corrente na categoria.
- Alertas: aviso a partir de 80% do limite; alerta reforçado ao ultrapassar 100%. Nunca bloqueia o lançamento — o app registra a realidade, não a impede.

### 6.5 Transferências

- Movem valor entre duas contas da família; **não afetam** gastos por categoria nem orçamento.
- Pagamento de fatura é uma transferência da conta para o cartão.

### 6.6 Permissões

| Ação | Dono | Membro |
|---|---|---|
| Ver e lançar transações | ✅ | ✅ |
| Editar/excluir qualquer lançamento | ✅ | ✅ |
| Gerir contas, cartões, categorias, orçamentos | ✅ | ✅ |
| Convidar membro | ✅ | ❌ |
| Remover membro | ✅ | ❌ |

(Na v1, dono e membro têm autonomia quase total — a família é de confiança. Papéis mais restritos ficam para a versão pública.)

### 6.7 Confiabilidade da interpretação

- A IA classifica cada mensagem em uma intenção (lançar gasto, parcelado, recorrência, consulta, correção, exclusão).
- Interpretação com baixa confiança ou informação faltando → pergunta com botões.
- Mensagem incompreensível → pedido de reformulação com exemplo. **O sistema nunca registra dado inventado.**

---

## 7. Fora do escopo da v1

- Signup público e planos pagos
- Importação de extratos/CSV e integração bancária (Open Finance)
- Histórico retroativo de parcelas pagas
- Recorrências semanais/anuais
- Metas de economia e relatórios anuais
- Notificações push no PWA
- Light mode finalizado (estrutura pronta, tema não priorizado)

## 8. Visão de futuro (versão pública)

Nada da lista abaixo entra na v1, mas **nenhuma decisão da v1 pode bloquear** este caminho:

- Cadastro aberto com onboarding guiado, incluindo **assistente de migração** de parcelas em andamento
- Planos e cobrança (incluindo Pix)
- Limites por plano (membros, contas, histórico)
- Landing page e material do produto

---

## 9. Critérios de sucesso da v1

1. Registrar um gasto simples pelo Telegram leva **menos de 10 segundos**, incluindo a confirmação.
2. As faturas projetadas dos cartões batem com as faturas reais dos bancos.
3. O casal consegue responder "quanto gastamos e com o quê este mês?" olhando apenas o dashboard.
4. A IA encaixa a categoria certa na grande maioria dos lançamentos após as primeiras semanas de uso.
5. Nenhum lançamento é criado com dado inventado pela IA.
