import { and, eq, gte, lte, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { TransactionType, categories, transactions } from "@/lib/db/schema";
import { BudgetLevel } from "@/lib/core/budget";
import { formatBRL } from "@/lib/format";
import { getSessionContext } from "@/lib/auth/session";
import {
  addMonthsRef,
  monthBoundsISO,
  parseMonthParam,
} from "@/lib/queries/common";
import { budgetsWithProgress } from "@/lib/queries/summary";
import { MonthNav } from "@/components/month-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EditBudgetButton } from "./budget-dialog";

const MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function ProgressBar({ percent, level }: { percent: number; level: BudgetLevel }) {
  const color =
    level === BudgetLevel.EXCEEDED
      ? "bg-expense"
      : level === BudgetLevel.WARNING
        ? "bg-warning"
        : "bg-primary";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full ${color}`} style={{ width: `${Math.min(percent, 100)}%` }} />
    </div>
  );
}

export default async function OrcamentosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await getSessionContext();
  const month = parseMonthParam(params.m);

  const budgets = await budgetsWithProgress(session.householdId, month);
  const budgetedIds = budgets.map((b) => b.categoryId);

  const withoutBudget = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(
      and(
        eq(categories.householdId, session.householdId),
        budgetedIds.length > 0 ? notInArray(categories.id, budgetedIds) : undefined
      )
    )
    .orderBy(categories.name);

  // Historico: consumo dos ultimos 6 meses (mes atual incluso) por categoria.
  const historyMonths = Array.from({ length: 6 }, (_, i) => addMonthsRef(month, i - 5));
  const historyStart = monthBoundsISO(historyMonths[0]).start;
  const historyEnd = monthBoundsISO(month).end;

  const historyRows =
    budgetedIds.length > 0
      ? await db
          .select({
            categoryId: transactions.categoryId,
            ym: sql<string>`to_char(${transactions.occurredOn}::date, 'YYYY-MM')`,
            total: sql<number>`sum(${transactions.amountCents})::int`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.householdId, session.householdId),
              eq(transactions.type, TransactionType.EXPENSE),
              gte(transactions.occurredOn, historyStart),
              lte(transactions.occurredOn, historyEnd),
              sql`${transactions.categoryId} in ${budgetedIds}`
            )
          )
          .groupBy(transactions.categoryId, sql`to_char(${transactions.occurredOn}::date, 'YYYY-MM')`)
      : [];

  const historyMap = new Map<string, number>();
  for (const row of historyRows) {
    historyMap.set(`${row.categoryId}:${row.ym}`, row.total);
  }
  const ymOf = (ref: { year: number; month: number }) =>
    `${ref.year}-${String(ref.month).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Orçamentos</h1>
        <MonthNav month={month} basePath="/orcamentos" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Limites do mês</CardTitle>
          <CardDescription>
            Limite mensal por categoria, para a família inteira. Alertas do bot a partir de 80%.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {budgets.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum orçamento definido ainda. Defina abaixo. 👇
            </p>
          )}
          {budgets.map((b) => (
            <div key={b.categoryId} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm">
                  {b.name}
                  {b.level === BudgetLevel.WARNING && " ⚠️"}
                  {b.level === BudgetLevel.EXCEEDED && " 🚨"}
                </span>
                <div className="flex items-center gap-1">
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {formatBRL(b.spentCents)} / {formatBRL(b.limitCents)} ({b.percent}%)
                  </span>
                  <EditBudgetButton
                    categoryId={b.categoryId}
                    categoryName={b.name}
                    currentCents={b.limitCents}
                  />
                </div>
              </div>
              <ProgressBar percent={b.percent} level={b.level} />
            </div>
          ))}
        </CardContent>
      </Card>

      {withoutBudget.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Sem orçamento</CardTitle>
            <CardDescription>Categorias que ainda não têm limite definido.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {withoutBudget.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{c.name}</span>
                <EditBudgetButton categoryId={c.id} categoryName={c.name} currentCents={null} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {budgets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Histórico (6 meses)</CardTitle>
            <CardDescription>Consumo por categoria nos últimos meses.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-2 font-normal">Categoria</th>
                  {historyMonths.map((m) => (
                    <th key={ymOf(m)} className="pb-2 pr-2 text-right font-normal">
                      {MONTH_SHORT[m.month - 1]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {budgets.map((b) => (
                  <tr key={b.categoryId} className="border-t border-border">
                    <td className="max-w-28 truncate py-2 pr-2">{b.name}</td>
                    {historyMonths.map((m) => {
                      const cents = historyMap.get(`${b.categoryId}:${ymOf(m)}`) ?? 0;
                      const over = cents > b.limitCents;
                      return (
                        <td
                          key={ymOf(m)}
                          className={`py-2 pr-2 text-right tabular-nums ${over ? "text-expense" : ""}`}
                        >
                          {cents === 0 ? "—" : formatBRL(cents)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
