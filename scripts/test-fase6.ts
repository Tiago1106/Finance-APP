/**
 * Verificacao da Fase 6.
 * Uso: npx tsx scripts/test-fase6.ts <seed|cron|cleanup> [port]
 *  - seed:    semeia dados realistas no household de teste
 *  - cron:    chama /api/cron/{monthly,daily} no dev server e valida efeitos
 *  - cleanup: limpa os dados e restaura o vinculo do Telegram
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq, sql as dsql } from "drizzle-orm";

const FAKE_TG = "999000111";

async function main() {
  const mode = process.argv[2];
  const port = process.argv[3] ?? "3000";

  const { db } = await import("../src/lib/db");
  const schema = await import("../src/lib/db/schema");
  const { toSaoPauloCivilDate, civilToISO, addDaysCivil, addMonthsCivil, clampDayToMonth } =
    await import("../src/lib/core/date");

  const [hh] = await db
    .select()
    .from(schema.households)
    .where(eq(schema.households.name, "Família de Teste Dono"))
    .limit(1);
  if (!hh) throw new Error("Household de teste nao encontrado.");

  const [owner] = await db
    .select({ userId: schema.householdMembers.userId })
    .from(schema.householdMembers)
    .where(
      and(
        eq(schema.householdMembers.householdId, hh.id),
        eq(schema.householdMembers.role, "owner")
      )
    )
    .limit(1);
  const [member] = await db
    .select({ userId: schema.householdMembers.userId })
    .from(schema.householdMembers)
    .where(
      and(
        eq(schema.householdMembers.householdId, hh.id),
        eq(schema.householdMembers.role, "member")
      )
    )
    .limit(1);

  async function wipe() {
    await db.delete(schema.transactions).where(eq(schema.transactions.householdId, hh.id));
    await db.delete(schema.installmentPurchases).where(eq(schema.installmentPurchases.householdId, hh.id));
    await db.delete(schema.billInstances).where(eq(schema.billInstances.householdId, hh.id));
    await db.delete(schema.bills).where(eq(schema.bills.householdId, hh.id));
    await db.delete(schema.recurringRules).where(eq(schema.recurringRules.householdId, hh.id));
    await db.delete(schema.budgets).where(eq(schema.budgets.householdId, hh.id));
    await db.delete(schema.categories).where(eq(schema.categories.householdId, hh.id));
    await db.delete(schema.accounts).where(eq(schema.accounts.householdId, hh.id));
  }

  const today = toSaoPauloCivilDate(new Date());

  if (mode === "seed") {
    await wipe();

    const [bank] = await db
      .insert(schema.accounts)
      .values({ householdId: hh.id, name: "Nubank débito", type: "bank" })
      .returning();
    const [card] = await db
      .insert(schema.accounts)
      .values({
        householdId: hh.id,
        name: "Nubank crédito",
        type: "credit_card",
        closingDay: 28,
        dueDay: 5,
        creditLimitCents: 800000,
      })
      .returning();

    const cats = await db
      .insert(schema.categories)
      .values([
        { householdId: hh.id, name: "Alimentação" },
        { householdId: hh.id, name: "Transporte" },
        { householdId: hh.id, name: "Lazer" },
        { householdId: hh.id, name: "Moradia" },
      ])
      .returning();
    const cat = (name: string) => cats.find((c) => c.name === name)!.id;

    await db.insert(schema.budgets).values([
      { householdId: hh.id, categoryId: cat("Alimentação"), monthlyLimitCents: 120000 },
      { householdId: hh.id, categoryId: cat("Transporte"), monthlyLimitCents: 40000 },
    ]);

    const iso = (d: { year: number; month: number; day: number }) => civilToISO(d);
    const authorB = member?.userId ?? owner.userId;

    await db.insert(schema.transactions).values([
      // banco
      { householdId: hh.id, type: "expense", amountCents: 23000, description: "mercado semanal", occurredOn: iso(addDaysCivil(today, -5)), accountId: bank.id, categoryId: cat("Alimentação"), createdBy: owner.userId },
      { householdId: hh.id, type: "expense", amountCents: 89000, description: "mercado do mês", occurredOn: iso(addDaysCivil(today, -2)), accountId: bank.id, categoryId: cat("Alimentação"), createdBy: authorB },
      { householdId: hh.id, type: "expense", amountCents: 4500, description: "uber", occurredOn: iso(addDaysCivil(today, -1)), accountId: bank.id, categoryId: cat("Transporte"), createdBy: owner.userId },
      { householdId: hh.id, type: "income", amountCents: 500000, description: "salário", occurredOn: iso({ ...today, day: 1 }), accountId: bank.id, categoryId: null, createdBy: owner.userId },
      // cartao (fatura atual)
      { householdId: hh.id, type: "expense", amountCents: 13000, description: "restaurante", occurredOn: iso(today), accountId: card.id, categoryId: cat("Alimentação"), createdBy: authorB },
      { householdId: hh.id, type: "expense", amountCents: 8000, description: "cinema", occurredOn: iso(addDaysCivil(today, -1)), accountId: card.id, categoryId: cat("Lazer"), createdBy: owner.userId },
    ]);

    // parcelamento 3x no cartao
    const [purchase] = await db
      .insert(schema.installmentPurchases)
      .values({
        householdId: hh.id,
        accountId: card.id,
        categoryId: cat("Lazer"),
        description: "TV",
        totalAmountCents: 150000,
        totalInstallments: 3,
        currentInstallment: 1,
        createdBy: owner.userId,
      })
      .returning();
    await db.insert(schema.transactions).values(
      [0, 1, 2].map((i) => ({
        householdId: hh.id,
        type: "expense" as const,
        amountCents: 50000,
        description: `TV (${i + 1}/3)`,
        occurredOn: iso(i === 0 ? today : addMonthsCivil(today, i)),
        accountId: card.id,
        categoryId: cat("Lazer"),
        createdBy: owner.userId,
        installmentPurchaseId: purchase.id,
        installmentNumber: i + 1,
      }))
    );

    // recorrencia que vence HOJE (cron diario lanca)
    await db.insert(schema.recurringRules).values({
      householdId: hh.id,
      accountId: bank.id,
      categoryId: cat("Lazer"),
      type: "expense",
      description: "Netflix",
      amountCents: 5500,
      dayOfMonth: today.day,
      createdBy: owner.userId,
    });

    // bill variavel vencendo em 3 dias (lembrete D-3; instancia via cron mensal)
    await db.insert(schema.bills).values({
      householdId: hh.id,
      accountId: bank.id,
      categoryId: cat("Moradia"),
      name: "Conta de Luz",
      expectedDueDay: clampDayToMonth(today.day + 3, today.year, today.month),
      createdBy: owner.userId,
    });

    // bill FIXA vencendo hoje (cron diario paga sozinho)
    await db.insert(schema.bills).values({
      householdId: hh.id,
      accountId: bank.id,
      categoryId: cat("Moradia"),
      name: "Internet",
      expectedDueDay: today.day,
      isFixedAmount: true,
      fixedAmountCents: 9990,
      createdBy: owner.userId,
    });

    // bill vencida ha 2 dias (instancia pre-criada pending → cron marca overdue)
    const [agua] = await db
      .insert(schema.bills)
      .values({
        householdId: hh.id,
        accountId: bank.id,
        categoryId: cat("Moradia"),
        name: "Água",
        expectedDueDay: Math.max(1, today.day - 2),
        createdBy: owner.userId,
      })
      .returning();
    await db.insert(schema.billInstances).values({
      billId: agua.id,
      householdId: hh.id,
      dueDate: iso(addDaysCivil(today, -2)),
      status: "pending",
    });

    // vincula telegram falso ao dono para o cron tentar notificar
    await db
      .update(schema.users)
      .set({ telegramUserId: FAKE_TG })
      .where(and(eq(schema.users.id, owner.userId), dsql`telegram_user_id is null`));

    console.log("Seed OK.");
    process.exit(0);
  }

  if (mode === "cron") {
    const secret = process.env.CRON_SECRET;
    const base = `http://localhost:${port}`;
    let failures = 0;
    const check = (label: string, cond: boolean, detail?: string) => {
      console.log(`  ${cond ? "OK " : "FALHOU"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
      if (!cond) failures++;
    };

    const call = async (path: string, auth = true) => {
      const res = await fetch(`${base}${path}`, {
        headers: auth ? { authorization: `Bearer ${secret}` } : {},
      });
      return { status: res.status, body: res.ok ? await res.json() : null };
    };

    console.log("Sem secret → 401");
    const unauth = await call("/api/cron/daily", false);
    check("401 sem Authorization", unauth.status === 401, String(unauth.status));

    console.log("Cron mensal");
    const monthly = await call("/api/cron/monthly");
    check("200", monthly.status === 200);
    check("criou 2 instancias (Luz, Internet)", monthly.body?.created === 2, JSON.stringify(monthly.body));

    console.log("Cron diario (1ª execucao)");
    const daily1 = await call("/api/cron/daily");
    check("200", daily1.status === 200);
    check("lancou 1 recorrencia", daily1.body?.recurringLaunched === 1, JSON.stringify(daily1.body));
    check("pagou 1 bill fixa", daily1.body?.fixedBillsPaid === 1, JSON.stringify(daily1.body));
    check("marcou 1 vencida", daily1.body?.overdueMarked === 1, JSON.stringify(daily1.body));
    check("enviou lembretes", (daily1.body?.reminders ?? 0) >= 2, JSON.stringify(daily1.body));

    console.log("Cron diario (2ª execucao — idempotencia)");
    const daily2 = await call("/api/cron/daily");
    check("nao relancou recorrencia", daily2.body?.recurringLaunched === 0, JSON.stringify(daily2.body));
    check("nao repagou bill fixa", daily2.body?.fixedBillsPaid === 0, JSON.stringify(daily2.body));

    console.log("Efeitos no banco");
    const [netflix] = await db
      .select({ n: dsql<number>`count(*)::int` })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.householdId, hh.id),
          eq(schema.transactions.description, "Netflix")
        )
      );
    check("transacao Netflix criada 1x", netflix.n === 1, String(netflix.n));

    const paidInternet = await db
      .select({ status: schema.billInstances.status, amount: schema.billInstances.amountCents })
      .from(schema.billInstances)
      .innerJoin(schema.bills, eq(schema.bills.id, schema.billInstances.billId))
      .where(and(eq(schema.bills.name, "Internet"), eq(schema.bills.householdId, hh.id)));
    check(
      "Internet paga com 99,90",
      paidInternet[0]?.status === "paid" && paidInternet[0]?.amount === 9990,
      JSON.stringify(paidInternet)
    );

    const agua = await db
      .select({ status: schema.billInstances.status })
      .from(schema.billInstances)
      .innerJoin(schema.bills, eq(schema.bills.id, schema.billInstances.billId))
      .where(and(eq(schema.bills.name, "Água"), eq(schema.bills.householdId, hh.id)));
    check("Água marcada overdue", agua[0]?.status === "overdue", JSON.stringify(agua));

    console.log(failures === 0 ? "\n✅ CRON OK" : `\n❌ ${failures} FALHAS`);
    process.exit(failures === 0 ? 0 : 1);
  }

  if (mode === "cleanup") {
    await wipe();
    await db
      .update(schema.users)
      .set({ telegramUserId: null })
      .where(and(eq(schema.users.id, owner.userId), eq(schema.users.telegramUserId, FAKE_TG)));
    console.log("Cleanup OK.");
    process.exit(0);
  }

  throw new Error("Modo invalido. Use: seed | cron | cleanup");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
