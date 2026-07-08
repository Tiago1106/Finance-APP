# CLAUDE.md — Finance App (Controle de Gastos Familiar)

Regras e contexto do projeto. Toda sessão de IA (Claude, Cursor) deve seguir este documento sem exceções. Em caso de conflito entre código existente e este documento, este documento prevalece.

---

## 1. Visão geral do produto

App de controle de gastos familiar com dois pontos de entrada:

- **Bot do Telegram**: entrada rápida de gastos em linguagem natural, interpretada por IA (ex: "mercado 230 no nubank", "tv 4500 em 12x no itaú"). Também responde consultas ("quanto gastei com mercado?") e correções ("apaga o último").
- **PWA (Next.js)**: dashboards, gráficos, faturas de cartão, orçamentos, gestão de cadastros, correção de lançamentos e a tela **Pagamentos** — timeline mensal unificada (contas a pagar + faturas + recorrências) agrupada por vencimento, com filtros (A vencer/Vencidas/Pagas) e ação "marcar como paga". Pagar fatura pela tela gera transferência conta → cartão.

**Modelo multi-tenant desde o dia 1**: a unidade central é o `household` (família). Hoje existe apenas um household (Tiago + esposa), mas toda a arquitetura já nasce pronta para abertura ao público. Cadastro fechado por convite (`invite_only`).

---

## 2. Stack (não alterar sem decisão explícita)

| Camada | Tecnologia |
|---|---|
| App | Next.js (App Router) + TypeScript |
| UI | Tailwind CSS + shadcn/ui + Recharts |
| Banco/Auth | Supabase (Postgres + Auth + RLS) |
| ORM | Drizzle |
| Bot | Telegram Bot API via webhook + grammY |
| IA | Claude Haiku (extração de JSON estruturado) |
| Infra | Vercel (deploy + Vercel Cron) |

Projeto único (sem monorepo). **Nunca instalar outra lib de UI além de shadcn/ui.**

---

## 3. Estrutura de pastas

```
src/
├── app/
│   ├── (dashboard)/      # PWA: dashboard, faturas, orçamento, transações
│   ├── (auth)/           # Login, signup, convite de household
│   └── api/
│       ├── telegram/     # Webhook do bot
│       └── cron/         # Geração de recorrências e parcelas
├── lib/
│   ├── db/               # Schema Drizzle, migrations, client
│   ├── core/             # Regras de negócio PURAS (fatura, parcelas, recorrência)
│   ├── ai/               # Prompts e parser de extração da IA
│   └── bot/              # Handlers do grammY
└── components/           # Composições próprias sobre shadcn/ui
```

### Regra de dependência (uma direção só)

```
app/ (rotas, UI)  →  lib/core  →  lib/db
```

- **`lib/core` é puro**: funções sem acesso a banco, HTTP ou side effects. Recebe dados, retorna resultado. 100% testável. Aqui vivem: cálculo de ciclo de fatura, geração de parcelas, regras de recorrência, alertas de orçamento.
- **Bot e PWA nunca duplicam lógica**: ambos chamam as mesmas funções do `core`.
- **Componentes de UI não acessam banco**: dados chegam via Server Components ou Server Actions.
- **Server Actions** para mutações do PWA; **Route Handlers** apenas para webhook do Telegram e cron.

---

## 4. Tipagem

- `strict: true`. **Proibido `any`** — usar `unknown` + type narrowing.
- **Tipos de entidade sempre derivados do schema Drizzle** via `InferSelectModel` / `InferInsertModel`. Nunca redeclarar tipos de entidade à mão.
- **Zod em todas as fronteiras**: inputs de formulários, payload do webhook do Telegram e **resposta da IA** (o JSON retornado pela IA passa por schema Zod antes de tocar o banco — resposta inválida é rejeitada, nunca "corrigida" silenciosamente).
- Enums como `const` objects com `as const` (compatível com `erasableSyntaxOnly`):

```ts
export const TransactionType = {
  EXPENSE: 'expense',
  INCOME: 'income',
  TRANSFER: 'transfer',
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];
```

---

## 5. Convenções de código

