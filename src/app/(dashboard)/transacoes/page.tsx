import { and, desc, eq, gte, ilike, isNull, lte, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  TransactionType,
  accounts,
  categories,
  householdMembers,
  transactions,
  users,
} from "@/lib/db/schema";
import { civilToISO, toSaoPauloCivilDate } from "@/lib/core/date";
import { formatBRL } from "@/lib/format";
import { getSessionContext } from "@/lib/auth/session";
import { monthBoundsISO, parseMonthParam } from "@/lib/queries/common";
import { MonthNav } from "@/components/month-nav";
import { Card, CardContent } from "@/components/ui/card";
import { FiltersBar } from "./filters-bar";
import {
  NewTransactionButton,
  TransactionRowActions,
  type TransactionRowData,
} from "./transaction-dialogs";

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

export default async function TransacoesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const session = await getSessionContext();
  const month = parseMonthParam(params.m);
  const { start, end } = monthBoundsISO(month);

  const [accountRows, categoryRows, memberRows] = await Promise.all([
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.householdId, session.householdId), isNull(accounts.archivedAt)))
      .orderBy(accounts.name),
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.householdId, session.householdId))
      .orderBy(categories.name),
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(householdMembers)
      .innerJoin(users, eq(users.id, householdMembers.userId))
      .where(eq(householdMembers.householdId, session.householdId)),
  ]);

  const conditions: SQL[] = [
    eq(transactions.householdId, session.householdId),
    gte(transactions.occurredOn, start),
    lte(transactions.occurredOn, end),
  ];
  const categoryFilter = str(params.c);
  const accountFilter = str(params.a);
  const personFilter = str(params.p);
  const typeFilter = str(params.t);
  const search = str(params.q);
  if (categoryFilter) conditions.push(eq(transactions.categoryId, categoryFilter));
  if (accountFilter) conditions.push(eq(transactions.accountId, accountFilter));
  if (personFilter) conditions.push(eq(transactions.createdBy, personFilter));
  if (typeFilter === "expense" || typeFilter === "income" || typeFilter === "transfer") {
    conditions.push(eq(transactions.type, typeFilter));
  }
  if (search) conditions.push(ilike(transactions.description, `%${search}%`));

  const toAccount = alias(accounts, "to_account");
  const rows = await db
    .select({
      id: transactions.id,
      type: transactions.type,
      amountCents: transactions.amountCents,
      description: transactions.description,
      occurredOn: transactions.occurredOn,
      accountId: transactions.accountId,
      accountName: accounts.name,
      toAccountName: toAccount.name,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      transferToAccountId: transactions.transferToAccountId,
      authorName: users.name,
      installmentNumber: transactions.installmentNumber,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(toAccount, eq(toAccount.id, transactions.transferToAccountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .innerJoin(users, eq(users.id, transactions.createdBy))
    .where(and(...conditions))
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt));

  const memberOptions = memberRows.map((m) => ({ id: m.id, name: m.name ?? m.email }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Transações</h1>
        <div className="flex items-center gap-2">
          <MonthNav month={month} basePath="/transacoes" />
          <NewTransactionButton
            accounts={accountRows}
            categories={categoryRows}
            defaultDate={civilToISO(toSaoPauloCivilDate(new Date()))}
          />
        </div>
      </div>

      <FiltersBar accounts={accountRows} categories={categoryRows} members={memberOptions} />

      <Card>
        <CardContent className="flex flex-col divide-y divide-border">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum lançamento com esses filtros.
            </p>
          ) : (
            rows.map((row) => {
              const isTransfer = row.type === TransactionType.TRANSFER;
              const valueClass =
                row.type === TransactionType.EXPENSE
                  ? "text-expense"
                  : row.type === TransactionType.INCOME
                    ? "text-income"
                    : "text-muted-foreground";
              const sign = row.type === TransactionType.EXPENSE ? "-" : row.type === TransactionType.INCOME ? "+" : "";
              const [, m, d] = row.occurredOn.split("-");
              const rowData: TransactionRowData = {
                id: row.id,
                type: row.type as TransactionType,
                amountCents: row.amountCents,
                description: row.description,
                occurredOn: row.occurredOn,
                accountId: row.accountId,
                categoryId: row.categoryId,
                transferToAccountId: row.transferToAccountId,
              };
              return (
                <div key={row.id} className="flex items-center gap-2 py-2.5">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">
                      {row.description ?? (isTransfer ? "Transferência" : "Lançamento")}
                      {row.installmentNumber !== null && ""}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {d}/{m} · {isTransfer ? `${row.accountName} → ${row.toAccountName}` : row.accountName}
                      {row.categoryName ? ` · ${row.categoryName}` : ""} ·{" "}
                      {row.authorName ?? "—"}
                    </span>
                  </div>
                  <span className={`shrink-0 text-sm font-medium tabular-nums ${valueClass}`}>
                    {sign}
                    {formatBRL(row.amountCents)}
                  </span>
                  <TransactionRowActions
                    transaction={rowData}
                    accounts={accountRows}
                    categories={categoryRows}
                  />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
