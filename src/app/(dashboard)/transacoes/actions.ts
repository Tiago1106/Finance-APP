"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { TransactionType, accounts, categories, transactions } from "@/lib/db/schema";
import { parseBRLToCents } from "@/lib/core/money";
import { getSessionContext } from "@/lib/auth/session";

export type TransactionActionState = {
  error: string | null;
};

const baseSchema = z.object({
  type: z.enum([TransactionType.EXPENSE, TransactionType.INCOME, TransactionType.TRANSFER]),
  amount: z.string().trim().min(1, "Informe o valor."),
  description: z.string().trim().max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  accountId: z.uuid("Escolha a conta."),
  categoryId: z
    .string()
    .optional()
    .transform((v) => (v && v !== "none" ? v : undefined))
    .pipe(z.uuid().optional()),
  transferToAccountId: z
    .string()
    .optional()
    .transform((v) => (v && v !== "none" ? v : undefined))
    .pipe(z.uuid().optional()),
});

type ParsedTransaction = {
  type: TransactionType;
  amountCents: number;
  description: string | null;
  occurredOn: string;
  accountId: string;
  categoryId: string | null;
  transferToAccountId: string | null;
};

async function parseAndValidate(
  formData: FormData,
  householdId: string
): Promise<{ ok: true; data: ParsedTransaction } | { ok: false; error: string }> {
  const parsed = baseSchema.safeParse({
    type: formData.get("type"),
    amount: formData.get("amount"),
    description: formData.get("description") ?? "",
    date: formData.get("date"),
    accountId: formData.get("accountId"),
    categoryId: formData.get("categoryId") ?? undefined,
    transferToAccountId: formData.get("transferToAccountId") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const amount = parseBRLToCents(parsed.data.amount);
  if (!amount.ok) return { ok: false, error: amount.error.message };

  // Posse: contas/categoria precisam ser do household da sessao.
  const accountIds = [parsed.data.accountId];
  if (parsed.data.transferToAccountId) accountIds.push(parsed.data.transferToAccountId);
  const ownedAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), inArray(accounts.id, accountIds)));
  if (ownedAccounts.length !== new Set(accountIds).size) {
    return { ok: false, error: "Conta inválida." };
  }

  if (parsed.data.categoryId) {
    const [owned] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(eq(categories.householdId, householdId), eq(categories.id, parsed.data.categoryId))
      );
    if (!owned) return { ok: false, error: "Categoria inválida." };
  }

  if (parsed.data.type === TransactionType.TRANSFER) {
    if (!parsed.data.transferToAccountId) {
      return { ok: false, error: "Transferência precisa da conta de destino." };
    }
    if (parsed.data.transferToAccountId === parsed.data.accountId) {
      return { ok: false, error: "Origem e destino não podem ser a mesma conta." };
    }
  }

  return {
    ok: true,
    data: {
      type: parsed.data.type,
      amountCents: amount.data,
      description: parsed.data.description || null,
      occurredOn: parsed.data.date,
      accountId: parsed.data.accountId,
      categoryId:
        parsed.data.type === TransactionType.TRANSFER ? null : (parsed.data.categoryId ?? null),
      transferToAccountId:
        parsed.data.type === TransactionType.TRANSFER
          ? (parsed.data.transferToAccountId ?? null)
          : null,
    },
  };
}

export async function createTransaction(
  _prev: TransactionActionState,
  formData: FormData
): Promise<TransactionActionState> {
  const session = await getSessionContext();
  const result = await parseAndValidate(formData, session.householdId);
  if (!result.ok) return { error: result.error };

  await db.insert(transactions).values({
    householdId: session.householdId,
    createdBy: session.userId,
    ...result.data,
  });

  revalidatePath("/transacoes");
  return { error: null };
}

export async function updateTransaction(
  _prev: TransactionActionState,
  formData: FormData
): Promise<TransactionActionState> {
  const session = await getSessionContext();

  const id = z.uuid().safeParse(formData.get("transactionId"));
  if (!id.success) return { error: "Lançamento inválido." };

  const result = await parseAndValidate(formData, session.householdId);
  if (!result.ok) return { error: result.error };

  const [updated] = await db
    .update(transactions)
    .set(result.data)
    .where(
      and(eq(transactions.id, id.data), eq(transactions.householdId, session.householdId))
    )
    .returning({ id: transactions.id });
  if (!updated) return { error: "Lançamento não encontrado." };

  revalidatePath("/transacoes");
  return { error: null };
}

export async function deleteTransaction(
  _prev: TransactionActionState,
  formData: FormData
): Promise<TransactionActionState> {
  const session = await getSessionContext();

  const id = z.uuid().safeParse(formData.get("transactionId"));
  if (!id.success) return { error: "Lançamento inválido." };

  await db
    .delete(transactions)
    .where(
      and(eq(transactions.id, id.data), eq(transactions.householdId, session.householdId))
    );

  revalidatePath("/transacoes");
  return { error: null };
}