- **Nomes em inglês**: variáveis, funções, tabelas, colunas, componentes, arquivos.
- **Português**: textos de UI, mensagens do bot e comentários explicativos.
- **Dinheiro**: valores em **centavos (integer)** no banco. Nunca float. Exibição sempre com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
- **Datas**: `date-fns`. Timezone `America/Sao_Paulo` fixado em todas as regras de fatura e recorrência.
- **Erros no `core`**: Result pattern — retornar erro tipado, nunca `throw`. Bot e UI decidem como apresentar.

```ts
type Result<T, E = CoreError> = { ok: true; data: T } | { ok: false; error: E };
```

---

## 6. Design System

**Dark mode é o padrão.** Light mode fica estruturado (CSS variables) mas não é prioridade na v1. Estilo fintech: limpo, mobile-first, roxo como cor de marca.

### Tokens (CSS variables, padrão shadcn — valores HSL)

```css
:root.dark {
  /* Marca */
  --primary: 263 70% 58%;          /* roxo principal (ações, links, destaques) */
  --primary-hover: 263 70% 64%;
  --primary-muted: 263 40% 25%;    /* fundos sutis com a marca */

  /* Superfícies */
  --background: 240 10% 6%;
  --card: 240 8% 10%;
  --border: 240 6% 18%;

  /* Texto */
  --foreground: 0 0% 96%;
  --muted-foreground: 240 5% 62%;

  /* Semânticas financeiras */
  --income: 152 60% 45%;           /* verde — receitas */
  --expense: 0 72% 58%;            /* vermelho — despesas */
  --warning: 38 92% 55%;           /* alertas de orçamento */

  --radius: 0.75rem;
}
```

### Regras de design (invioláveis)

1. **Proibido cor literal** em componentes (`text-purple-500` ❌). Sempre token semântico (`text-primary`, `text-expense` ✅). Vale para Recharts: gráficos recebem CSS variables, nunca hex fixo.
2. **Mobile-first**: todo layout nasce para celular; desktop é adaptação.
3. **Fonte única**: Inter (ou Geist). Valores monetários em destaque usam `text-2xl` + `tabular-nums` (números alinhados).
4. **Paleta categórica de gráficos**: derivada do roxo (roxo → violeta → azul → rosa), definida como tokens.
5. Verde = receita, vermelho = despesa, sempre. Nunca inverter.

---

## 7. Modelo de dados (resumo)

- `households` — a família (unidade multi-tenant)
- `household_members` — vínculo user ↔ household com papel (`owner` | `member`)
- `users` — login próprio (Supabase Auth) + `telegram_user_id` (vinculado via código)
- `accounts` — contas (banco, dinheiro) e cartões de crédito; cartões têm `closing_day` e `due_day`
- `categories` — criadas dinamicamente pela IA (com confirmação do usuário no bot)
- `transactions` — despesa | receita | transferência; sempre com `created_by`
- `installment_purchases` — compra parcelada (`total_installments`, `current_installment` para compras já em andamento); gera N transações futuras
- `recurring_rules` — despesas/receitas recorrentes de valor fixo; cron gera as transações
- `bills` — contas a pagar de valor variável (luz, água...); `expected_due_day`, categoria e conta padrão
- `bill_instances` — pendência mensal de cada bill: `status` (`pending` | `paid` | `overdue`), valor preenchido no pagamento, vira transação ao ser paga
- `budgets` — limite mensal por categoria (household)
- `invites` — códigos de convite para household (validade 48h)

**Fatura de cartão é derivada** (view/cálculo pelo ciclo de fechamento), não é tabela.

**RLS**: usuário só acessa dados do household que participa. Toda tabela de dados tem `household_id`.

---

## 8. Regras de negócio críticas

### Fatura de cartão
- Compra entre fechamentos cai na fatura do próximo vencimento, calculada por `closing_day`/`due_day` no timezone `America/Sao_Paulo`.
- Parcelas futuras são projetadas nas faturas seguintes.

### Parcelamento
- "tv 4500 em 12x" → cria `installment_purchase` + 12 transações, uma por fatura.
- **Parcela em andamento**: "sofá 3000 em 10x, paguei 6" → registra `current_installment: 7` e gera apenas as 4 restantes, a partir da próxima fatura. Parcelas passadas são ignoradas (sem histórico retroativo na v1).

