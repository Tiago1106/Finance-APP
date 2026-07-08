import { and, eq, gte, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { TransactionType, budgets, categories, transactions } from "@/lib/db/schema";
import { budgetProgress, type BudgetLevel } from "@/lib/core/budget";
import { monthBoundsISO, type MonthRef } from "./common";

function monthConditions(
  householdId: string,
  month: MonthRef,
  personId?: string
): SQL[] {
  const { start, end } = monthBoundsISO(month);
  const conditions = [
    eq(transactions.householdId, householdId),
    gte(transactions.occurredOn, start),
    lte(transactions.occurredOn, end),
  ];
  if (personId) conditions.push(eq(transactions.createdBy, personId));
  return conditions;
}

export type MonthSummary = {
  spentCents: number;
  incomeCents: number;
  balanceCents: number;
};

/** Resumo do mes: gasto, receita e saldo (transferencias nao contam). */
export async function monthSummary(
  householdId: string,
  month: MonthRef,
  personId?: string
): Promise<MonthSummary> {
  const [row] = await db
    .select({
      spent: sql<number>`coalesce(sum(${transactions.amountCents}) filter (where ${transactions.type} = ${TransactionType.EXPENSE}), 0)::int`,
      income: sql<number>`coalesce(sum(${transactions.amountCents}) filter (where ${transactions.type} = ${TransactionType.INCOME}), 0)::int`,
    })
    .from(transactions)
    .where(and(...monthConditions(householdId, month, personId)));

  return {
    spentCents: row.spent,
    incomeCents: row.income,
    balanceCents: row.income - row.spent,
  };
}

export type CategorySlice = {
  categoryId: string | null;
  name: string;
  totalCents: number;
};

/** Gasto do mes por categoria (para o grafico do dashboard). */
export async function categorySpending(
  householdId: string,
  month: MonthRef,
  personId?: string
): Promise<CategorySlice[]> {
  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      name: sql<string | null>`${categories.name}`,
      total: sql<number>`sum(${transactions.amountCents})::int`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        ...monthConditions(householdId, month, personId),
        eq(transactions.type, TransactionType.EXPENSE)
      )
    )
    .groupBy(transactions.categoryId, categories.name)
    .orderBy(sql`sum(${transactions.amountCents}) desc`);

  return rows.map((r) => ({
    categoryId: r.categoryId,
    name: r.name ?? "Sem categoria",
    totalCents: r.total,
  }));
}

export type BudgetRow = {
  categoryId: string;
  name: string;
  limitCents: number;
  spentCents: number;
  percent: number;
  level: BudgetLevel;
};

/** Orcamentos da familia com o consumo do mes (limiares 80/100 do core). */
export async function budgetsWithProgress(
  householdId: string,
  month: MonthRef
): Promise<BudgetRow[]> {
  const { start, end } = monthBoundsISO(month);
  const rows = await db
    .select({
      categoryId: budgets.categoryId,
      name: categories.name,
      limit: budgets.monthlyLimitCents,
      spent: sql<number>`coalesce((
        select sum(t.amount_cents)
        from transactions t
        where t.household_id = ${householdId}
          and t.category_id = ${budgets.categoryId}
          and t.type = ${TransactionType.EXPENSE}
          and t.occurred_on >= ${start}
          and t.occurred_on <= ${end}
      ), 0)::int`,
    })
    .from(budgets)
    .innerJoin(categories, eq(categories.id, budgets.categoryId))
    .where(and(eq(budgets.householdId, householdId), isNotNull(budgets.categoryId)))
    .orderBy(categories.name);

  return rows.map((r) => {
    const progress = budgetProgress({ spentCents: r.spent, limitCents: r.limit });
    return {
      categoryId: r.categoryId,
      name: r.name,
      limitCents: r.limit,
      spentCents: r.spent,
      percent: progress.ok ? progress.data.percent : 0,
      level: progress.ok ? progress.data.level : "ok",
    };
  });
}
