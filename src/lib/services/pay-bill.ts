import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  BillInstanceStatus,
  TransactionType,
  billInstances,
  bills,
  transactions,
} from "@/lib/db/schema";
import { civilToISO, toSaoPauloCivilDate } from "@/lib/core/date";
import { err, ok, type Result } from "@/lib/core/result";

export type PayError = {
  code: "pay/instance_not_found" | "pay/already_paid";
  message: string;
};

export type PayBillResult = {
  billName: string;
  accountId: string;
  categoryId: string | null;
};

/**
 * Paga uma pendencia de conta a pagar: cria a transacao (na data de hoje) e
 * marca a instancia como paga. Fonte UNICA — usada pelo bot ("luz 187"),
 * pela tela Pagamentos e pelo cron (bills de valor fixo).
 */
export async function payBillInstance(params: {
  householdId: string;
  userId: string;
  instanceId: string;
  amountCents: number;
  /** Conta pagadora; default = conta padrao da bill. */
  accountId?: string;
}): Promise<Result<PayBillResult, PayError>> {
  const [row] = await db
    .select({
      instanceId: billInstances.id,
      status: billInstances.status,
      billName: bills.name,
      billAccountId: bills.accountId,
      categoryId: bills.categoryId,
    })
    .from(billInstances)
    .innerJoin(bills, eq(bills.id, billInstances.billId))
    .where(
      and(
        eq(billInstances.id, params.instanceId),
        eq(billInstances.householdId, params.householdId)
      )
    )
    .limit(1);

  if (!row) {
    return err({ code: "pay/instance_not_found", message: "Pendência não encontrada." });
  }
  if (row.status === BillInstanceStatus.PAID) {
    return err({ code: "pay/already_paid", message: "Essa pendência já foi paga." });
  }

  const accountId = params.accountId ?? row.billAccountId;
  const today = toSaoPauloCivilDate(new Date());

  await db.transaction(async (tx) => {
    await tx.insert(transactions).values({
      householdId: params.householdId,
      type: TransactionType.EXPENSE,
      amountCents: params.amountCents,
      description: row.billName,
      occurredOn: civilToISO(today),
      accountId,
      categoryId: row.categoryId,
      createdBy: params.userId,
      billInstanceId: row.instanceId,
    });
    await tx
      .update(billInstances)
      .set({
        status: BillInstanceStatus.PAID,
        amountCents: params.amountCents,
        paidAt: new Date(),
      })
      .where(eq(billInstances.id, row.instanceId));
  });

  return ok({ billName: row.billName, accountId, categoryId: row.categoryId });
}

/**
 * Paga a fatura de um cartao: transferencia conta → cartao (ESCOPO 5.8/6.5).
 * Transferencia nao afeta categorias nem orcamento.
 */
export async function payCardInvoice(params: {
  householdId: string;
  userId: string;
  cardAccountId: string;
  fromAccountId: string;
  amountCents: number;
}): Promise<void> {
  const today = toSaoPauloCivilDate(new Date());
  await db.insert(transactions).values({
    householdId: params.householdId,
    type: TransactionType.TRANSFER,
    amountCents: params.amountCents,
    description: "Pagamento de fatura",
    occurredOn: civilToISO(today),
    accountId: params.fromAccountId,
    transferToAccountId: params.cardAccountId,
    createdBy: params.userId,
  });
}
