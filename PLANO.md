# PLANO.md — Roadmap de Implementação

Este documento traduz o [CLAUDE.md](CLAUDE.md) e o [docs/ESCOPO.md](docs/ESCOPO.md) em fases pequenas e testáveis. Cada fase deve ser concluída e validada antes de avançar para a próxima. Não pular fases.

---

## Fase 1 — Fundação

**Objetivo:** ter o projeto Next.js rodando com o design system aplicado, o schema completo do banco modelado no Drizzle, migrations geradas e políticas RLS definidas — base sobre a qual todas as fases seguintes são construídas.

### Entregáveis

- [x] Projeto Next.js (App Router) + TypeScript (`strict: true`) inicializado como projeto único (sem monorepo)
- [x] Tailwind CSS configurado
- [x] shadcn/ui inicializado (tema dark como padrão)
- [x] Tokens do design system (CSS variables HSL: primary roxo, background, card, border, foreground, income/expense/warning) aplicados em `globals.css`
- [x] Estrutura de pastas conforme CLAUDE.md (`app/(dashboard)`, `app/(auth)`, `app/api/telegram`, `app/api/cron`, `lib/db`, `lib/core`, `lib/ai`, `lib/bot`, `components/`)
- [x] Drizzle ORM configurado (`drizzle.config.ts`, client em `lib/db`)
- [x] Schema completo do banco em Drizzle: `households`, `household_members`, `users`, `accounts`, `categories`, `transactions`, `installment_purchases`, `recurring_rules`, `bills`, `bill_instances`, `budgets`, `invites`
- [x] Enums como `const objects as const` (TransactionType, AccountType, HouseholdRole, BillInstanceStatus, RecurringFrequency)
- [x] Migration SQL gerada (`drizzle-kit generate`)
- [x] Políticas RLS (Postgres) para isolamento por `household_id` em todas as tabelas de dados
- [x] `.env.example` com todas as variáveis necessárias (Supabase, Telegram, Anthropic, CRON_SECRET)
- [x] `.gitignore` garantindo que `.env.local` nunca seja commitado
- [x] Build (`next build`) e lint (`next lint`) passando sem erros

### Critério de "pronto"

`npm run build` e `npm run lint` executam sem erros; `npx drizzle-kit generate` produz migration válida cobrindo todas as tabelas do modelo de dados (seção 7 do CLAUDE.md); design tokens visíveis em `globals.css` batendo com a paleta do CLAUDE.md; nenhuma credencial commitada.

---

## Fase 2 — Auth + Household

**Objetivo:** permitir que o primeiro usuário crie conta e família automaticamente, e que membros entrem via convite por código.

### Entregáveis

- [x] Integração com Supabase Auth (client/server helpers)
- [x] Tela de signup: cria `user` + `household` (owner) automaticamente na primeira conta
- [x] Tela de login
- [x] Fluxo de convite: geração de código (48h de validade) na tela "Minha Família"
- [x] Tela de aceite de convite: usuário novo cria conta e informa código → vira `member` do household (campo opcional no próprio signup)
- [x] Middleware/guard de rotas protegidas (redireciona não autenticado para login) — `src/proxy.ts` (Next 16)
- [x] Tratamento de convite expirado/já utilizado com mensagem clara
- [x] RLS validado na prática: usuário só lê/escreve dados do próprio household (+ migration 0002 com GRANTs por role: `authenticated` com CRUD sob RLS, `anon` sem nenhum acesso)

### Critério de "pronto"

Dois usuários distintos conseguem, via UI, formar o mesmo household (um como owner, outro via convite), e cada um só enxerga dados desse household (testado manualmente com duas contas).

---

## Fase 3 — Cadastros

**Objetivo:** telas do PWA para gerenciar os cadastros base que todo o resto do sistema depende (contas, cartões, categorias).

### Entregáveis

- [x] Tela "Contas e cartões": listar, criar, editar contas comuns
- [x] Cadastro de cartão de crédito: nome, `closing_day`, `due_day`, limite opcional
- [x] Arquivamento de conta/cartão (soft delete via `archivedAt`, preserva histórico)
- [x] Tela "Categorias": listar categorias do household (sem criar — criação é da IA/bot, CLAUDE.md §8)
- [x] Ações de categoria: renomear, mesclar duplicatas (reatribui transações), ajustar orçamento
- [x] Validação Zod em todos os formulários (fronteira de input)
- [x] Server Actions para todas as mutações (nenhum acesso a banco direto de componente)
- [x] Utilitários novos: `lib/core/money.ts` (parse R$ → centavos, puro) e `lib/format.ts` (`formatBRL`)

### Critério de "pronto"

Household consegue cadastrar ao menos uma conta comum e um cartão de crédito com fechamento/vencimento, e ao menos uma categoria manual, tudo via PWA, com dados persistidos e visíveis após reload.

---

## Fase 4 — Core de regras

**Objetivo:** implementar em `lib/core` (puro, sem I/O) toda a lógica de negócio crítica, coberta por testes unitários, para ser consumida igualmente pelo bot e pelo PWA.

### Entregáveis

