import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { TransactionType, transactions } from "@/lib/db/schema";
import { civilToISO, compareCivil, type CivilDate } from "@/lib/core/date";
import {
  addInvoiceCycles,
  invoicePeriod,
  resolveInvoiceForPurchase,
  type CardCycle,
  type InvoiceRef,
} from "@/lib/core/invoice";
import { type MonthRef } from "./common";

export type CardRef = {
  id: string;
  name: string;
  closingDay: number;
  dueDay: number;
};

export const InvoiceStatus = {
  OPEN: "open",
  CLOSED: "closed",
  PAID: "paid",
  FUTURE: "future",
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

export type InvoiceTransaction = {
  id: string;
  description: string | null;
  amountCents: number;
  occurredOn: string;
  installmentNumber: number | null;
};

export type InvoiceView = {
  ref: InvoiceRef;
  totalCents: number;
  status: InvoiceStatus;
  transactions: InvoiceTransaction[];
};

function cycle(card: CardRef): CardCycle {
  return { closingDay: card.closingDay, dueDay: card.dueDay };
}

/** Fatura do cartao cujo VENCIMENTO cai no mes pedido. */
export function invoiceRefForMonth(card: CardRef, month: MonthRef): InvoiceRef {
  const base = resolveInvoiceForPurchase(cycle(card), {
    year: month.year,
    month: month.month,
    day: 1,
  });
  // resolve nunca falha com dias validos vindos do banco (checks 1-31)
  if (!base.ok) throw new Error("cartao com ciclo invalido");
  const diff =
    month.year * 12 + (month.month - 1) - (base.data.referenceYear * 12 + (base.data.referenceMonth - 1));
  return diff === 0 ? base.data : addInvoiceCycles(cycle(card), base.data, diff);
}

/** Fatura "atual": a que uma compra feita hoje cairia. */
export function currentInvoiceRef(card: CardRef, today: CivilDate): InvoiceRef {
  const inv = resolveInvoiceForPurchase(cycle(card), today);
  if (!inv.ok) throw new Error("cartao com ciclo invalido");
  return inv.data;
}

async function invoiceTotalAndTransactions(
  householdId: string,
  card: CardRef,
  ref: InvoiceRef,
  withTransactions: boolean
): Promise<{ totalCents: number; transactions: InvoiceTransaction[] }> {
  const period = invoicePeriod(cycle(card), ref);
  const where = and(
    eq(transactions.householdId, householdId),
    eq(transactions.accountId, card.id),
    eq(transactions.type, TransactionType.EXPENSE),
    gte(transactions.occurredOn, civilToISO(period.start)),
    lte(transactions.occurredOn, civilToISO(period.end))
  );

  const [totalRow] = await db
    .select({ total: sql<number>`coalesce(sum(${transactions.amountCents}), 0)::int` })
    .from(transactions)
    .where(where);

  const rows = withTransactions
    ? await db
        .select({
          id: transactions.id,
          description: transactions.description,
          amountCents: transactions.amountCents,
          occurredOn: transactions.occurredOn,
          installmentNumber: transactions.installmentNumber,
        })
        .from(transactions)
        .where(where)
        .orderBy(transactions.occurredOn, transactions.createdAt)
    : [];

  return { totalCents: totalRow.total, transactions: rows };
}

/**
 * Fatura "paga" = existe transferencia para o cartao entre o FECHAMENTO
 * desta fatura (inclusive) e o fechamento da PROXIMA (exclusive). Cada
 * fatura "possui" exatamente um mes de janela de pagamento — usar o mes do
 * vencimento como limite superior faria janelas de faturas consecutivas se
 * sobrepor (pagar a fatura de junho tambem marcaria a de julho como paga).
 */
export async function invoicePaid(
  householdId: string,
  card: CardRef,
  ref: InvoiceRef
): Promise<boolean> {
  const nextClosing = addInvoiceCycles(cycle(card), ref, 1).closingDate;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.type, TransactionType.TRANSFER),
        eq(transactions.transferToAccountId, card.id),
        gte(transactions.occurredOn, civilToISO(ref.closingDate)),
        lt(transactions.occurredOn, civilToISO(nextClosing))
      )
    );
  return row.n > 0;
}

function statusFor(
  card: CardRef,
  ref: InvoiceRef,
  today: CivilDate,
  paid: boolean
): InvoiceStatus {
  if (paid) return InvoiceStatus.PAID;
  if (compareCivil(today, ref.closingDate) < 0) {
    // ainda nao fechou: aberta se hoje ja esta no periodo dela, futura senao
    const period = invoicePeriod(cycle(card), ref);
    return compareCivil(today, period.start) >= 0 ? InvoiceStatus.OPEN : InvoiceStatus.FUTURE;
  }
  return InvoiceStatus.CLOSED;
}

/** Visao completa de uma fatura (usada pelo bot e pelas telas). */
export async function invoiceView(
  householdId: string,
  card: CardRef,
  ref: InvoiceRef,
  today: CivilDate,
  withTransactions = false
): Promise<InvoiceView> {
  const [{ totalCents, transactions: txs }, paid] = await Promise.all([
    invoiceTotalAndTransactions(householdId, card, ref, withTransactions),
    invoicePaid(householdId, card, ref),
  ]);
  return { ref, totalCents, status: statusFor(card, ref, today, paid), transactions: txs };
}

/** Fatura fechada anterior + atual + proximas N (projecao com parcelas). */
export async function invoiceTimeline(
  householdId: string,
  card: CardRef,
  today: CivilDate,
  futureCount = 3
): Promise<InvoiceView[]> {
  const current = currentInvoiceRef(card, today);
  const refs: InvoiceRef[] = [addInvoiceCycles(cycle(card), current, -1), current];
  for (let i = 1; i <= futureCount; i++) {
    refs.push(addInvoiceCycles(cycle(card), current, i));
  }
  return Promise.all(refs.map((ref) => invoiceView(householdId, card, ref, today, true)));
}
