import { and, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  AccountType,
  BillInstanceStatus,
  RecurringType,
  accounts,
  billInstances,
  bills,
  recurringRules,
} from "@/lib/db/schema";
import { clampDayToMonth, compareCivil, type CivilDate } from "@/lib/core/date";
import { monthBoundsISO, isoToCivil, type MonthRef } from "./common";
import { invoiceRefForMonth, invoiceView, type CardRef } from "./invoices";

export const CommitmentStatus = {
  PENDING: "pending",
  DUE_TODAY: "due_today",
  OVERDUE: "overdue",
  PAID: "paid",
} as const;
export type CommitmentStatus = (typeof CommitmentStatus)[keyof typeof CommitmentStatus];

/**
 * Um compromisso da timeline de Pagamentos (ESCOPO 5.8): conta a pagar,
 * fatura de cartao ou recorrencia debitada de CONTA (recorrencia em cartao
 * NAO aparece — o compromisso e a fatura).
 */
export type Commitment = {
  kind: "bill" | "invoice" | "recurring";
  /** bill_instance.id | account.id (cartao) | recurring_rule.id */
  refId: string;
  name: string;
  dueDate: CivilDate;
  /** null = conta variavel aguardando valor. */
  amountCents: number | null;
  status: CommitmentStatus;
  paidAt: Date | null;
  /** Conta pagadora padrao (bill/recorrencia). */
  defaultAccountId: string | null;
  /** Valor fixo (pre-preenche o dialog de pagamento). */
  isFixedAmount: boolean;
};

function statusWithToday(
  dueDate: CivilDate,
  today: CivilDate,
  paid: boolean
): CommitmentStatus {
  if (paid) return CommitmentStatus.PAID;
  const cmp = compareCivil(dueDate, today);
  if (cmp < 0) return CommitmentStatus.OVERDUE;
  if (cmp === 0) return CommitmentStatus.DUE_TODAY;
  return CommitmentStatus.PENDING;
}

/**
 * Compromissos do mes, ordenados por vencimento. Fonte unica da timeline,
 * do dashboard ("proximos compromissos") e do bot ("o que falta pagar").
 */
export async function monthCommitments(
  householdId: string,
  month: MonthRef,
  today: CivilDate
): Promise<Commitment[]> {
  const { start, end } = monthBoundsISO(month);
  const result: Commitment[] = [];
  // Pendencias de OUTROS meses so "carregam" para a visao do mes corrente —
  // um mes futuro mostra apenas os proprios compromissos.
  const isCurrentView = month.year === today.year && month.month === today.month;

  // --- Contas a pagar: instancias do mes (+ atrasadas, na visao corrente) ---
  const instanceRows = await db
    .select({
      id: billInstances.id,
      dueDate: billInstances.dueDate,
      status: billInstances.status,
      amountCents: billInstances.amountCents,
      paidAt: billInstances.paidAt,
      name: bills.name,
      accountId: bills.accountId,
      isFixedAmount: bills.isFixedAmount,
      fixedAmountCents: bills.fixedAmountCents,
    })
    .from(billInstances)
    .innerJoin(bills, eq(bills.id, billInstances.billId))
    .where(
      and(
        eq(billInstances.householdId, householdId),
        or(
          and(gte(billInstances.dueDate, start), lte(billInstances.dueDate, end)),
          ne(billInstances.status, BillInstanceStatus.PAID)
        )
      )
    );

  for (const row of instanceRows) {
    const due = isoToCivil(row.dueDate);
    const outsideMonth = row.dueDate < start || row.dueDate > end;
    if (outsideMonth && (!isCurrentView || row.status === BillInstanceStatus.PAID)) {
      continue;
    }
    const paid = row.status === BillInstanceStatus.PAID;
    result.push({
      kind: "bill",
      refId: row.id,
      name: row.name,
      dueDate: due,
      amountCents: row.amountCents ?? (row.isFixedAmount ? row.fixedAmountCents : null),
      status: statusWithToday(due, today, paid),
      paidAt: row.paidAt,
      defaultAccountId: row.accountId,
      isFixedAmount: row.isFixedAmount,
    });
  }

  // --- Faturas de cartao com vencimento no mes -----------------------------
  const cards = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      closingDay: accounts.closingDay,
      dueDay: accounts.dueDay,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.householdId, householdId),
        eq(accounts.type, AccountType.CREDIT_CARD),
        isNull(accounts.archivedAt)
      )
    );

  for (const card of cards) {
    if (card.closingDay === null || card.dueDay === null) continue;
    const cardRef: CardRef = {
      id: card.id,
      name: card.name,
      closingDay: card.closingDay,
      dueDay: card.dueDay,
    };
    const ref = invoiceRefForMonth(cardRef, month);
    const view = await invoiceView(householdId, cardRef, ref, today);
    if (view.totalCents === 0) continue; // fatura vazia nao e compromisso
    const paid = view.status === "paid";
    result.push({
      kind: "invoice",
      refId: card.id,
      name: `Fatura ${card.name}`,
      dueDate: ref.dueDate,
      amountCents: view.totalCents,
      status: statusWithToday(ref.dueDate, today, paid),
      paidAt: null,
      defaultAccountId: null,
      isFixedAmount: true,
    });
  }

  // --- Recorrencias de despesa debitadas de CONTA --------------------------
  const rules = await db
    .select({
      id: recurringRules.id,
      description: recurringRules.description,
      amountCents: recurringRules.amountCents,
      dayOfMonth: recurringRules.dayOfMonth,
      accountId: recurringRules.accountId,
      accountType: accounts.type,
      launched: sql<number>`(
        select count(*) from transactions t
        where t.recurring_rule_id = ${recurringRules.id}
          and t.occurred_on >= ${start}
          and t.occurred_on <= ${end}
      )::int`,
    })
    .from(recurringRules)
    .innerJoin(accounts, eq(accounts.id, recurringRules.accountId))
    .where(
      and(
        eq(recurringRules.householdId, householdId),
        eq(recurringRules.active, true),
        eq(recurringRules.type, RecurringType.EXPENSE),
        ne(accounts.type, AccountType.CREDIT_CARD)
      )
    );

  for (const rule of rules) {
    const due: CivilDate = {
      year: month.year,
      month: month.month,
      day: clampDayToMonth(rule.dayOfMonth, month.year, month.month),
    };
    result.push({
      kind: "recurring",
      refId: rule.id,
      name: rule.description,
      dueDate: due,
      amountCents: rule.amountCents,
      status: statusWithToday(due, today, rule.launched > 0),
      paidAt: null,
      defaultAccountId: rule.accountId,
      isFixedAmount: true,
    });
  }

  result.sort((a, b) => compareCivil(a.dueDate, b.dueDate));
  return result;
}

/** Totais do resumo do topo da tela Pagamentos. */
export function commitmentTotals(commitments: Commitment[]): {
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  awaitingCount: number;
} {
  let total = 0;
  let paid = 0;
  let awaiting = 0;
  for (const c of commitments) {
    if (c.amountCents === null) {
      awaiting++;
      continue;
    }
    total += c.amountCents;
    if (c.status === CommitmentStatus.PAID) paid += c.amountCents;
  }
  return { totalCents: total, paidCents: paid, remainingCents: total - paid, awaitingCount: awaiting };
}
