"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  bills,
  budgets,
  categories,
  installmentPurchases,
  recurringRules,
  transactions,
} from "@/lib/db/schema";
import { parseBRLToCents } from "@/lib/core/money";
import { getSessionContext } from "@/lib/auth/session";

export type CategoryActionState = {
  error: string | null;
};

function hasPgCode(e: unknown, code: string): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === code
  );
}

// Drizzle embrulha o PostgresError num DrizzleQueryError; o SQLSTATE fica em
// e.cause. Checamos os dois niveis.
function isUniqueViolation(e: unknown): boolean {
  if (hasPgCode(e, "23505")) return true;
  if (typeof e === "object" && e !== null && "cause" in e) {
    return hasPgCode((e as { cause: unknown }).cause, "23505");
  }
  return false;
}

async function findOwnCategory(categoryId: string, householdId: string) {
  const [category] = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.householdId, householdId)))
    .limit(1);
  return category ?? null;
}

export async function renameCategory(
  _prev: CategoryActionState,
  formData: FormData
): Promise<CategoryActionState> {
  const session = await getSessionContext();

  const parsed = z
    .object({
      categoryId: z.uuid(),
      name: z.string().trim().min(2, "Informe um nome com pelo menos 2 letras."),
    })
    .safeParse({
      categoryId: formData.get("categoryId"),
      name: formData.get("name"),
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const category = await findOwnCategory(parsed.data.categoryId, session.householdId);
  if (!category) {
    return { error: "Categoria nao encontrada." };
  }

  try {
    await db
      .update(categories)
      .set({ name: parsed.data.name })
      .where(eq(categories.id, category.id));
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { error: `Ja existe uma categoria chamada "${parsed.data.name}".` };
    }
    throw e;
  }

  revalidatePath("/categorias");
  return { error: null };
}

export async function mergeCategories(
  _prev: CategoryActionState,
  formData: FormData
): Promise<CategoryActionState> {
  const session = await getSessionContext();

  const parsed = z
    .object({ sourceId: z.uuid(), targetId: z.uuid() })
    .refine((d) => d.sourceId !== d.targetId, {
      message: "Escolha uma categoria de destino diferente.",
    })
    .safeParse({
      sourceId: formData.get("sourceId"),
      targetId: formData.get("targetId"),
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { sourceId, targetId } = parsed.data;
  const source = await findOwnCategory(sourceId, session.householdId);
  const target = await findOwnCategory(targetId, session.householdId);
  if (!source || !target) {
    return { error: "Categoria nao encontrada." };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(transactions)
      .set({ categoryId: targetId })
      .where(eq(transactions.categoryId, sourceId));
    await tx
      .update(installmentPurchases)
      .set({ categoryId: targetId })
      .where(eq(installmentPurchases.categoryId, sourceId));
    await tx
      .update(recurringRules)
      .set({ categoryId: targetId })
      .where(eq(recurringRules.categoryId, sourceId));
    await tx.update(bills).set({ categoryId: targetId }).where(eq(bills.categoryId, sourceId));
    // Orcamento da categoria de origem morre com ela; o da destino permanece.
    await tx.delete(budgets).where(eq(budgets.categoryId, sourceId));
    await tx.delete(categories).where(eq(categories.id, sourceId));
  });

  revalidatePath("/categorias");
  return { error: null };
}

export async function setBudget(
  _prev: CategoryActionState,
  formData: FormData
): Promise<CategoryActionState> {
  const session = await getSessionContext();

  const parsed = z
    .object({
      categoryId: z.uuid(),
      amount: z.string().trim(),
    })
    .safeParse({
      categoryId: formData.get("categoryId"),
      amount: formData.get("amount") ?? "",
    });

  if (!parsed.success) {
    return { error: "Dados invalidos." };
  }

  const category = await findOwnCategory(parsed.data.categoryId, session.householdId);
  if (!category) {
    return { error: "Categoria nao encontrada." };
  }

  // Vazio ou zero remove o orcamento.
  if (parsed.data.amount === "" || parsed.data.amount === "0" || parsed.data.amount === "0,00") {
    await db.delete(budgets).where(eq(budgets.categoryId, category.id));
    revalidatePath("/categorias");
    revalidatePath("/orcamentos");
    return { error: null };
  }

  const cents = parseBRLToCents(parsed.data.amount);
  if (!cents.ok) {
    return { error: cents.error.message };
  }
  if (cents.data === 0) {
    await db.delete(budgets).where(eq(budgets.categoryId, category.id));
    revalidatePath("/categorias");
    revalidatePath("/orcamentos");
    return { error: null };
  }

  await db
    .insert(budgets)
    .values({
      householdId: session.householdId,
      categoryId: category.id,
      monthlyLimitCents: cents.data,
    })
    .onConflictDoUpdate({
      target: [budgets.householdId, budgets.categoryId],
      set: { monthlyLimitCents: cents.data },
    });

  revalidatePath("/categorias");
  revalidatePath("/orcamentos");
  return { error: null };
}
