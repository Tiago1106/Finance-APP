import Link from "next/link";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { AccountType, accounts, installmentPurchases } from "@/lib/db/schema";
import { civilToISO, toSaoPauloCivilDate } from "@/lib/core/date";
import { formatBRL } from "@/lib/format";
import { getSessionContext } from "@/lib/auth/session";
import { invoiceTimeline, InvoiceStatus, type CardRef } from "@/lib/queries/invoices";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const STATUS_LABEL: Record<InvoiceStatus, { label: string; className: string }> = {
  [InvoiceStatus.OPEN]: { label: "Aberta", className: "text-primary" },
  [InvoiceStatus.CLOSED]: { label: "Fechada", className: "text-warning" },
  [InvoiceStatus.PAID]: { label: "Paga", className: "text-income" },
  [InvoiceStatus.FUTURE]: { label: "Projeção", className: "text-muted-foreground" },
};

function shortDate(d: { day: number; month: number }): string {
  return `${String(d.day).padStart(2, "0")}/${String(d.month).padStart(2, "0")}`;
}

export default async function FaturasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await getSessionContext();
  const today = toSaoPauloCivilDate(new Date());

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
        eq(accounts.householdId, session.householdId),
        eq(accounts.type, AccountType.CREDIT_CARD),
        isNull(accounts.archivedAt)
      )
    )
    .orderBy(accounts.name);

  if (cards.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Faturas</h1>
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhum cartão de crédito cadastrado.{" "}
            <Link href="/contas" className="text-primary hover:text-primary-hover">
              Cadastrar cartão
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedId = typeof params.card === "string" ? params.card : cards[0].id;
  const selected = cards.find((c) => c.id === selectedId) ?? cards[0];
  const cardRef: CardRef = {
    id: selected.id,
    name: selected.name,
    closingDay: selected.closingDay!,
    dueDay: selected.dueDay!,
  };

  const [timeline, installments] = await Promise.all([
    invoiceTimeline(session.householdId, cardRef, today, 3),
    db
      .select({
        id: installmentPurchases.id,
        description: installmentPurchases.description,
        totalInstallments: installmentPurchases.totalInstallments,
        totalAmountCents: installmentPurchases.totalAmountCents,
        // Nome qualificado literal: interpolar a coluna via drizzle numa query
        // de tabela unica gera "id" sem prefixo, que dentro da subquery
        // resolveria para t.id (bug sutil de correlacao).
        billed: sql<number>`(
          select count(*) from transactions t
          where t.installment_purchase_id = installment_purchases.id
            and t.occurred_on <= ${civilToISO(today)}
        )::int`,
        remaining: sql<number>`(
          select count(*) from transactions t
          where t.installment_purchase_id = installment_purchases.id
            and t.occurred_on > ${civilToISO(today)}
        )::int`,
      })
      .from(installmentPurchases)
      .where(
        and(
          eq(installmentPurchases.householdId, session.householdId),
          eq(installmentPurchases.accountId, selected.id)
        )
      ),
  ]);

  const activeInstallments = installments.filter((i) => i.remaining > 0);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Faturas</h1>

      {/* Seletor de cartao */}
      <div className="flex flex-wrap gap-2">
        {cards.map((c) => (
          <Badge asChild key={c.id} variant={c.id === selected.id ? "default" : "secondary"}>
            <Link href={`/faturas?card=${c.id}`}>{c.name}</Link>
          </Badge>
        ))}
      </div>

      {activeInstallments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Compras parceladas em andamento</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {activeInstallments.map((i) => {
              // "7 de 10" = parcelas ja faturadas do total original
              const paidOfTotal = i.totalInstallments - i.remaining;
              return (
                <div key={i.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{i.description}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {paidOfTotal} de {i.totalInstallments} · {formatBRL(i.totalAmountCents)}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {timeline.map((view) => {
        const status = STATUS_LABEL[view.status];
        return (
          <Card key={`${view.ref.referenceYear}-${view.ref.referenceMonth}`}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>
                  {MONTHS[view.ref.referenceMonth - 1].charAt(0).toUpperCase()}
                  {MONTHS[view.ref.referenceMonth - 1].slice(1)} de {view.ref.referenceYear}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold tabular-nums">
                    {formatBRL(view.totalCents)}
                  </span>
                  <Badge variant="outline" className={status.className}>
                    {status.label}
                  </Badge>
                </div>
              </div>
              <CardDescription>
                Fecha {shortDate(view.ref.closingDate)} · vence {shortDate(view.ref.dueDate)}
              </CardDescription>
            </CardHeader>
            {view.transactions.length > 0 && (
              <CardContent className="flex flex-col divide-y divide-border">
                {view.transactions.map((t) => {
                  const [, m, d] = t.occurredOn.split("-");
                  return (
                    <div key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate">{t.description ?? "Lançamento"}</span>
                        <span className="text-xs text-muted-foreground">
                          {d}/{m}
                        </span>
                      </div>
                      <span className="shrink-0 tabular-nums">{formatBRL(t.amountCents)}</span>
                    </div>
                  );
                })}
              </CardContent>
            )}
          </Card>
        );
      })}

    </div>
  );
}
