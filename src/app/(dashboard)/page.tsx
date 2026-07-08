import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { householdMembers, users } from "@/lib/db/schema";
import { toSaoPauloCivilDate } from "@/lib/core/date";
import { BudgetLevel } from "@/lib/core/budget";
import { formatBRL } from "@/lib/format";
import { getSessionContext } from "@/lib/auth/session";
import {
  addMonthsRef,
  currentMonthSP,
  monthParamValue,
  parseMonthParam,
} from "@/lib/queries/common";
import { budgetsWithProgress, categorySpending, monthSummary } from "@/lib/queries/summary";
import { CommitmentStatus, monthCommitments } from "@/lib/queries/payments";
import { CategoryDonut } from "@/components/charts/category-donut";
import { MonthNav } from "@/components/month-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await getSessionContext();
  const month = parseMonthParam(params.m);
  const today = toSaoPauloCivilDate(new Date());

  const members = await db
    .select({ userId: householdMembers.userId, name: users.name, email: users.email })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, session.householdId));

  const person =
    typeof params.p === "string" && members.some((m) => m.userId === params.p)
      ? params.p
      : undefined;

  const [summary, slices, budgets, currentCommitments, nextCommitments] = await Promise.all([
    monthSummary(session.householdId, month, person),
    categorySpending(session.householdId, month, person),
    budgetsWithProgress(session.householdId, month),
    monthCommitments(session.householdId, month, today),
    monthCommitments(session.householdId, addMonthsRef(month, 1), today),
  ]);

  const upcoming = [
    ...currentCommitments,
    ...nextCommitments.filter((c) => c.kind === "invoice"),
  ]
    .filter((c) => c.status !== CommitmentStatus.PAID)
    .slice(0, 5);

  const personHref = (userId?: string) => {
    const p = new URLSearchParams({ m: monthParamValue(month) });
    if (userId) p.set("p", userId);
    return `/?${p.toString()}`;
  };

  const isCurrentMonth =
    month.year === currentMonthSP().year && month.month === currentMonthSP().month;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Visão geral</h1>
        <MonthNav month={month} basePath="/" extraParams={person ? { p: person } : {}} />
      </div>

      {/* Filtro por pessoa */}
      <div className="flex flex-wrap gap-2">
        <Badge asChild variant={person === undefined ? "default" : "secondary"}>
          <Link href={personHref()}>Família toda</Link>
        </Badge>
        {members.map((m) => (
          <Badge asChild key={m.userId} variant={person === m.userId ? "default" : "secondary"}>
            <Link href={personHref(m.userId)}>{m.name ?? m.email}</Link>
          </Badge>
        ))}
      </div>

      {/* Resumo do mes */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="gap-1 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-xs font-normal text-muted-foreground">Gastos</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <span className="text-lg font-semibold tabular-nums text-expense sm:text-2xl">
              {formatBRL(summary.spentCents)}
            </span>
          </CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-xs font-normal text-muted-foreground">Receitas</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <span className="text-lg font-semibold tabular-nums text-income sm:text-2xl">
              {formatBRL(summary.incomeCents)}
            </span>
          </CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-xs font-normal text-muted-foreground">Saldo</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <span
              className={`text-lg font-semibold tabular-nums sm:text-2xl ${summary.balanceCents < 0 ? "text-expense" : "text-income"}`}
            >
              {formatBRL(summary.balanceCents)}
            </span>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Gastos por categoria */}
        <Card>
          <CardHeader>
            <CardTitle>Gastos por categoria</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryDonut
              data={slices.map((s) => ({ name: s.name, value: s.totalCents }))}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {/* Orcamentos */}
          <Card>
            <CardHeader>
              <CardTitle>Orçamentos</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {budgets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum orçamento definido.{" "}
                  <Link href="/orcamentos" className="text-primary hover:text-primary-hover">
                    Definir agora
                  </Link>
                </p>
              ) : (
                budgets.map((b) => (
                  <div key={b.categoryId} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>
                        {b.name}
                        {b.level === BudgetLevel.WARNING && " ⚠️"}
                        {b.level === BudgetLevel.EXCEEDED && " 🚨"}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatBRL(b.spentCents)} / {formatBRL(b.limitCents)}
                      </span>
                    </div>
                    <ProgressBar percent={b.percent} level={b.level} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Proximos compromissos */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{isCurrentMonth ? "Próximos compromissos" : "Compromissos"}</CardTitle>
                <Link href="/pagamentos" className="text-sm text-primary hover:text-primary-hover">
                  Ver todos →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nada pendente. 🎉</p>
              ) : (
                upcoming.map((c) => (
                  <div
                    key={`${c.kind}-${c.refId}`}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {c.status === CommitmentStatus.OVERDUE && (
                        <span className="size-2 shrink-0 rounded-full bg-expense" />
                      )}
                      <span className="truncate">{c.name}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {String(c.dueDate.day).padStart(2, "0")}/
                        {String(c.dueDate.month).padStart(2, "0")}
                      </span>
                      <span className="tabular-nums">
                        {c.amountCents !== null ? formatBRL(c.amountCents) : "—"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
