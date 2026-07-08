/**
 * Popula o household de teste com dados variados e realistas — contas,
 * cartões, categorias, orçamentos, transações de 3 meses, parcelamentos
 * (novo e em andamento), recorrências, contas a pagar em todos os status
 * (paga, pendente, vencida) e faturas de cartão pagas/abertas/projetadas.
 *
 * Reescreve os dados de negócio do household (mantém household/usuários/
 * vínculos). Uso: npx tsx scripts/seed.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

function unwrap<T, E>(r: { ok: true; data: T } | { ok: false; error: E }, label: string): T {
  if (!r.ok) throw new Error(`${label}: ${JSON.stringify(r.error)}`);
  return r.data;
}

async function main() {
  const { db } = await import("../src/lib/db");
  const schema = await import("../src/lib/db/schema");
  const {
    AccountType,
    RecurringType,
    HouseholdRole,
    householdMembers,
    households,
    accounts,
    categories,
    budgets,
    transactions,
    installmentPurchases,
    recurringRules,
    bills,
    billInstances,
  } = schema;
  const { eq } = await import("drizzle-orm");
  type CardCycle = { closingDay: number; dueDay: number };

  const { toSaoPauloCivilDate, addMonthsCivil, addDaysCivil, clampDayToMonth, civilToISO } =
    await import("../src/lib/core/date");
  const { resolveInvoiceForPurchase, invoicePeriod } = await import("../src/lib/core/invoice");
  const { invoiceRefForMonth } = await import("../src/lib/queries/invoices");
  const { generateInstallmentPlan, generateRemainingInstallments } = await import(
    "../src/lib/core/installments"
  );
  const { billInstanceDueDate, resolveBillStatus } = await import("../src/lib/core/bills");

  // ---- household alvo -------------------------------------------------
  const [hh] = await db.select().from(households).limit(1);
  if (!hh) {
    throw new Error(
      "Nenhum household encontrado. Crie sua conta pelo app (signup) antes de rodar o seed."
    );
  }
  const members = await db
    .select({ userId: householdMembers.userId, role: householdMembers.role })
    .from(householdMembers)
    .where(eq(householdMembers.householdId, hh.id));
  const owner = members.find((m) => m.role === HouseholdRole.OWNER);
  const member = members.find((m) => m.role === HouseholdRole.MEMBER) ?? owner;
  if (!owner) throw new Error("Household sem owner.");
  const ownerId = owner.userId;
  const memberId = member!.userId;

  console.log(`Household: ${hh.name} (${hh.id})`);

  // ---- limpa dados de negocio (mantem household/usuarios/membership) --
  async function wipe() {
    await db.delete(transactions).where(eq(transactions.householdId, hh.id));
    await db.delete(installmentPurchases).where(eq(installmentPurchases.householdId, hh.id));
    await db.delete(billInstances).where(eq(billInstances.householdId, hh.id));
    await db.delete(bills).where(eq(bills.householdId, hh.id));
    await db.delete(recurringRules).where(eq(recurringRules.householdId, hh.id));
    await db.delete(budgets).where(eq(budgets.householdId, hh.id));
    await db.delete(categories).where(eq(categories.householdId, hh.id));
    await db.delete(accounts).where(eq(accounts.householdId, hh.id));
  }
  await wipe();

  const today = toSaoPauloCivilDate(new Date());
  const m0 = { year: today.year, month: today.month };
  const m1 = addMonthsCivil({ ...today, day: 1 }, -1);
  const m2 = addMonthsCivil({ ...today, day: 1 }, -2);

  // ---- contas -----------------------------------------------------------
  const [bank, wallet, card1, card2] = await db
    .insert(accounts)
    .values([
      { householdId: hh.id, name: "Nubank débito", type: AccountType.BANK },
      { householdId: hh.id, name: "Carteira", type: AccountType.WALLET },
      {
        householdId: hh.id,
        name: "Nubank crédito",
        type: AccountType.CREDIT_CARD,
        closingDay: 28,
        dueDay: 5,
        creditLimitCents: 500000,
      },
      {
        householdId: hh.id,
        name: "Itaú crédito",
        type: AccountType.CREDIT_CARD,
        closingDay: 10,
        dueDay: 17,
        creditLimitCents: 300000,
      },
    ])
    .returning();

  const card1Cycle: CardCycle = { closingDay: card1.closingDay!, dueDay: card1.dueDay! };
  const card2Cycle: CardCycle = { closingDay: card2.closingDay!, dueDay: card2.dueDay! };

  // ---- categorias ---------------------------------------------------------
  const categoryNames = [
    "Alimentação",
    "Transporte",
    "Moradia",
    "Lazer",
    "Saúde",
    "Educação",
    "Eletrônicos",
    "Pets",
  ];
  const catRows = await db
    .insert(categories)
    .values(categoryNames.map((name) => ({ householdId: hh.id, name })))
    .returning();
  const cat = Object.fromEntries(catRows.map((c) => [c.name, c.id])) as Record<string, string>;

  // ---- orcamentos (deixa Saude/Educacao/Eletronicos/Pets sem limite) -----
  await db.insert(budgets).values([
    { householdId: hh.id, categoryId: cat["Alimentação"], monthlyLimitCents: 120000 },
    { householdId: hh.id, categoryId: cat["Transporte"], monthlyLimitCents: 40000 },
    { householdId: hh.id, categoryId: cat["Moradia"], monthlyLimitCents: 300000 },
    { householdId: hh.id, categoryId: cat["Lazer"], monthlyLimitCents: 30000 },
  ]);

  // ---- transacoes: 3 meses (M-2, M-1, M0) ---------------------------------
  type ExpenseTpl = {
    desc: string;
    category: string;
    account: typeof bank;
    amountCents: number;
    day: number;
    by: string;
  };

  function monthTemplates(monthTag: "m2" | "m1" | "m0"): ExpenseTpl[] {
    // Valores variam levemente por mes para o historico do orcamento nao ficar identico.
    const bump = monthTag === "m0" ? 0 : monthTag === "m1" ? -8000 : -15000;
    return [
      { desc: "Mercado", category: "Alimentação", account: bank, amountCents: 65000 + bump, day: 3, by: ownerId },
      { desc: "Mercado (semana 2)", category: "Alimentação", account: card1, amountCents: 52000 + bump, day: 18, by: memberId },
      { desc: "Restaurante", category: "Alimentação", account: card2, amountCents: 8000, day: 12, by: ownerId },
      { desc: "Uber", category: "Transporte", account: bank, amountCents: 4500, day: 6, by: memberId },
      { desc: "Combustível", category: "Transporte", account: card1, amountCents: 15000, day: 18, by: memberId },
      { desc: "Aluguel", category: "Moradia", account: bank, amountCents: 180000, day: 10, by: ownerId },
      { desc: "Condomínio", category: "Moradia", account: bank, amountCents: 65000, day: 10, by: ownerId },
      { desc: "Presente", category: "Lazer", account: card2, amountCents: 15000, day: 8, by: ownerId },
      { desc: "Cinema", category: "Lazer", account: card2, amountCents: 8000, day: 20, by: memberId },
      { desc: "Farmácia", category: "Saúde", account: bank, amountCents: 4000, day: 15, by: ownerId },
      { desc: "Curso online", category: "Educação", account: card1, amountCents: 12000, day: 9, by: memberId },
      { desc: "Ração Rex", category: "Pets", account: wallet, amountCents: 9000, day: 14, by: ownerId },
    ];
  }

  async function seedMonth(ref: { year: number; month: number }, tag: "m2" | "m1" | "m0") {
    const salaryDay = clampDayToMonth(5, ref.year, ref.month);
    await db.insert(transactions).values({
      householdId: hh.id,
      type: schema.TransactionType.INCOME,
      amountCents: 500000,
      description: "Salário",
      occurredOn: civilToISO({ year: ref.year, month: ref.month, day: salaryDay }),
      accountId: bank.id,
      createdBy: ownerId,
    });
    if (tag !== "m2") {
      await db.insert(transactions).values({
        householdId: hh.id,
        type: schema.TransactionType.INCOME,
        amountCents: 80000,
        description: "Freelance",
        occurredOn: civilToISO({ year: ref.year, month: ref.month, day: clampDayToMonth(20, ref.year, ref.month) }),
        accountId: bank.id,
        createdBy: memberId,
      });
    }

    const templates = monthTemplates(tag);
    await db.insert(transactions).values(
      templates.map((t) => ({
        householdId: hh.id,
        type: schema.TransactionType.EXPENSE,
        amountCents: t.amountCents,
        description: t.desc,
        occurredOn: civilToISO({ year: ref.year, month: ref.month, day: clampDayToMonth(t.day, ref.year, ref.month) }),
        accountId: t.account.id,
        categoryId: cat[t.category],
        createdBy: t.by,
      }))
    );
  }

  await seedMonth(m2, "m2");
  await seedMonth(m1, "m1");
  await seedMonth(m0, "m0");

  // Eletronicos: uma compra avulsa no cartao (sem orcamento definido)
  await db.insert(transactions).values({
    householdId: hh.id,
    type: schema.TransactionType.EXPENSE,
    amountCents: 25000,
    description: "Fone de ouvido",
    occurredOn: civilToISO({ ...m0, day: clampDayToMonth(25, m0.year, m0.month) }),
    accountId: card1.id,
    categoryId: cat["Eletrônicos"],
    createdBy: ownerId,
  });

  // ---- pagamento de fatura anterior (transferencia conta -> cartao) -----
  // Marca a fatura CUJO VENCIMENTO cai em M-1 como "paga" na tela de Faturas
  // (mesma funcao que a tela usa para achar a fatura por mes — resolver por
  // "data de compra no meio do mes" e ambiguo quando closingDay < 15).
  for (const card of [
    { id: card1.id, name: card1.name, closingDay: card1.closingDay!, dueDay: card1.dueDay! },
    { id: card2.id, name: card2.name, closingDay: card2.closingDay!, dueDay: card2.dueDay! },
  ]) {
    const refM1 = invoiceRefForMonth(card, m1);
    await db.insert(transactions).values({
      householdId: hh.id,
      type: schema.TransactionType.TRANSFER,
      amountCents: 50000,
      description: "Pagamento de fatura",
      occurredOn: civilToISO(refM1.dueDate),
      accountId: bank.id,
      transferToAccountId: card.id,
      createdBy: ownerId,
    });
  }

  // ---- parcelamento novo: TV 4500 em 12x no Nubank credito ---------------
  {
    const firstInvoice = unwrap(resolveInvoiceForPurchase(card1Cycle, today), "tv invoice");
    const plan = unwrap(
      generateInstallmentPlan({
        totalCents: 450000,
        count: 12,
        card: card1Cycle,
        firstInvoice,
      }),
      "tv plan"
    );
    const [purchase] = await db
      .insert(installmentPurchases)
      .values({
        householdId: hh.id,
        accountId: card1.id,
        categoryId: cat["Eletrônicos"],
        description: "TV",
        totalAmountCents: 450000,
        totalInstallments: 12,
        currentInstallment: 1,
        createdBy: ownerId,
      })
      .returning();
    await db.insert(transactions).values(
      plan.map((p, i) => ({
        householdId: hh.id,
        type: schema.TransactionType.EXPENSE,
        amountCents: p.amountCents,
        description: `TV (${p.installmentNumber}/12)`,
        occurredOn:
          i === 0 ? civilToISO(today) : civilToISO(invoicePeriod(card1Cycle, p.invoice).start),
        accountId: card1.id,
        categoryId: cat["Eletrônicos"],
        createdBy: ownerId,
        installmentPurchaseId: purchase.id,
        installmentNumber: p.installmentNumber,
      }))
    );
  }

  // ---- parcelamento em andamento: Sofa 3000 em 10x, pagou 6, no Itau -----
  {
    const nextInvoice = unwrap(resolveInvoiceForPurchase(card2Cycle, today), "sofa invoice");
    const plan = unwrap(
      generateRemainingInstallments({
        totalCents: 300000,
        count: 10,
        alreadyPaid: 6,
        card: card2Cycle,
        nextInvoice,
      }),
      "sofa plan"
    );
    const [purchase] = await db
      .insert(installmentPurchases)
      .values({
        householdId: hh.id,
        accountId: card2.id,
        categoryId: cat["Moradia"],
        description: "Sofá",
        totalAmountCents: 300000,
        totalInstallments: 10,
        currentInstallment: 7,
        createdBy: memberId,
      })
      .returning();
    await db.insert(transactions).values(
      plan.map((p, i) => ({
        householdId: hh.id,
        type: schema.TransactionType.EXPENSE,
        amountCents: p.amountCents,
        description: `Sofá (${p.installmentNumber}/10)`,
        occurredOn:
          i === 0 ? civilToISO(today) : civilToISO(invoicePeriod(card2Cycle, p.invoice).start),
        accountId: card2.id,
        categoryId: cat["Moradia"],
        createdBy: memberId,
        installmentPurchaseId: purchase.id,
        installmentNumber: p.installmentNumber,
      }))
    );
  }

  // ---- recorrencias ---------------------------------------------------
  const [netflixRule, academiaRule] = await db
    .insert(recurringRules)
    .values([
      {
        householdId: hh.id,
        accountId: bank.id,
        categoryId: cat["Lazer"],
        type: RecurringType.EXPENSE,
        description: "Netflix",
        amountCents: 5500,
        dayOfMonth: 7,
        createdBy: ownerId,
      },
      {
        householdId: hh.id,
        accountId: bank.id,
        categoryId: cat["Saúde"],
        type: RecurringType.EXPENSE,
        description: "Academia",
        amountCents: 12000,
        dayOfMonth: 15,
        createdBy: memberId,
      },
    ])
    .returning();

  // Ja lancadas em M-2 e M-1 (nao em M0 — aparecem como compromisso pendente).
  for (const ref of [m2, m1]) {
    await db.insert(transactions).values([
      {
        householdId: hh.id,
        type: schema.TransactionType.EXPENSE,
        amountCents: netflixRule.amountCents,
        description: "Netflix",
        occurredOn: civilToISO({ ...ref, day: clampDayToMonth(7, ref.year, ref.month) }),
        accountId: bank.id,
        categoryId: cat["Lazer"],
        createdBy: ownerId,
        recurringRuleId: netflixRule.id,
      },
      {
        householdId: hh.id,
        type: schema.TransactionType.EXPENSE,
        amountCents: academiaRule.amountCents,
        description: "Academia",
        occurredOn: civilToISO({ ...ref, day: clampDayToMonth(15, ref.year, ref.month) }),
        accountId: bank.id,
        categoryId: cat["Saúde"],
        createdBy: memberId,
        recurringRuleId: academiaRule.id,
      },
    ]);
  }

  // ---- contas a pagar: paga (historico) + pendente + vencida ------------
  const [luz, internet, agua] = await db
    .insert(bills)
    .values([
      {
        householdId: hh.id,
        accountId: bank.id,
        categoryId: cat["Moradia"],
        name: "Conta de Luz",
        expectedDueDay: 10,
        createdBy: ownerId,
      },
      {
        householdId: hh.id,
        accountId: bank.id,
        categoryId: cat["Moradia"],
        name: "Internet",
        expectedDueDay: 7,
        isFixedAmount: true,
        fixedAmountCents: 9990,
        createdBy: ownerId,
      },
      {
        householdId: hh.id,
        accountId: bank.id,
        categoryId: cat["Moradia"],
        name: "Conta de Água",
        expectedDueDay: 20,
        createdBy: memberId,
      },
    ])
    .returning();

  const luzDueM1 = unwrap(billInstanceDueDate({ expectedDueDay: 10, year: m1.year, month: m1.month }), "luz m1");
  const internetDueM1 = unwrap(billInstanceDueDate({ expectedDueDay: 7, year: m1.year, month: m1.month }), "internet m1");
  const aguaDueM1 = unwrap(billInstanceDueDate({ expectedDueDay: 20, year: m1.year, month: m1.month }), "agua m1");

  const dueToday = today;
  const dueTomorrow = addDaysCivil(today, 1);
  const due5DaysAgo = addDaysCivil(today, -5);

  await db.insert(billInstances).values([
    // historico do mes passado — todas pagas
    { billId: luz.id, householdId: hh.id, dueDate: civilToISO(luzDueM1), status: schema.BillInstanceStatus.PAID, amountCents: 14500, paidAt: new Date() },
    { billId: internet.id, householdId: hh.id, dueDate: civilToISO(internetDueM1), status: schema.BillInstanceStatus.PAID, amountCents: 9990, paidAt: new Date() },
    { billId: agua.id, householdId: hh.id, dueDate: civilToISO(aguaDueM1), status: schema.BillInstanceStatus.PAID, amountCents: 16000, paidAt: new Date() },
    // mes corrente — vence hoje, vence amanha, vencida
    {
      billId: luz.id,
      householdId: hh.id,
      dueDate: civilToISO(dueToday),
      status: resolveBillStatus({ dueDate: dueToday, today, isPaid: false }),
      amountCents: null,
    },
    {
      billId: internet.id,
      householdId: hh.id,
      dueDate: civilToISO(dueTomorrow),
      status: resolveBillStatus({ dueDate: dueTomorrow, today, isPaid: false }),
      amountCents: null,
    },
    {
      billId: agua.id,
      householdId: hh.id,
      dueDate: civilToISO(due5DaysAgo),
      status: resolveBillStatus({ dueDate: due5DaysAgo, today, isPaid: false }),
      amountCents: null,
    },
  ]);

  console.log("\nSeed concluído:");
  console.log("- 4 contas (2 bancárias/carteira, 2 cartões)");
  console.log("- 8 categorias, 4 com orçamento definido");
  console.log("- transações em 3 meses (M-2, M-1, mês atual)");
  console.log("- 2 parcelamentos: TV (novo, 12x) e Sofá (em andamento, 4 de 10 restantes)");
  console.log("- 2 recorrências: Netflix e Academia (lançadas em M-2/M-1, pendentes no mês atual)");
  console.log("- 3 contas a pagar: Luz (vence hoje), Internet (vence amanhã, valor fixo), Água (vencida)");
  console.log("- faturas de M-1 pagas via transferência; fatura atual com lançamentos reais");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
