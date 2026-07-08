import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { InlineKeyboard } from "grammy";
import { db } from "@/lib/db";
import {
  AccountType,
  BillInstanceStatus,
  BotPendingActionKind,
  TransactionType,
  billInstances,
  bills,
  budgets,
  categories,
  installmentPurchases,
  recurringRules,
  transactions,
} from "@/lib/db/schema";
import type { Intent } from "@/lib/ai/schema";
import { parseBRLToCents } from "@/lib/core/money";
import {
  civilToISO,
  lastDayOfMonthCivil,
  toSaoPauloCivilDate,
  type CivilDate,
} from "@/lib/core/date";
import {
  invoicePeriod,
  resolveInvoiceForPurchase,
  type CardCycle,
} from "@/lib/core/invoice";
import {
  generateInstallmentPlan,
  generateRemainingInstallments,
} from "@/lib/core/installments";
import { billInstanceDueDate, resolveBillStatus } from "@/lib/core/bills";
import { budgetProgress } from "@/lib/core/budget";
import { addMonthsRef } from "@/lib/queries/common";
import { currentInvoiceRef, invoiceView } from "@/lib/queries/invoices";
import { CommitmentStatus, monthCommitments } from "@/lib/queries/payments";
import { payBillInstance } from "@/lib/services/pay-bill";
import {
  findAccount,
  findCategory,
  type AccountOption,
  type BotUser,
  type HouseholdContext,
} from "./context";
import { createPendingAction, type PendingPayload } from "./pending";
import {
  REFORMULATE,
  budgetAlert,
  formatBRL,
  formatCivilShort,
  invoiceLabel,
  monthName,
} from "./replies";

/** Interface minima de resposta — satisfeita pelo Context do grammY. */
export type Replier = {
  reply: (text: string, options?: { reply_markup?: InlineKeyboard }) => Promise<unknown>;
};

function todaySP(): CivilDate {
  return toSaoPauloCivilDate(new Date());
}

function monthBounds(d: CivilDate): { start: string; end: string } {
  return {
    start: civilToISO({ year: d.year, month: d.month, day: 1 }),
    end: civilToISO(lastDayOfMonthCivil(d.year, d.month)),
  };
}

function isCard(account: AccountOption): boolean {
  return (
    account.type === AccountType.CREDIT_CARD &&
    account.closingDay !== null &&
    account.dueDay !== null
  );
}

function cardCycle(account: AccountOption): CardCycle {
  return { closingDay: account.closingDay!, dueDay: account.dueDay! };
}

// ---------------------------------------------------------------------------
// Botoes de escolha de conta (informacao faltando → perguntar, nunca assumir)
// ---------------------------------------------------------------------------

async function askAccount(
  reply: Replier,
  telegramUserId: string,
  hctx: HouseholdContext,
  payload: PendingPayload,
  question: string,
  onlyCards = false
): Promise<void> {
  const options = onlyCards ? hctx.accounts.filter(isCard) : hctx.accounts;
  if (options.length === 0) {
    await reply.reply(
      onlyCards
        ? "Você ainda não tem cartão de crédito cadastrado. Cadastre em Contas no app."
        : "Você ainda não tem contas cadastradas. Cadastre em Contas no app."
    );
    return;
  }
  const id = await createPendingAction(telegramUserId, BotPendingActionKind.CHOOSE_ACCOUNT, {
    ...payload,
    accountOptionIds: options.map((o) => o.id),
  });
  const keyboard = new InlineKeyboard();
  options.forEach((o, i) => {
    keyboard.text(o.name, `pa:${id}:${i}`).row();
  });
  await reply.reply(question, { reply_markup: keyboard });
}

// ---------------------------------------------------------------------------
// Botoes de categoria: criar proposta da IA, usar existente ou sem categoria.
// Usado por gasto simples E parcelamento — nunca gravar categoria em silencio
// quando ha duvida (ESCOPO 4.3).
// ---------------------------------------------------------------------------

type CategoryAskablePayload = Extract<
  PendingPayload,
  { flow: "expense" | "income" } | { flow: "installment" }
>;

