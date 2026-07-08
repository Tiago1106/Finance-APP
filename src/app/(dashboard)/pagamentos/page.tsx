import Link from "next/link";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { AccountType, accounts } from "@/lib/db/schema";
import { civilToISO, compareCivil, toSaoPauloCivilDate } from "@/lib/core/date";
import { formatBRL } from "@/lib/format";
import { getSessionContext } from "@/lib/auth/session";
import { monthParamValue, parseMonthParam } from "@/lib/queries/common";
import {
  CommitmentStatus,
  commitmentTotals,
  monthCommitments,
  type Commitment,
} from "@/lib/queries/payments";
import { MonthNav } from "@/components/month-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MarkPaidButton, type PayerOption } from "./mark-paid-dialog";

const KIND_LABEL: Record<Commitment["kind"], string> = {
  bill: "CONTA",
  invoice: "FATURA",
  recurring: "ASSINATURA",
};

const FILTERS = [
  { key: "a", label: "A vencer" },
  { key: "v", label: "Vencidas" },
  { key: "p", label: "Pagas" },
  { key: "t", label: "Todas" },
] as const;

function StatusBadge({ c }: { c: Commitment }) {
  switch (c.status) {
    case CommitmentStatus.PAID:
      return (
        <Badge variant="outline" className="text-income">
          Paga
          {c.paidAt
            ? ` em ${String(c.paidAt.getDate()).padStart(2, "0")}/${String(c.paidAt.getMonth() + 1).padStart(2, "0")}`
            : ""}
        </Badge>
      );
    case CommitmentStatus.OVERDUE:
      return (
        <Badge variant="outline" className="text-expense">
          Vencida
        </Badge>
      );
    case CommitmentStatus.DUE_TODAY:
      return (
        <Badge variant="outline" className="text-warning">
          Vence hoje
        </Badge>
      );
    default:
      return <Badge variant="outline">A vencer</Badge>;
  }
}

export default async function PagamentosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await getSessionContext();
  const month = parseMonthParam(params.m);
  const today = toSaoPauloCivilDate(new Date());
  const filter = typeof params.f === "string" ? params.f : "t";

  const [commitments, payerAccounts] = await Promise.all([
    monthCommitments(session.householdId, month, today),
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(
        and(
          eq(accounts.householdId, session.householdId),
          ne(accounts.type, AccountType.CREDIT_CARD),
          isNull(accounts.archivedAt)
        )
      )
      .orderBy(accounts.name),
  ]);

  const totals = commitmentTotals(commitments);

  const visible = commitments.filter((c) => {
    switch (filter) {
      case "a":
        return c.status === CommitmentStatus.PENDING || c.status === CommitmentStatus.DUE_TODAY;
      case "v":
        return c.status === CommitmentStatus.OVERDUE;
      case "p":
        return c.status === CommitmentStatus.PAID;
      default:
        return true;
    }
  });

  // Agrupa por data de vencimento (ja vem ordenado por data).
  const groups: { dateISO: string; items: Commitment[] }[] = [];
  for (const c of visible) {
    const iso = civilToISO(c.dueDate);
    const last = groups[groups.length - 1];
    if (last && last.dateISO === iso) last.items.push(c);
    else groups.push({ dateISO: iso, items: [c] });
  }

  const filterHref = (key: string) =>
    `/pagamentos?${new URLSearchParams({ m: monthParamValue(month), f: key }).toString()}`;

  const payers: PayerOption[] = payerAccounts;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Pagamentos</h1>
        <MonthNav month={month} basePath="/pagamentos" extraParams={{ f: filter }} />
      </div>

      {/* Resumo do mes */}
      <Card>
        <CardContent className="grid grid-cols-3 gap-2 text-center">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">A pagar no mês</span>
            <span className="text-sm font-semibold tabular-nums sm:text-lg">
              {formatBRL(totals.totalCents)}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Já pago</span>
            <span className="text-sm font-semibold tabular-nums text-income sm:text-lg">
              {formatBRL(totals.paidCents)}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Falta</span>
            <span className="text-sm font-semibold tabular-nums text-warning sm:text-lg">
              {formatBRL(totals.remainingCents)}
            </span>
          </div>
        </CardContent>
      </Card>
      {totals.awaitingCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {totals.awaitingCount}{" "}
          {totals.awaitingCount === 1 ? "conta aguardando valor" : "contas aguardando valor"} (não
          entram no total).
        </p>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Badge asChild key={f.key} variant={filter === f.key ? "default" : "secondary"}>
            <Link href={filterHref(f.key)}>{f.label}</Link>
          </Badge>
        ))}
      </div>

      {/* Timeline */}
      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nada por aqui com esse filtro. 🎉
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => {
            const [y, m, d] = group.dateISO.split("-").map(Number);
            const isToday = compareCivil({ year: y, month: m, day: d }, today) === 0;
            return (
              <div key={group.dateISO} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-medium ${isToday ? "text-primary" : "text-muted-foreground"}`}
                  >
                    {String(d).padStart(2, "0")}/{String(m).padStart(2, "0")}
                  </span>
                  {isToday && <Badge className="h-5 text-[10px]">HOJE</Badge>}
                  <div className="h-px flex-1 bg-border" />
                </div>
                {group.items.map((c) => (
                  <Card key={`${c.kind}-${c.refId}`}>
                    <CardContent className="flex items-center justify-between gap-3 py-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[10px] font-medium tracking-wider text-muted-foreground">
                          {KIND_LABEL[c.kind]}
                        </span>
                        <span className="truncate text-sm">{c.name}</span>
                        <StatusBadge c={c} />
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className="text-sm font-semibold tabular-nums">
                          {c.amountCents !== null ? formatBRL(c.amountCents) : "aguardando valor"}
                        </span>
                        {c.status !== CommitmentStatus.PAID && c.kind !== "recurring" && (
                          <MarkPaidButton
                            kind={c.kind}
                            refId={c.refId}
                            name={c.name}
                            prefillCents={c.isFixedAmount ? c.amountCents : null}
                            defaultAccountId={c.defaultAccountId}
                            payerAccounts={payers}
                          />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
