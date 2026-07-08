# Finance App — Controle de Gastos Familiar

App de controle financeiro para famílias, com dois pontos de entrada:

- **Bot do Telegram** — registre gastos em linguagem natural ("mercado 230 no nubank"), interpretados por IA (Claude Haiku). Também responde consultas e correções.
- **PWA (Next.js)** — dashboard, gráficos, faturas de cartão, orçamentos e a tela **Pagamentos**: uma timeline mensal unificada de contas a pagar, faturas e recorrências.

Multi-tenant desde o início: a unidade central é o **household** (família). Cadastro fechado por convite.

## Exemplos

**Lançar um gasto**

> **Você:** mercado 230 no nubank
> **Bot:** ✅ R$ 230,00 — Mercado → Alimentação (Nubank)

**Parcelamento**

> **Você:** tv 4500 em 12x no itaú
> **Bot:** ✅ TV R$ 4.500,00 em 12x de R$ 375,00 — 1ª parcela na fatura de agosto

**Compra parcelada já em andamento**

> **Você:** sofá 3000 em 10x no nubank, paguei 6
> **Bot:** ✅ Sofá — registradas as 4 parcelas restantes de R$ 300,00, a partir da fatura de agosto

**Conta a pagar de valor variável**

> **Você:** luz 187
> **Bot:** ✅ Luz R$ 187,00 paga (Nubank débito) — Moradia

**Consulta**

> **Você:** quanto gastei com mercado esse mês?
> **Bot:** 🛒 Alimentação em julho: R$ 890,00 de R$ 1.200,00 (74% do orçamento)

**Ambiguidade — o bot nunca assume, sempre pergunta**

> **Você:** farmácia 80
> **Bot:** Em qual conta? [Nubank crédito] [Nubank débito] [Dinheiro]

No PWA, a tela **Pagamentos** responde a mesma pergunta ("o que falta pagar esse mês?") visualmente: contas a pagar, faturas de cartão e recorrências agrupadas por vencimento, com status colorido e ação de marcar como paga.

Mais fluxos e o contrato completo da IA de extração estão em [docs/ESCOPO.md](docs/ESCOPO.md) e [CLAUDE.md](CLAUDE.md).

## Stack

| Camada | Tecnologia |
|---|---|
| App | Next.js 16 (App Router) + TypeScript |
| UI | Tailwind CSS + shadcn/ui + Recharts |
| Banco/Auth | Supabase (Postgres + Auth + RLS) |
| ORM | Drizzle |
| Bot | Telegram Bot API via webhook + grammY |
| IA | Claude Haiku (extração de JSON estruturado) |
| Infra | Vercel (deploy + Vercel Cron) |

## Rodando localmente

### Pré-requisitos

- Node.js 20+
- Um projeto no [Supabase](https://supabase.com) (banco + auth)
- Um bot criado no [@BotFather](https://t.me/BotFather) do Telegram (token)
- Uma chave de API da [Anthropic](https://console.anthropic.com)

### 1. Instalar dependências

```bash
npm install
```

### 2. Configurar variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha:

```bash
cp .env.example .env.local
```

| Variável | Onde encontrar |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` (segredo, só server-side) |
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string (URI). Use a connection pooler (porta 6543) |
| `TELEGRAM_BOT_TOKEN` | Conversa com o @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | String aleatória sua (protege o webhook — só usada no deploy) |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | Opcional — username do bot sem `@`, habilita o deep link "Abrir o bot" na tela Perfil |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `CRON_SECRET` | String aleatória sua (protege as rotas de cron) |

### 3. Aplicar as migrations

```bash
npm run db:migrate
```

Isso cria o schema completo (households, contas, transações, etc.) e as policies de RLS no Postgres do Supabase.

### 4. (Opcional) Popular dados de teste

```bash
npm run db:seed
```

Preenche o household existente com contas, categorias, transações, parcelamentos, recorrências e contas a pagar variadas — útil para testar as telas sem lançar tudo na mão. Requer que você já tenha criado uma conta pelo signup do app (passo 5).

### 5. Rodar o PWA

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000), crie sua conta (primeira conta vira dona da família) e navegue pelo app.

### 6. Rodar o bot (opcional, em paralelo)

Para testar o bot sem precisar de deploy nem URL pública, ele roda em long polling:

```bash
npm run bot:dev
```

Vincule seu Telegram: no PWA, vá em **Perfil → Vincular Telegram**, copie o código e envie `/start CODIGO` para o seu bot.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe o PWA em desenvolvimento |
| `npm run build` / `npm run start` | Build e start de produção |
| `npm run lint` | ESLint |
| `npm test` / `npm run test:watch` | Testes (Vitest) — cobre principalmente `lib/core` |
| `npm run db:generate` | Gera uma nova migration a partir de mudanças no schema (`src/lib/db/schema.ts`) |
| `npm run db:migrate` | Aplica as migrations pendentes no banco |
| `npm run db:studio` | Abre o Drizzle Studio para inspecionar o banco |
| `npm run db:seed` | Popula dados de teste (ver acima) |
| `npm run bot:dev` | Roda o bot do Telegram em long polling, para desenvolvimento local |

## Estrutura

```
src/
├── app/
│   ├── (dashboard)/      # PWA: dashboard, transações, faturas, orçamentos, pagamentos...
│   ├── (auth)/           # Login, signup, convite de household
│   └── api/
│       ├── telegram/     # Webhook do bot
│       └── cron/         # Geração de recorrências, contas a pagar e lembretes
├── lib/
│   ├── db/               # Schema Drizzle, migrations, client
│   ├── core/              # Regras de negócio puras (fatura, parcelas, recorrência, orçamento) — 100% testadas
│   ├── queries/            # Leituras compartilhadas entre PWA e bot (resumo do mês, pagamentos, faturas)
│   ├── services/            # Ações compartilhadas entre PWA e bot (pagar conta/fatura)
│   ├── ai/                # Prompt e parser de extração da IA
│   └── bot/                # Handlers do grammY
└── components/            # Composições sobre shadcn/ui
```

O bot e o PWA nunca duplicam regra de negócio — ambos chamam as mesmas funções de `lib/core`, `lib/queries` e `lib/services`.

## Documentação

- [CLAUDE.md](CLAUDE.md) — regras de arquitetura, stack, convenções e modelo de dados
- [docs/ESCOPO.md](docs/ESCOPO.md) — escopo funcional completo (o que o produto faz)
- [PLANO.md](PLANO.md) — roadmap de implementação por fases
