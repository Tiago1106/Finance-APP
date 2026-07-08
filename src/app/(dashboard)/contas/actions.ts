"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { AccountType, accounts } from "@/lib/db/schema";
import { parseBRLToCents } from "@/lib/core/money";
import { getSessionContext } from "@/lib/auth/session";

export type AccountActionState = {
  error: string | null;
};

const dayField = z.coerce
  .number()
  .int("Dia invalido.")
  .min(1, "O dia deve estar entre 1 e 31.")
  .max(31, "O dia deve estar entre 1 e 31.");

const baseFields = {
  name: z.string().trim().min(2, "Informe um nome com pelo menos 2 letras."),
};

const accountSchema = z.discriminatedUnion("type", [
  z.object({
    ...baseFields,
    type: z.enum([AccountType.BANK, AccountType.WALLET]),
  }),
  z.object({
    ...baseFields,
    type: z.literal(AccountType.CREDIT_CARD),
    closingDay: dayField,
    dueDay: dayField,
    creditLimit: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
  }),
]);

function parseAccountForm(formData: FormData) {
  const type = formData.get("type");
  const raw =
    type === AccountType.CREDIT_CARD
      ? {
          type,
          name: formData.get("name"),
          closingDay: formData.get("closingDay"),
          dueDay: formData.get("dueDay"),
          creditLimit: formData.get("creditLimit") ?? undefined,
        }
      : { type, name: formData.get("name") };

  return accountSchema.safeParse(raw);
}

type AccountValues = {
  name: string;
  type: AccountType;
  closingDay: number | null;
  dueDay: number | null;
  creditLimitCents: number | null;
};

function toValues(data: z.infer<typeof accountSchema>): Result<AccountValues> {
  if (data.type !== AccountType.CREDIT_CARD) {
    return {
      ok: true,
      data: {
        name: data.name,
        type: data.type,
        closingDay: null,
        dueDay: null,
        creditLimitCents: null,
      },
    };
  }

  let creditLimitCents: number | null = null;
  if (data.creditLimit !== undefined) {
    const parsed = parseBRLToCents(data.creditLimit);
    if (!parsed.ok) return { ok: false, error: parsed.error.message };
    creditLimitCents = parsed.data;
  }

  return {
    ok: true,
    data: {
      name: data.name,
      type: data.type,
      closingDay: data.closingDay,
      dueDay: data.dueDay,
      creditLimitCents,
    },
  };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export async function createAccount(
  _prev: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  const session = await getSessionContext();

  const parsed = parseAccountForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const values = toValues(parsed.data);
  if (!values.ok) return { error: values.error };

  await db.insert(accounts).values({
    householdId: session.householdId,
    ...values.data,
  });

  revalidatePath("/contas");
  return { error: null };
}

export async function updateAccount(
  _prev: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  const session = await getSessionContext();

  const accountId = z.uuid().safeParse(formData.get("accountId"));
  if (!accountId.success) {
    return { error: "Conta invalida." };
  }

  const parsed = parseAccountForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const values = toValues(parsed.data);
  if (!values.ok) return { error: values.error };

  // Posse: id do form so vale se pertencer ao household da sessao.
  const [updated] = await db
    .update(accounts)
    .set(values.data)
    .where(
      and(eq(accounts.id, accountId.data), eq(accounts.householdId, session.householdId))
    )
    .returning({ id: accounts.id });

  if (!updated) {
    return { error: "Conta nao encontrada." };
  }

  revalidatePath("/contas");
  return { error: null };
}

async function setArchived(formData: FormData, archived: boolean): Promise<AccountActionState> {
  const session = await getSessionContext();

  const accountId = z.uuid().safeParse(formData.get("accountId"));
  if (!accountId.success) {
    return { error: "Conta invalida." };
  }

  const [updated] = await db
    .update(accounts)
    .set({ archivedAt: archived ? new Date() : null })
    .where(
      and(eq(accounts.id, accountId.data), eq(accounts.householdId, session.householdId))
    )
    .returning({ id: accounts.id });

  if (!updated) {
    return { error: "Conta nao encontrada." };
  }

  revalidatePath("/contas");
  return { error: null };
}

export async function archiveAccount(
  _prev: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  return setArchived(formData, true);
}

export async function unarchiveAccount(
  _prev: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  return setArchived(formData, false);
}