- [x] Função de cálculo de ciclo de fatura (dado `closing_day`/`due_day` + data da compra → fatura de destino, timezone `America/Sao_Paulo` via `CivilDate` + `toSaoPauloCivilDate`)
- [x] Geração de parcelas (compra nova em N vezes; ajuste de centavos na 1ª parcela)
- [x] Geração de parcelas restantes (compra "em andamento", ex: "paguei 6 de 10")
- [x] Regras de recorrência mensal (geração da próxima ocorrência; fallback de dia inexistente no mês)
- [x] Regras de contas a pagar (vencimento da `bill_instance` com clamp de dia; transição de status pending → overdue)
- [x] Cálculo de progresso de orçamento (percentual consumido, limiares 80%/100%)
- [x] Result pattern (`{ ok, data | error }`) em todas as funções — nenhum `throw`
- [x] Suíte de testes unitários (Vitest, 64 testes) cobrindo casos de borda (virada de mês/ano, ano bissexto, dia 31 em fevereiro, parcela em andamento, fatura no dia exato do fechamento, invariante soma-das-parcelas) — incluindo `money.ts` e `invites.ts` das fases anteriores

### Critério de "pronto"

`npm test` roda a suíte de `lib/core` com 100% das funções de regra cobertas por pelo menos um teste de caso feliz e um de borda; nenhuma função de `core` acessa banco ou rede.

---

## Fase 5 — Bot Telegram

**Objetivo:** bot funcional no Telegram, vinculado ao household via código, com IA de extração convertendo linguagem natural em lançamentos usando as funções do `lib/core`.

### Entregáveis

- [x] Webhook do Telegram (Route Handler) validado por `secret_token` (header `X-Telegram-Bot-Api-Secret-Token`)
- [x] Setup do grammY e handlers básicos (`/start`, mensagem de texto genérica) + `npm run bot:dev` (long polling local)
- [x] Vínculo `telegram_user_id` ↔ usuário via código gerado no PWA (tela Perfil, código com validade de 1h)
- [x] Bloqueio de mensagens de `telegram_user_id` não vinculado ("acesso restrito")
- [x] Prompt + parser de extração em `lib/ai` (Claude Haiku via structured outputs → intents: `add_expense`, `add_income`, `add_installment`, `add_recurring`, `add_bill`, `pay_bill`, `query`, `edit`, `delete`, `unknown`)
- [x] Validação Zod da resposta da IA (inválido/`unknown` → bot pede reformulação)
- [x] Fluxo completo: gasto simples, parcelamento novo, parcelamento em andamento, recorrência, cadastro de conta a pagar, pagamento de conta a pagar
- [x] Fluxo de consulta (total por categoria, situação de orçamento, total do mês, fatura atual, "o que falta pagar")
- [x] Fluxo de correção/exclusão do último lançamento (restrito ao autor)
- [x] Botões inline para ambiguidade (conta faltando, categoria nova) — estado em `bot_pending_actions` (15 min)
- [x] Alerta de orçamento (80% e 100%) na confirmação do lançamento
- [x] Notificação automática ao autor quando recorrência é lançada pelo cron — helper `notifyUser` pronto; o cron que dispara é entregável da Fase 6

### Critério de "pronto"

Todos os fluxos da tabela da seção 9 do CLAUDE.md funcionam ponta a ponta em um chat de teste do Telegram, sempre terminando em confirmação explícita ou pergunta com botões.

---

## Fase 6 — Telas de análise

**Objetivo:** completar o PWA com as telas de consumo de dados: dashboard, transações, faturas, orçamentos e a timeline de Pagamentos.

### Entregáveis

- [x] Dashboard: resumo do mês (gasto/receita/saldo), gráfico por categoria (Recharts, paleta via tokens), progresso de orçamentos, próximos compromissos, filtro por pessoa
- [x] Tela de Transações: lista do mês, busca/filtros (categoria, conta, pessoa, tipo), edição e exclusão, criação manual
- [x] Tela de Faturas: visão por cartão (atual, fechada, projeção futura), detalhe do ciclo, progresso de parcelas
- [x] Tela de Orçamentos: definição/ajuste de limite mensal por categoria, histórico de consumo (6 meses)
- [x] Tela de Recorrências e contas a pagar: coberta pela timeline de Pagamentos (status de pendências + marcar como paga + assinaturas de conta); pausar/editar regra fica para pós-v1
- [x] Tela de Pagamentos: timeline agrupada por vencimento, filtros (A vencer/Vencidas/Pagas/Todas), card por compromisso com status colorido, ação "marcar como paga" (fatura paga → gera transferência conta → cartão), resumo do mês
- [x] Cron diário: geração de recorrências (+notificação no Telegram), pagamento automático de bills de valor fixo, lembretes D-3/D-0/vencida, marcação de `overdue`, limpeza de pending actions
- [x] Cron mensal: geração de `bill_instance` do mês (idempotente)
- [x] Bottom nav mobile + queries compartilhadas (`lib/queries`, `lib/services/pay-bill`) consumidas por telas E bot

### Critério de "pronto"

Um household com dados de teste (gerados nas fases anteriores) consegue responder visualmente, olhando só o dashboard e a tela de Pagamentos, "quanto gastamos, com o quê, e o que falta pagar este mês" — sem precisar do bot.

---

## Regras gerais válidas em todas as fases

- `app/ → lib/core → lib/db`: nunca inverter a direção de dependência.
- `lib/core` permanece 100% puro (sem banco, sem HTTP, sem side effects).
- Bot e PWA sempre chamam as mesmas funções de `lib/core` — nunca duplicam regra de negócio.
- Zod em toda fronteira de entrada (formulário, webhook, resposta da IA).
- Nenhuma cor literal em componentes — sempre token semântico.
- Nenhuma decisão de v1 pode bloquear o roadmap público (seção 11 do CLAUDE.md).
