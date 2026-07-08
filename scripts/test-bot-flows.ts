/**
 * Teste de integracao headless dos fluxos do bot (Fase 5).
 * - Updates falsos do Telegram via bot.handleUpdate()
 * - Chamadas de SAIDA (sendMessage etc.) interceptadas por transformer
 * - Extracao usa a API real da Anthropic; banco real (household de teste)
 *
 * Uso: npx tsx scripts/test-bot-flows.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq, sql as dsql } from "drizzle-orm";

const TG_ID = 999000111;
let updateId = 1;
let failures = 0;

type Sent = { method: string; payload: Record<string, unknown> };
const sent: Sent[] = [];

function lastText(): string {
  const outs = sent.filter((s) => s.method === "sendMessage" || s.method === "editMessageText");
  const last = outs[outs.length - 1];
  return String(last?.payload?.text ?? "");
}

function lastKeyboardData(): string[] {
  const outs = sent.filter(
    (s) => s.method === "sendMessage" || s.method === "editMessageText"
  );
  const last = outs[outs.length - 1];
  const markup = last?.payload?.reply_markup as
    | { inline_keyboard?: { callback_data: string }[][] }
    | undefined;
  return (markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
}

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  OK  ${label}`);
  } else {
    failures++;
    console.log(`  FALHOU  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function messageUpdate(text: string, fromId = TG_ID) {
  // Comandos precisam da entity bot_command (clientes reais sempre enviam).
  const entities = text.startsWith("/")
    ? [{ offset: 0, length: text.split(" ")[0].length, type: "bot_command" as const }]
    : undefined;
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: fromId, type: "private" as const, first_name: "Teste" },
      from: { id: fromId, is_bot: false, first_name: "Teste" },
      text,
      ...(entities ? { entities } : {}),
    },
  };
}

function callbackUpdate(data: string, fromId = TG_ID) {
  return {
    update_id: updateId++,
    callback_query: {
      id: String(updateId),
      from: { id: fromId, is_bot: false, first_name: "Teste" },
      chat_instance: "ci",
      data,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: fromId, type: "private" as const, first_name: "Teste" },
        text: "pergunta",
      },
    },
  };
}

async function main() {
  const { db } = await import("../src/lib/db");
  const schema = await import("../src/lib/db/schema");
  const { getBot } = await import("../src/lib/bot/bot");

  // ---- setup: household de teste + contas -------------------------------
  const [hh] = await db
    .select()
    .from(schema.households)
    .where(eq(schema.households.name, "Família de Teste Dono"))
    .limit(1);
  if (!hh) throw new Error("Household de teste nao encontrado (crie via Fase 2).");

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

  // Vinculo real do dono (se houver) e preservado e restaurado no final.
  const [ownerBefore] = await db
    .select({ tg: schema.users.telegramUserId })
    .from(schema.users)
    .where(eq(schema.users.id, owner.userId));
  const originalTelegramId = ownerBefore.tg;

  // Limpeza PREVIA: o household de teste pode ter sobras de testes manuais.
  async function wipeHouseholdData() {
    await db.delete(schema.transactions).where(eq(schema.transactions.householdId, hh.id));
    await db.delete(schema.installmentPurchases).where(eq(schema.installmentPurchases.householdId, hh.id));
    await db.delete(schema.billInstances).where(eq(schema.billInstances.householdId, hh.id));
    await db.delete(schema.bills).where(eq(schema.bills.householdId, hh.id));
    await db.delete(schema.recurringRules).where(eq(schema.recurringRules.householdId, hh.id));
    await db.delete(schema.budgets).where(eq(schema.budgets.householdId, hh.id));
    await db.delete(schema.categories).where(eq(schema.categories.householdId, hh.id));
    await db.delete(schema.accounts).where(eq(schema.accounts.householdId, hh.id));
  }
  await wipeHouseholdData();

  await db
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
    })
    .returning();

  const bot = getBot();
  // Intercepta TODA chamada de saida a API do Telegram.
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload: payload as Record<string, unknown> });
    if (method === "getMe") {
      return {
        ok: true as const,
        result: {
          id: 42,
          is_bot: true,
          first_name: "TestBot",
          username: "finance_test_bot",
          can_join_groups: false,
          can_read_all_group_messages: false,
          supports_inline_queries: false,
          can_connect_to_business: false,
          has_main_web_app: false,
        },
      } as never;
    }
    return {
      ok: true as const,
      result: {
        message_id: 1,
        date: 0,
        chat: { id: TG_ID, type: "private" },
        text: "stub",
      },
    } as never;
  });

  await bot.init();

  console.log("\n1) Nao vinculado → acesso restrito");
  await bot.handleUpdate(messageUpdate("mercado 100"));
  check("responde acesso restrito", lastText().includes("Acesso restrito"));

  console.log("\n2) /start com codigo vincula");
  await db
    .update(schema.users)
    .set({
      telegramLinkCode: "TESTLINK",
      telegramLinkCodeExpiresAt: new Date(Date.now() + 3600_000),
      telegramUserId: null,
    })
    .where(eq(schema.users.id, owner.userId));
  await bot.handleUpdate(messageUpdate("/start TESTLINK"));
  check("confirma vinculo", lastText().includes("vinculado"));
  const [linked] = await db
    .select({ tg: schema.users.telegramUserId })
    .from(schema.users)
    .where(eq(schema.users.id, owner.userId));
  check("telegram_user_id gravado", linked.tg === String(TG_ID));

  console.log("\n3) Gasto simples com conta e categoria nova → botoes de categoria");
  await bot.handleUpdate(messageUpdate("mercado 230 no nubank débito"));
  const catButtons = lastKeyboardData();
  check(
    "perguntou categoria com botoes",
    lastText().includes("categoria") && catButtons.some((d) => d.endsWith(":create")),
    lastText()
  );
  const createBtn = catButtons.find((d) => d.endsWith(":create"))!;
  await bot.handleUpdate(callbackUpdate(createBtn));
  check("confirmacao com valor e conta", lastText().includes("R$") && lastText().includes("Nubank débito"), lastText());
  const [txCount1] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(schema.transactions)
    .where(eq(schema.transactions.householdId, hh.id));
  check("1 transacao no banco", txCount1.n === 1, String(txCount1.n));

  // Responde a pergunta de categoria (se feita): prefere "Criar", senao "Sem categoria".
  async function answerCategoryIfAsked() {
    const btns = lastKeyboardData();
    if (btns.length === 0 || !lastText().toLowerCase().includes("categoria")) return false;
    const pick = btns.find((d) => d.endsWith(":create")) ?? btns.find((d) => d.endsWith(":none"));
    if (!pick) return false;
    await bot.handleUpdate(callbackUpdate(pick));
    return true;
  }

  console.log("\n4) Parcelamento novo no cartao (pergunta categoria)");
  await bot.handleUpdate(messageUpdate("tv 4500 em 12x no nubank crédito"));
  const askedCat4 = await answerCategoryIfAsked();
  check("perguntou categoria do parcelamento", askedCat4, lastText());
  check("confirmacao 12x", lastText().includes("12x"), lastText());
  const installments1 = await db
    .select({ amount: schema.transactions.amountCents })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.householdId, hh.id),
        eq(schema.transactions.accountId, card.id)
      )
    );
  check("12 parcelas criadas", installments1.length === 12, String(installments1.length));
  const sum1 = installments1.reduce((a, b) => a + b.amount, 0);
  check("soma == 4500,00", sum1 === 450000, String(sum1));

  console.log("\n5) Parcelamento em andamento sem conta → botoes de cartao");
  await bot.handleUpdate(messageUpdate("sofá 3000 em 10x, paguei 6"));
  const cardButtons = lastKeyboardData();
  check("perguntou cartao", cardButtons.length > 0, lastText());
  await bot.handleUpdate(callbackUpdate(cardButtons[0]));
  await answerCategoryIfAsked();
  check("confirma 4 restantes", lastText().includes("4 parcelas restantes"), lastText());
  const sofa = await db
    .select({ n: schema.transactions.installmentNumber })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.householdId, hh.id),
        dsql`${schema.transactions.description} like 'sof%'`
      )
    );
  check(
    "parcelas numeradas 7-10",
    sofa.length === 4 && sofa.every((s) => (s.n ?? 0) >= 7 && (s.n ?? 0) <= 10),
    JSON.stringify(sofa.map((s) => s.n))
  );

  console.log("\n6) Conta de luz: cadastrar (botoes de conta) e pagar");
  await bot.handleUpdate(messageUpdate("cadastra conta de luz, vence dia 10"));
  const billButtons = lastKeyboardData();
  check("perguntou conta pagadora", billButtons.length > 0, lastText());
  const bankBtnIdx = billButtons.findIndex((d) => d.endsWith(":0"));
  await bot.handleUpdate(callbackUpdate(billButtons[bankBtnIdx >= 0 ? bankBtnIdx : 0]));
  check("bill cadastrada", lastText().includes("cadastrada"), lastText());

  await bot.handleUpdate(messageUpdate("luz 187"));
  check("pendencia paga", lastText().toLowerCase().includes("paga"), lastText());
  const [paidInstance] = await db
    .select()
    .from(schema.billInstances)
    .where(
      and(
        eq(schema.billInstances.householdId, hh.id),
        eq(schema.billInstances.status, "paid")
      )
    );
  check("bill_instance paid com valor 187,00", paidInstance?.amountCents === 18700);

  console.log("\n7) Consulta: o que falta pagar");
  await bot.handleUpdate(messageUpdate("o que falta pagar esse mês?"));
  check("lista fatura do cartao", lastText().includes("Fatura Nubank crédito"), lastText());

  console.log("\n8) Apagar o ultimo (so do autor)");
  const [beforeDel] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(schema.transactions)
    .where(eq(schema.transactions.householdId, hh.id));
  await bot.handleUpdate(messageUpdate("apaga o último"));
  check("confirmou remocao", lastText().includes("Removido"), lastText());
  const [afterDel] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(schema.transactions)
    .where(eq(schema.transactions.householdId, hh.id));
  check("uma transacao a menos", afterDel.n === beforeDel.n - 1, `${beforeDel.n} -> ${afterDel.n}`);

  // ---- cleanup -----------------------------------------------------------
  console.log("\nLimpando dados de teste...");
  await wipeHouseholdData();
  await db.delete(schema.botPendingActions).where(eq(schema.botPendingActions.telegramUserId, String(TG_ID)));
  // Restaura o vinculo original do dono (se ele tinha o Telegram vinculado).
  await db
    .update(schema.users)
    .set({
      telegramUserId: originalTelegramId,
      telegramLinkCode: null,
      telegramLinkCodeExpiresAt: null,
    })
    .where(eq(schema.users.id, owner.userId));

  console.log(failures === 0 ? "\n✅ TODOS OS FLUXOS PASSARAM" : `\n❌ ${failures} FALHAS`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