### Recorrência
- `recurring_rules` + Vercel Cron diário: gera a transação no dia certo e o bot notifica o autor.
- Recorrência em **cartão de crédito** entra na fatura e **não aparece na tela de Pagamentos** (o compromisso é a fatura). Só recorrências debitadas de conta geram item próprio na timeline.

### Contas a pagar (valor variável)
- Cron mensal gera uma `bill_instance` pendente por conta ativa.
- Cron diário envia lembretes: dias antes do vencimento, no dia, e após vencer (status vira `overdue`).
- A instância **só vira transação quando o usuário informa o valor** ("luz 187") — nunca lançar com valor estimado.
- Conta marcada como valor fixo comporta-se como `recurring_rule` (lançamento automático).

### Categorias (criadas pela IA)
- A IA sempre recebe a lista de categorias existentes do household antes de classificar.
- **Preferir categoria existente** — só sugerir criação se nada se aproximar (evitar duplicatas tipo "Alimentação" vs "Mercado").
- Categoria nova → bot pergunta com botões inline: `[Criar] [Usar outra existente] [Sem categoria]`.
- Ao criar categoria, oferecer (opcional) definição de orçamento mensal.
- PWA tem tela de categorias para renomear, mesclar e ajustar orçamentos — não para criar.

### Orçamento
- Ao gravar gasto que ultrapassa 80% do limite da categoria, a confirmação do bot inclui alerta: "⚠️ Alimentação em 92% do orçamento".

### Household / convite
- Criador do household = `owner`. Convite por código (48h de validade) gerado no PWA.
- Transações pertencem ao household (não saem com o membro).
- Cada transação registra `created_by`; dashboard filtra por pessoa.

### Vínculo Telegram
- PWA gera código único → usuário envia `/start CODIGO` ao bot → `telegram_user_id` fica associado permanentemente à conta.
- Mensagens de `telegram_user_id` não vinculado: responder "acesso restrito" (beta fechado). Nunca processar.

---

## 9. Fluxos do bot (comportamento esperado)

| Mensagem | Comportamento |
|---|---|
| "mercado 230 no nubank" | Grava despesa e confirma: "✅ R$ 230 — Mercado → Alimentação (Nubank)" |
| "tv 4500 em 12x no itaú" | Cria parcelamento: "✅ TV R$ 4.500 em 12x de R$ 375 — 1ª parcela na fatura de agosto" |
| "sofá 3000 em 10x, paguei 6" | Gera só as 4 parcelas restantes |
| "netflix 55 todo mês" | Cria recorrência (valor fixo) |
| "cadastra conta de luz, vence dia 10" | Cria `bill` de valor variável |
| "luz 187" (com pendência aberta) | Paga a `bill_instance` do mês e confirma |
| "quanto gastei com mercado?" | Consulta e responde com totais |
| "o último foi 250" / "apaga o último" | Edita/remove último lançamento do autor e confirma |
| Informação faltando (ex: conta) | Pergunta com botões inline — nunca assume silenciosamente |

**Toda ação do bot termina com confirmação explícita do que foi feito.** Em caso de dúvida da IA, perguntar com botões em vez de chutar.

### Contrato da IA de extração
- A IA retorna **apenas JSON** no schema definido em `lib/ai` (intent: `add_expense` | `add_income` | `add_installment` | `add_recurring` | `query` | `edit` | `delete` | `unknown` + campos).
- Resposta validada com Zod. Inválida ou `unknown` → bot pede reformulação, nunca inventa dados.

---

## 10. Segurança

- Webhook do Telegram validado por `secret_token` (header `X-Telegram-Bot-Api-Secret-Token`).
- Rotas de cron protegidas por `CRON_SECRET`.
- Chaves (Telegram, Anthropic, Supabase service role) apenas em variáveis de ambiente do servidor. Nunca expor no client.
- RLS ativa em todas as tabelas; queries do webhook usam o contexto do usuário resolvido pelo `telegram_user_id`.

---

## 11. Roadmap

- **v1 (agora)**: tudo acima, cadastro fechado (só o household do casal).
- **Futuro (público)**: signup aberto, billing (Mercado Pago + Pix), limites por plano, onboarding guiado com assistente de migração de parcelas, landing page. **Nada disso deve ser implementado na v1**, mas nenhuma decisão pode bloquear esse caminho.
