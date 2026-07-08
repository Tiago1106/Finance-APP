"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { AccountType, accounts } from "@/lib/db/schema";
import { parseBRLToCents } from "@/lib/core/money";
import { getSessionContext } from "@/lib/auth/session";
import { payBillInstance, payCardInvoice } from "@/lib/services/pay-bill";

export type PayActionState = {
  error: string | null;
};

const schema = z.object({
  kind: z.enum(["bill", "invoice"]),
  refId: z.uuid(),
  amount: z.string().trim().min(1, "Informe o valor."),
  accountId: z.uuid("Escolha a conta pagadora."),
});

function revalidate() {
  revalidatePath("/pagamentos");
  revalidatePath("/");
  revalidatePath("/transacoes");
  revalidatePath("/faturas");
}

export async function markCommitmentPaid(
  _prev: PayActionState,
  formData: FormData
): Promise<PayActionState> {
  const session = await getSessionContext();

  const parsed = schema.safeParse({
    kind: formData.get("kind"),
    refId: formData.get("refId"),
    amount: formData.get("amount"),
    accountId: formData.get("accountId"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const amount = parseBRLToCents(parsed.data.amount);
  if (!amount.ok) return { error: amount.error.message };
  if (amount.data === 0) return { error: "O valor não pode ser zero." };

  // Conta pagadora precisa ser do household e nao pode ser cartao.
  const [payer] = await db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, parsed.data.accountId),
        eq(accounts.householdId, session.householdId),
        isNull(accounts.archivedAt)
      )
    )
    .limit(1);
  if (!payer || payer.type === AccountType.CREDIT_CARD) {
    return { error: "Conta pagadora inválida." };
  }

  if (parsed.data.kind === "bill") {
    const result = await payBillInstance({
      householdId: session.householdId,
      userId: session.userId,
      instanceId: parsed.data.refId,
      amountCents: amount.data,
      accountId: payer.id,
    });
    if (!result.ok) return { error: result.error.message };
  } else {
    // fatura: refId = conta do cartao
    const [card] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, parsed.data.refId),
          eq(accounts.householdId, session.householdId),
          eq(accounts.type, AccountType.CREDIT_CARD)
        )
      )
      .limit(1);
    if (!card) return { error: "Cartão não encontrado." };

    await payCardInvoice({
      householdId: session.householdId,
      userId: session.userId,
      cardAccountId: card.id,
      fromAccountId: payer.id,
      amountCents: amount.data,
    });
  }

  revalidate();
  return { error: null };
}
