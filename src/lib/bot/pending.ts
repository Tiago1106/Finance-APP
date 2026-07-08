import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { BotPendingActionKind, botPendingActions } from "@/lib/db/schema";

const PENDING_TTL_MS = 15 * 60 * 1000;

/**
 * Rascunho de lancamento aguardando uma escolha do usuario via botao inline.
 * O callback_data do Telegram (limite 64 bytes) carrega so "pa:<id>:<opcao>";
 * o resto vive aqui.
 */
export type PendingPayload =
  | {
      flow: "expense" | "income";
      amountCents: number;
      description: string;
      categoryName: string | null;
      dateISO: string;
      accountId?: string;
      /** Opcoes exibidas nos botoes (indice = opcao do callback). */
      accountOptionIds?: string[];
      categoryOptionIds?: string[];
    }
  | {
      flow: "installment";
      totalCents: number;
      count: number;
      alreadyPaid: number | null;
      description: string;
      categoryName: string | null;
      accountId?: string;
      accountOptionIds?: string[];
      categoryOptionIds?: string[];
    }
  | {
      flow: "recurring";
      amountCents: number;
      description: string;
      dayOfMonth: number;
      type: "expense" | "income";
      categoryName: string | null;
      accountOptionIds?: string[];
    }
  | {
      flow: "bill";
      name: string;
      expectedDueDay: number;
      accountOptionIds?: string[];
    };

export async function createPendingAction(
  telegramUserId: string,
  kind: BotPendingActionKind,
  payload: PendingPayload
): Promise<string> {
  const [row] = await db
    .insert(botPendingActions)
    .values({
      telegramUserId,
      kind,
      payload,
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    })
    .returning({ id: botPendingActions.id });
  return row.id;
}

export async function loadPendingAction(id: string, telegramUserId: string) {
  const [row] = await db
    .select()
    .from(botPendingActions)
    .where(
      and(eq(botPendingActions.id, id), eq(botPendingActions.telegramUserId, telegramUserId))
    )
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await deletePendingAction(id);
    return null;
  }
  return { ...row, payload: row.payload as PendingPayload };
}

export async function deletePendingAction(id: string): Promise<void> {
  await db.delete(botPendingActions).where(eq(botPendingActions.id, id));
}

/** Limpeza oportunista de acoes expiradas (chamada pelo cron da Fase 6). */
export async function deleteExpiredPendingActions(): Promise<void> {
  await db.delete(botPendingActions).where(lt(botPendingActions.expiresAt, new Date()));
}
