import { asc, eq } from "drizzle-orm";
import { CreditCard, Landmark, Wallet } from "lucide-react";
import { db } from "@/lib/db";
import { AccountType, accounts } from "@/lib/db/schema";
import { formatBRL } from "@/lib/format";
import { getSessionContext } from "@/lib/auth/session";
import { AccountRowActions, type AccountRowData } from "./account-row-actions";
import { NewAccountButton } from "./new-account-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const TYPE_LABELS: Record<AccountType, string> = {
  [AccountType.BANK]: "Conta",
  [AccountType.WALLET]: "Dinheiro",
  [AccountType.CREDIT_CARD]: "Cartão",
};

function TypeIcon({ type }: { type: AccountType }) {
  const className = "size-4 text-primary";
  if (type === AccountType.CREDIT_CARD) return <CreditCard className={className} />;
  if (type === AccountType.WALLET) return <Wallet className={className} />;
  return <Landmark className={className} />;
}

function AccountRow({ account }: { account: AccountRowData }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-3">
        <TypeIcon type={account.type} />
        <div className="flex flex-col">
          <span className="text-sm">{account.name}</span>
          <span className="text-xs text-muted-foreground">
            {account.type === AccountType.CREDIT_CARD
              ? `Fecha dia ${account.closingDay} · vence dia ${account.dueDay}` +
                (account.creditLimitCents !== null
                  ? ` · limite ${formatBRL(account.creditLimitCents)}`
                  : "")
              : TYPE_LABELS[account.type]}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Badge variant="secondary">{TYPE_LABELS[account.type]}</Badge>
        <AccountRowActions account={account} />
      </div>
    </div>
  );
}

export default async function ContasPage() {
  const session = await getSessionContext();

  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.householdId, session.householdId))
    .orderBy(asc(accounts.createdAt));

  const toRow = (r: (typeof rows)[number]): AccountRowData => ({
    id: r.id,
    name: r.name,
    type: r.type as AccountType,
    closingDay: r.closingDay,
    dueDay: r.dueDay,
    creditLimitCents: r.creditLimitCents,
    archived: r.archivedAt !== null,
  });

  const active = rows.filter((r) => r.archivedAt === null).map(toRow);
  const archived = rows.filter((r) => r.archivedAt !== null).map(toRow);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Contas e cartões</h1>
        <NewAccountButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ativas</CardTitle>
          <CardDescription>Contas e cartões usados nos lançamentos da família.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma conta ainda. Crie a primeira para começar a lançar gastos.
            </p>
          ) : (
            active.map((account) => <AccountRow key={account.id} account={account} />)
          )}
        </CardContent>
      </Card>

      {archived.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Arquivadas</CardTitle>
            <CardDescription>
              Fora de uso, mas preservadas no histórico de transações.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {archived.map((account) => (
              <AccountRow key={account.id} account={account} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
