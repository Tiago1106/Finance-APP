import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { billInstances, bills } from "@/lib/db/schema";
import { civilToISO, toSaoPauloCivilDate } from "@/lib/core/date";
import { billInstanceDueDate, resolveBillStatus } from "@/lib/core/bills";
import { monthBoundsISO } from "@/lib/queries/common";

export const dynamic = "force-dynamic";
// Default da Vercel e 10s (Hobby) — percorre todas as bills ativas do
// household; 60s e o teto do plano Hobby.
export const maxDuration = 60;

/**
 * Cron mensal (ESCOPO 6.3.1): gera a pendencia do mes para cada conta a
 * pagar ativa que ainda nao tem. Idempotente — pode rodar mais de uma vez.
 */
export async function GET(request: Request): Promise<Response> {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const today = toSaoPauloCivilDate(new Date());
  const { start, end } = monthBoundsISO({ year: today.year, month: today.month });
  let created = 0;

  const activeBills = await db.select().from(bills).where(eq(bills.active, true));

  for (const bill of activeBills) {
    const [existing] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(billInstances)
      .where(
        and(
          eq(billInstances.billId, bill.id),
          gte(billInstances.dueDate, start),
          lte(billInstances.dueDate, end)
        )
      );
    if (existing.n > 0) continue;

    const due = billInstanceDueDate({
      expectedDueDay: bill.expectedDueDay,
      year: today.year,
      month: today.month,
    });
    if (!due.ok) continue;

    await db.insert(billInstances).values({
      billId: bill.id,
      householdId: bill.householdId,
      dueDate: civilToISO(due.data),
      status: resolveBillStatus({ dueDate: due.data, today, isPaid: false }),
    });
    created++;
  }

  return Response.json({ ok: true, date: civilToISO(today), created });
}