async function askCategory(
  reply: Replier,
  telegramUserId: string,
  hctx: HouseholdContext,
  payload: CategoryAskablePayload,
  proposedName: string | null
): Promise<void> {
  const options = hctx.categories.slice(0, 6);
  const id = await createPendingAction(telegramUserId, BotPendingActionKind.CONFIRM_CATEGORY, {
    ...payload,
    categoryOptionIds: options.map((c) => c.id),
  });
  const keyboard = new InlineKeyboard();
  if (proposedName) {
    keyboard.text(`Criar "${proposedName}"`, `pa:${id}:create`).row();
  }
  options.forEach((c, i) => {
    keyboard.text(c.name, `pa:${id}:c${i}`).row();
  });
  keyboard.text("Sem categoria", `pa:${id}:none`);
  await reply.reply(
    proposedName
      ? `Não achei a categoria "${proposedName}". O que prefere?`
      : "Em qual categoria?",
    { reply_markup: keyboard }
  );
}

// ---------------------------------------------------------------------------
// Alerta de orcamento (ESCOPO 4.4)
// ---------------------------------------------------------------------------

async function budgetAlertFor(
  householdId: string,
  categoryId: string,
  categoryName: string
): Promise<string | null> {
  const [budget] = await db
    .select({ limit: budgets.monthlyLimitCents })
    .from(budgets)
    .where(and(eq(budgets.householdId, householdId), eq(budgets.categoryId, categoryId)))
    .limit(1);
  if (!budget) return null;

  const { start, end } = monthBounds(todaySP());
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${transactions.amountCents}), 0)::int` })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.categoryId, categoryId),
        eq(transactions.type, TransactionType.EXPENSE),
        gte(transactions.occurredOn, start),
        lte(transactions.occurredOn, end)
      )
    );

  const progress = budgetProgress({ spentCents: row.total, limitCents: budget.limit });
  if (!progress.ok) return null;
  return budgetAlert(categoryName, progress.data, budget.limit, row.total);
}

// ---------------------------------------------------------------------------
// Gasto / receita simples
// ---------------------------------------------------------------------------

export type ExpenseDraft = {
  flow: "expense" | "income";
  amountCents: number;
  description: string;
  categoryName: string | null;
  dateISO: string;
};

export async function finalizeSimpleTransaction(
  reply: Replier,
  user: BotUser,
  hctx: HouseholdContext,
  draft: ExpenseDraft,
  account: AccountOption,
  categoryChoice?: { id: string | null; name: string | null }
): Promise<void> {
  // Categoria: escolha explicita (callback) > match existente > perguntar.
  // Despesa sem categoria resolvida NUNCA grava em silencio — pergunta.
  let categoryId: string | null = null;
  let categoryLabel: string | null = null;

  if (categoryChoice !== undefined) {
    categoryId = categoryChoice.id;
    categoryLabel = categoryChoice.name;
  } else {
    const existing = findCategory(hctx.categories, draft.categoryName);
    if (existing) {
      categoryId = existing.id;
      categoryLabel = existing.name;
    } else if (draft.flow === "expense") {
      await askCategory(
        reply,
        user.telegramUserId,
        hctx,
        {
          flow: draft.flow,
          amountCents: draft.amountCents,
          description: draft.description,
          categoryName: draft.categoryName,
          dateISO: draft.dateISO,
          accountId: account.id,
        },
        draft.categoryName
      );
      return;
    }
  }

  await db.insert(transactions).values({
    householdId: user.householdId,
    type: draft.flow === "expense" ? TransactionType.EXPENSE : TransactionType.INCOME,
    amountCents: draft.amountCents,
    description: draft.description,
    occurredOn: draft.dateISO,
    accountId: account.id,
    categoryId,
    createdBy: user.userId,
  });

  const parts: string[] = [];
  const catPart = categoryLabel ? ` → ${categoryLabel}` : "";
  let invoicePart = "";
  if (draft.flow === "expense" && isCard(account)) {
    const [y, m, d] = draft.dateISO.split("-").map(Number);
    const inv = resolveInvoiceForPurchase(cardCycle(account), { year: y, month: m, day: d });
    if (inv.ok) invoicePart = ` — ${invoiceLabel(inv.data)}`;
  }
  const emoji = draft.flow === "expense" ? "✅" : "💰";
  parts.push(
    `${emoji} ${formatBRL(draft.amountCents)} — ${draft.description}${catPart} (${account.name})${invoicePart}`
  );

  if (draft.flow === "expense" && categoryId && categoryLabel) {
    const alert = await budgetAlertFor(user.householdId, categoryId, categoryLabel);
    if (alert) parts.push(alert);
  }

  await reply.reply(parts.join("\n"));
}

async function runSimpleTransaction(
  reply: Replier,
  user: BotUser,
  hctx: HouseholdContext,
  intent: Extract<Intent, { intent: "add_expense" | "add_income" }>
): Promise<void> {
  const amount = parseBRLToCents(intent.amount);
  if (!amount.ok) {
    await reply.reply(`Não entendi o valor: ${amount.error.message}`);
    return;
  }

  const dateISO = /^\d{4}-\d{2}-\d{2}$/.test(intent.date ?? "")
    ? intent.date!
    : civilToISO(todaySP());

  const draft: ExpenseDraft = {
    flow: intent.intent === "add_expense" ? "expense" : "income",
    amountCents: amount.data,
    description: intent.description,
    categoryName: intent.category_name,
    dateISO,
  };

  const account = findAccount(hctx.accounts, intent.account_name);
  if (!account) {
    await askAccount(reply, user.telegramUserId, hctx, draft, "Em qual conta?");
    return;
  }

  await finalizeSimpleTransaction(reply, user, hctx, draft, account);
}

// ---------------------------------------------------------------------------
// Parcelamento
// ---------------------------------------------------------------------------

export type InstallmentDraft = {
  flow: "installment";
  totalCents: number;
  count: number;
  alreadyPaid: number | null;
  description: string;
  categoryName: string | null;
};

export async function finalizeInstallment(
  reply: Replier,
  user: BotUser,
  hctx: HouseholdContext,
  draft: InstallmentDraft,
  account: AccountOption,
  categoryChoice?: { id: string | null; name: string | null }
): Promise<void> {
  if (!isCard(account)) {
    await reply.reply(
      `Parcelamento é só em cartão de crédito, e "${account.name}" não é um cartão.`
    );
    return;
  }
  if (draft.count < 1 || draft.count > 99) {
    await reply.reply("Número de parcelas inválido (use entre 1 e 99).");
    return;
  }
  if (draft.alreadyPaid !== null && (draft.alreadyPaid < 0 || draft.alreadyPaid >= draft.count)) {
    await reply.reply("As parcelas já pagas devem ser menos que o total de parcelas.");
    return;
  }

  // Categoria: mesma regra do gasto simples — nunca gravar NULL em silencio.
  let categoryId: string | null = null;
  let categoryLabel: string | null = null;
  if (categoryChoice !== undefined) {
    categoryId = categoryChoice.id;
    categoryLabel = categoryChoice.name;
  } else {
    const existing = findCategory(hctx.categories, draft.categoryName);
    if (existing) {
      categoryId = existing.id;
      categoryLabel = existing.name;
    } else {
      await askCategory(
        reply,
        user.telegramUserId,
        hctx,
        {
          flow: "installment",
          totalCents: draft.totalCents,
          count: draft.count,
          alreadyPaid: draft.alreadyPaid,
          description: draft.description,
          categoryName: draft.categoryName,
          accountId: account.id,
        },
        draft.categoryName
      );
      return;
    }
  }

  const card = cardCycle(account);
  const today = todaySP();
  const first = resolveInvoiceForPurchase(card, today);
  if (!first.ok) {
    await reply.reply("Não consegui calcular a fatura deste cartão. Confira os dias de fechamento/vencimento no app.");
    return;
  }

  const plan =
    draft.alreadyPaid !== null && draft.alreadyPaid > 0
      ? generateRemainingInstallments({
          totalCents: draft.totalCents,
          count: draft.count,
          alreadyPaid: draft.alreadyPaid,
          card,
          nextInvoice: first.data,
        })
      : generateInstallmentPlan({
          totalCents: draft.totalCents,
          count: draft.count,
          card,
          firstInvoice: first.data,
        });
  if (!plan.ok) {
    await reply.reply(`Não consegui gerar as parcelas: ${plan.error.message}`);
    return;
  }

  await db.transaction(async (tx) => {
    const [purchase] = await tx
      .insert(installmentPurchases)
      .values({
        householdId: user.householdId,
        accountId: account.id,
        categoryId,
        description: draft.description,
        totalAmountCents: draft.totalCents,
        totalInstallments: draft.count,
        currentInstallment: (draft.alreadyPaid ?? 0) + 1,
        createdBy: user.userId,
      })
      .returning({ id: installmentPurchases.id });

    await tx.insert(transactions).values(
      plan.data.map((p, i) => ({
        householdId: user.householdId,
        type: TransactionType.EXPENSE,
        amountCents: p.amountCents,
        description: `${draft.description} (${p.installmentNumber}/${draft.count})`,
        // 1ª parcela na data da compra; futuras no inicio do periodo da fatura
        // correspondente, para as telas de fatura derivarem o ciclo certo.
        occurredOn:
          i === 0 ? civilToISO(today) : civilToISO(invoicePeriod(card, p.invoice).start),
        accountId: account.id,
        categoryId,
        createdBy: user.userId,
        installmentPurchaseId: purchase.id,
        installmentNumber: p.installmentNumber,
      }))
    );
  });

  const per = formatBRL(plan.data[plan.data.length - 1].amountCents);
  const catPart = categoryLabel ? ` → ${categoryLabel}` : "";
  if (draft.alreadyPaid !== null && draft.alreadyPaid > 0) {
    await reply.reply(
      `✅ ${draft.description}${catPart} — registradas as ${plan.data.length} parcelas restantes de ${per}, a partir da ${invoiceLabel(first.data)} (${account.name})`
    );
  } else {
    await reply.reply(
      `✅ ${draft.description} ${formatBRL(draft.totalCents)} em ${draft.count}x de ${per}${catPart} — 1ª parcela na ${invoiceLabel(first.data)} (${account.name})`
    );
  }
}

async function runInstallment(
  reply: Replier,
  user: BotUser,
  hctx: HouseholdContext,
  intent: Extract<Intent, { intent: "add_installment" }>
): Promise<void> {
  const total = parseBRLToCents(intent.total_amount);
  if (!total.ok) {
    await reply.reply(`Não entendi o valor total: ${total.error.message}`);
    return;
  }

  const draft: InstallmentDraft = {
    flow: "installment",
    totalCents: total.data,
    count: intent.installments,
    alreadyPaid: intent.already_paid,
    description: intent.description,
    categoryName: intent.category_name,
  };

  const account = findAccount(hctx.accounts, intent.account_name);
  if (!account) {
    await askAccount(reply, user.telegramUserId, hctx, draft, "Em qual cartão?", true);
    return;
  }
  await finalizeInstallment(reply, user, hctx, draft, account);
}

// ---------------------------------------------------------------------------
// Recorrencia
// ---------------------------------------------------------------------------

export type RecurringDraft = {
  flow: "recurring";
  amountCents: number;
  description: string;
  dayOfMonth: number;
  type: "expense" | "income";
  categoryName: string | null;
};

export async function finalizeRecurring(
  reply: Replier,
  user: BotUser,
  hctx: HouseholdContext,
  draft: RecurringDraft,
  account: AccountOption
): Promise<void> {
  const categoryId = findCategory(hctx.categories, draft.categoryName)?.id ?? null;

  await db.insert(recurringRules).values({
    householdId: user.householdId,
    accountId: account.id,
    categoryId,
    type: draft.type,
    description: draft.description,
    amountCents: draft.amountCents,
    dayOfMonth: draft.dayOfMonth,
    createdBy: user.userId,
  });

  const cardNote = isCard(account) ? " Entra direto na fatura do cartão." : "";
  await reply.reply(
    `✅ ${draft.description} ${formatBRL(draft.amountCents)} — recorrência mensal criada (dia ${draft.dayOfMonth}, ${account.name}). Lanço automaticamente e te aviso.${cardNote}`
  );
}

async function runRecurring(
  reply: Replier,
  user: BotUser,
  hctx: HouseholdContext,
  intent: Extract<Intent, { intent: "add_recurring" }>
): Promise<void> {
  const amount = parseBRLToCents(intent.amount);
  if (!amount.ok) {
    await reply.reply(`Não entendi o valor: ${amount.error.message}`);
    return;
  }
  const day = intent.day_of_month ?? todaySP().day;
  if (day < 1 || day > 31) {
    await reply.reply("Dia do mês inválido (use entre 1 e 31).");
    return;
  }

  const draft: RecurringDraft = {
    flow: "recurring",
    amountCents: amount.data,
    description: intent.description,
    dayOfMonth: day,
    type: intent.type,
    categoryName: intent.category_name,
  };

  const account = findAccount(hctx.accounts, intent.account_name);
  if (!account) {
    await askAccount(reply, user.telegramUserId, hctx, draft, "Em qual conta ou cartão?");
    return;
  }
  await finalizeRecurring(reply, user, hctx, draft, account);
}

// ---------------------------------------------------------------------------
// Contas a pagar
// ---------------------------------------------------------------------------

export type BillDraft = {
  flow: "bill";
  name: string;
  expectedDueDay: number;
};

export async function finalizeBill(
  reply: Replier,
  user: BotUser,
  _hctx: HouseholdContext,
  draft: BillDraft,
  account: AccountOption
): Promise<void> {
  const today = todaySP();
  const due = billInstanceDueDate({
    expectedDueDay: draft.expectedDueDay,
    year: today.year,
    month: today.month,
  });
  if (!due.ok) {
    await reply.reply("Dia de vencimento inválido (use entre 1 e 31).");
    return;
  }

  await db.transaction(async (tx) => {
    const [bill] = await tx
      .insert(bills)
      .values({
        householdId: user.householdId,
        accountId: account.id,
        name: draft.name,
        expectedDueDay: draft.expectedDueDay,
        createdBy: user.userId,
      })
      .returning({ id: bills.id });

    // Pendencia do mes corrente ja nasce criada; proximas ficam com o cron.
    await tx.insert(billInstances).values({
      billId: bill.id,
      householdId: user.householdId,
      dueDate: civilToISO(due.data),
      status: resolveBillStatus({ dueDate: due.data, today, isPaid: false }),
    });
  });

  await reply.reply(
    `✅ ${draft.name} cadastrada — vencimento previsto dia ${draft.expectedDueDay} (${account.name}). Te lembro quando estiver perto.`
  );
}

async function runAddBill(
  reply: Replier,
  user: BotUser,
  hctx: HouseholdContext,
  intent: Extract<Intent, { intent: "add_bill" }>
): Promise<void> {
  if (intent.expected_due_day < 1 || intent.expected_due_day > 31) {
    await reply.reply("Dia de vencimento inválido (use entre 1 e 31).");
    return;
  }
  const draft: BillDraft = {
    flow: "bill",
    name: intent.name,
    expectedDueDay: intent.expected_due_day,
  };
  const account = findAccount(hctx.accounts, intent.account_name);
  if (!account) {
    await askAccount(reply, user.telegramUserId, hctx, draft, "Paga por qual conta?");
    return;
  }
  await finalizeBill(reply, user, hctx, draft, account);
}

async function runPayBill(
  reply: Replier,
  user: BotUser,
  hctx: HouseholdContext,
  intent: Extract<Intent, { intent: "pay_bill" }>
): Promise<void> {
  const amount = parseBRLToCents(intent.amount);
  if (!amount.ok) {
    await reply.reply(`Não entendi o valor: ${amount.error.message}`);
    return;
  }

  const needle = intent.bill_name.trim().toLowerCase();
  const bill = hctx.bills.find(
    (b) => b.name.toLowerCase() === needle || b.name.toLowerCase().includes(needle)
  );
  if (!bill) {
    await reply.reply(`Não achei a conta "${intent.bill_name}" cadastrada.`);
    return;
  }

  const [instance] = await db
    .select()
    .from(billInstances)
    .where(
      and(
        eq(billInstances.billId, bill.id),
        inArray(billInstances.status, [
          BillInstanceStatus.PENDING,
          BillInstanceStatus.OVERDUE,
        ])
      )
    )
    .orderBy(desc(billInstances.dueDate))
    .limit(1);

  if (!instance) {
    await reply.reply(`${bill.name} não tem pendência aberta. 👍`);
    return;
  }

  const paid = await payBillInstance({
    householdId: user.householdId,
    userId: user.userId,
    instanceId: instance.id,
    amountCents: amount.data,
  });
  if (!paid.ok) {
    await reply.reply(paid.error.message);
    return;
  }

  const account = hctx.accounts.find((a) => a.id === paid.data.accountId);
  const categoryName = paid.data.categoryId
    ? hctx.categories.find((c) => c.id === paid.data.categoryId)?.name
    : null;

  const parts = [
    `✅ ${paid.data.billName} ${formatBRL(amount.data)} paga (${account?.name ?? "conta"})${categoryName ? ` — ${categoryName}` : ""}`,
  ];
  if (paid.data.categoryId && categoryName) {
    const alert = await budgetAlertFor(user.householdId, paid.data.categoryId, categoryName);
    if (alert) parts.push(alert);
  }
  await reply.reply(parts.join("\n"));
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

async function sumExpenses(
  householdId: string,
  opts: { categoryId?: string; accountId?: string; start: string; end: string; type?: TransactionType }
): Promise<number> {
  const conditions = [
    eq(transactions.householdId, householdId),
    eq(transactions.type, opts.type ?? TransactionType.EXPENSE),
    gte(transactions.occurredOn, opts.start),
    lte(transactions.occurredOn, opts.end),
  ];
  if (opts.categoryId) conditions.push(eq(transactions.categoryId, opts.categoryId));
  if (opts.accountId) conditions.push(eq(transactions.accountId, opts.accountId));
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${transactions.amountCents}), 0)::int` })
    .from(transactions)
    .where(and(...conditions));
  return row.total;
}

