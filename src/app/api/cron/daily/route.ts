import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  BillInstanceStatus,
  billInstances,
  bills,
  recurringRules,
  transactions,
  users,
} from "@/lib/db/schema";
import { civilDiffDays, civilToISO, toSaoPauloCivilDate } from "@/lib/core/date";
import { occursOn } from "@/lib/core/recurrence";
import { monthBoundsISO, isoToCivil } from "@/lib/queries/common";
import { payBillInstance } from "@/lib/services/pay-bill";
import { notifyUser } from "@/lib/bot/notify";
import { deleteExpiredPendingActions } from "@/lib/bot/pending";
import { formatBRL } from "@/lib/format";

export const dynamic = "force-dynamic";

function unauthorized(request: Request): boolean {
  return request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`;
}

async function telegramIdOf(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ tg: users.telegramUserId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.tg ?? null;
}

/**
 * Cron diario (ESCOPO 6.3 e 6.3.1):
 * 1. lanca recorrencias do dia e avisa o autor;
 * 2. paga automaticamente bills de valor fixo no vencimento;
 * 3. marca pendencias vencidas como overdue e envia lembretes (D-3, D-0, vencida);
 * 4. limpa acoes pendentes expiradas do bot.
 */
export async function GET(request: Request): Promise<Response> {
  if (unauthorized(request)) {
    return new Response("unauthorized", { status: 401 });
  }

  const today = toSaoPauloCivilDate(new Date());
  const { start, end } = monthBoundsISO({ year: today.year, month: today.month });
  const summary = { recurringLaunched: 0, fixedBillsPaid: 0, overdueMarked: 0, reminders: 0 };

  // 1. Recorrencias -----------------------------------------------------------
  const rules = await db
    .select()
    .from(recurringRules)
    .where(eq(recurringRules.active, true));

  for (const rule of rules) {
    const due = occursOn({ dayOfMonth: rule.dayOfMonth }, today);
    if (!due.ok || !due.data) continue;

    // dedup: ja lancada neste mes (cron pode rodar mais de uma vez)
    const [existing] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(
        and(
          eq(transactions.recurringRuleId, rule.id),
          gte(transactions.occurredOn, start),
          lte(transactions.occurredOn, end)
        )
      );
    if (existing.n > 0) continue;

    await db.insert(transactions).values({
      householdId: rule.householdId,
      type: rule.type,
      amountCents: rule.amountCents,
      description: rule.description,
      occurredOn: civilToISO(today),
      accountId: rule.accountId,
      categoryId: rule.categoryId,
      createdBy: rule.createdBy,
      recurringRuleId: rule.id,
    });
    summary.recurringLaunched++;

    const tg = await telegramIdOf(rule.createdBy);
    if (tg) {
      await notifyUser(
        tg,
        `🔁 Lançado automaticamente: ${rule.description} ${formatBRL(rule.amountCents)}`
      );
    }
  }

  // 2 e 3. Pendencias de contas a pagar --------------------------------------
  const instances = await db
    .select({
      id: billInstances.id,
      dueDate: billInstances.dueDate,
      status: billInstances.status,
      householdId: billInstances.householdId,
      billName: bills.name,
      isFixedAmount: bills.isFixedAmount,
      fixedAmountCents: bills.fixedAmountCents,
      createdBy: bills.createdBy,
    })
    .from(billInstances)
    .innerJoin(bills, eq(bills.id, billInstances.billId))
    .where(
      inArray(billInstances.status, [BillInstanceStatus.PENDING, BillInstanceStatus.OVERDUE])
    );

  for (const instance of instances) {
    const due = isoToCivil(instance.dueDate);
    const daysUntilDue = civilDiffDays(due, today);
    const tg = await telegramIdOf(instance.createdBy);

    // valor fixo → paga sozinha no vencimento (comporta-se como recorrencia)
    if (instance.isFixedAmount && instance.fixedAmountCents !== null && daysUntilDue <= 0) {
      const paid = await payBillInstance({
        householdId: instance.householdId,
        userId: instance.createdBy,
        instanceId: instance.id,
        amountCents: instance.fixedAmountCents,
      });
      if (paid.ok) {
        summary.fixedBillsPaid++;
        if (tg) {
          await notifyUser(
            tg,
            `🔁 ${instance.billName} ${formatBRL(instance.fixedAmountCents)} paga automaticamente (valor fixo).`
          );
        }
      }
      continue;
    }

    // vencida → marca overdue (uma vez)
    if (daysUntilDue < 0 && instance.status === BillInstanceStatus.PENDING) {
      await db
        .update(billInstances)
        .set({ status: BillInstanceStatus.OVERDUE })
        .where(eq(billInstances.id, instance.id));
      summary.overdueMarked++;
    }

    // lembretes: 3 dias antes, no dia e apos vencer (cron 1x/dia = dedup natural)
    let reminder: string | null = null;
    if (daysUntilDue === 3) {
      reminder = `📋 ${instance.billName} vence em 3 dias. Quando pagar, me manda o valor (ex: "${instance.billName.toLowerCase()} 187").`;
    } else if (daysUntilDue === 0) {
      reminder = `📋 ${instance.billName} vence HOJE. Me manda o valor quando pagar.`;
    } else if (daysUntilDue < 0) {
      reminder = `🔴 ${instance.billName} está vencida desde ${String(due.day).padStart(2, "0")}/${String(due.month).padStart(2, "0")}. Me manda o valor quando pagar.`;
    }
    if (reminder && tg) {
      await notifyUser(tg, reminder);
      summary.reminders++;
    }
  }

  // 4. Limpeza ----------------------------------------------------------------
  await deleteExpiredPendingActions();

  return Response.json({ ok: true, date: civilToISO(today), ...summary });
}