async function runQuery(
  reply: Replier,
  user: BotUser,
  hctx: HouseholdContext,
  intent: Extract<Intent, { intent: "query" }>
): Promise<void> {
  const today = todaySP();
  const { start, end } = monthBounds(today);
  const month = monthName(today.month);

  switch (intent.kind) {
    case "category_total": {
      const category = findCategory(hctx.categories, intent.category_name);
      if (!category) {
        await reply.reply(
          intent.category_name
            ? `Não achei a categoria "${intent.category_name}".`
            : "De qual categoria você quer saber o total?"
        );
        return;
      }
      const total = await sumExpenses(user.householdId, {
        categoryId: category.id,
        start,
        end,
      });
      const [budget] = await db
        .select({ limit: budgets.monthlyLimitCents })
        .from(budgets)
        .where(
          and(eq(budgets.householdId, user.householdId), eq(budgets.categoryId, category.id))
        )
        .limit(1);
      let suffix = "";
      if (budget) {
        const progress = budgetProgress({ spentCents: total, limitCents: budget.limit });
        if (progress.ok) {
          suffix = ` de ${formatBRL(budget.limit)} (${progress.data.percent}% do orçamento)`;
        }
      }
      await reply.reply(`🛒 ${category.name} em ${month}: ${formatBRL(total)}${suffix}`);
      return;
    }

    case "month_total": {
      const spent = await sumExpenses(user.householdId, { start, end });
      const received = await sumExpenses(user.householdId, {
        start,
        end,
        type: TransactionType.INCOME,
      });
      await reply.reply(
        `📊 ${month.charAt(0).toUpperCase() + month.slice(1)}:\n` +
          `Gastos: ${formatBRL(spent)}\nReceitas: ${formatBRL(received)}\nSaldo: ${formatBRL(received - spent)}`
      );
      return;
    }

    case "budget_status": {
      const rows = await db
        .select({
          categoryId: budgets.categoryId,
          limit: budgets.monthlyLimitCents,
          name: categories.name,
        })
        .from(budgets)
        .innerJoin(categories, eq(categories.id, budgets.categoryId))
        .where(eq(budgets.householdId, user.householdId));
      if (rows.length === 0) {
        await reply.reply("Nenhum orçamento definido ainda. Defina em Categorias no app.");
        return;
      }
      const lines: string[] = [`🎯 Orçamentos de ${month}:`];
      for (const row of rows) {
        const spent = await sumExpenses(user.householdId, {
          categoryId: row.categoryId,
          start,
          end,
        });
        const progress = budgetProgress({ spentCents: spent, limitCents: row.limit });
        const pct = progress.ok ? `${progress.data.percent}%` : "-";
        const flag = progress.ok && progress.data.level !== "ok" ? (progress.data.level === "exceeded" ? " 🚨" : " ⚠️") : "";
        lines.push(`• ${row.name}: ${formatBRL(spent)} de ${formatBRL(row.limit)} (${pct})${flag}`);
      }
      await reply.reply(lines.join("\n"));
      return;
    }

    case "card_invoice": {
      const account = findAccount(hctx.accounts, intent.account_name);
      const cards = hctx.accounts.filter(isCard);
      const card = account && isCard(account) ? account : cards.length === 1 ? cards[0] : null;
      if (!card) {
        await reply.reply(
          cards.length === 0
            ? "Você não tem cartão de crédito cadastrado."
            : "De qual cartão? Me diga o nome (ex: fatura do Nubank crédito)."
        );
        return;
      }
      const cardRef = {
        id: card.id,
        name: card.name,
        closingDay: card.closingDay!,
        dueDay: card.dueDay!,
      };
      const ref = currentInvoiceRef(cardRef, today);
      const view = await invoiceView(user.householdId, cardRef, ref, today);
      await reply.reply(
        `💳 ${card.name} — ${invoiceLabel(ref)}: ${formatBRL(view.totalCents)}\n` +
          `Fecha ${formatCivilShort(ref.closingDate)}, vence ${formatCivilShort(ref.dueDate)}`
      );
      return;
    }

    case "pending_payments": {
      // Mesma fonte da tela Pagamentos (lib/queries/payments). A fatura
      // ABERTA de um cartao vence no mes seguinte — tambem e "falta pagar",
      // entao as faturas do proximo mes entram na resposta do bot.
      const thisMonth = { year: today.year, month: today.month };
      const nextMonth = addMonthsRef(thisMonth, 1);
      const [current, next] = await Promise.all([
        monthCommitments(user.householdId, thisMonth, today),
        monthCommitments(user.householdId, nextMonth, today),
      ]);
      const commitments = [...current, ...next.filter((c) => c.kind === "invoice")];
      const open = commitments.filter((c) => c.status !== CommitmentStatus.PAID);
      const lines = open.map((c) => {
        const value = c.amountCents !== null ? `: ${formatBRL(c.amountCents)}` : "";
        const overdue = c.status === CommitmentStatus.OVERDUE ? " 🔴 VENCIDA" : "";
        return `• ${c.name}${value} — vence ${formatCivilShort(c.dueDate)}${overdue}`;
      });
      await reply.reply(
        lines.length === 0
          ? "🎉 Nada pendente por enquanto!"
          : `📋 O que falta pagar:\n${lines.join("\n")}`
      );
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Editar / apagar ultimo lancamento (sempre do proprio autor)
// ---------------------------------------------------------------------------

async function lastOwnTransaction(user: BotUser) {
  const [row] = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, user.householdId),
        eq(transactions.createdBy, user.userId)
      )
    )
    .orderBy(desc(transactions.createdAt))
    .limit(1);
  return row ?? null;
}

async function runEdit(
  reply: Replier,
  user: BotUser,
  intent: Extract<Intent, { intent: "edit" }>
): Promise<void> {
  const amount = parseBRLToCents(intent.new_amount);
  if (!amount.ok) {
    await reply.reply(`Não entendi o valor: ${amount.error.message}`);
    return;
  }
  const last = await lastOwnTransaction(user);
  if (!last) {
    await reply.reply("Você ainda não tem lançamentos para corrigir.");
    return;
  }
  await db
    .update(transactions)
    .set({ amountCents: amount.data })
    .where(eq(transactions.id, last.id));
  await reply.reply(
    `✏️ Corrigido: ${last.description ?? "lançamento"} agora é ${formatBRL(amount.data)} (era ${formatBRL(last.amountCents)}).`
  );
}

async function runDelete(reply: Replier, user: BotUser): Promise<void> {
  const last = await lastOwnTransaction(user);
  if (!last) {
    await reply.reply("Você ainda não tem lançamentos para apagar.");
    return;
  }
  await db.delete(transactions).where(eq(transactions.id, last.id));
  await reply.reply(
    `🗑 Removido: ${last.description ?? "lançamento"} de ${formatBRL(last.amountCents)}.`
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function dispatchIntent(
  reply: Replier,
  user: BotUser,
  hctx: HouseholdContext,
  intent: Intent
): Promise<void> {
  switch (intent.intent) {
    case "add_expense":
    case "add_income":
      return runSimpleTransaction(reply, user, hctx, intent);
    case "add_installment":
      return runInstallment(reply, user, hctx, intent);
    case "add_recurring":
      return runRecurring(reply, user, hctx, intent);
    case "add_bill":
      return runAddBill(reply, user, hctx, intent);
    case "pay_bill":
      return runPayBill(reply, user, hctx, intent);
    case "query":
      return runQuery(reply, user, hctx, intent);
    case "edit":
      return runEdit(reply, user, intent);
    case "delete":
      return runDelete(reply, user);
    case "unknown":
      await reply.reply(REFORMULATE);
      return;
  }
}
