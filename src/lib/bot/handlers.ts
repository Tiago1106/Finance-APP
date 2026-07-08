import { and, eq, gt, isNull } from "drizzle-orm";
import type { Context } from "grammy";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { extractIntent } from "@/lib/ai/extract";
import { loadHouseholdContext, resolveBotUser } from "./context";
import {
  dispatchIntent,
  finalizeBill,
  finalizeInstallment,
  finalizeRecurring,
  finalizeSimpleTransaction,
} from "./intents";
import { deletePendingAction, loadPendingAction } from "./pending";
import { ACCESS_RESTRICTED, AI_UNAVAILABLE, REFORMULATE } from "./replies";
import { categories } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// /start [codigo] — vinculo do Telegram (ESCOPO 3.3)
// ---------------------------------------------------------------------------

export async function handleStart(ctx: Context): Promise<void> {
  const telegramUserId = String(ctx.from?.id ?? "");
  if (!telegramUserId) return;

  const code = (ctx.match?.toString() ?? "").trim().toUpperCase();

  if (!code) {
    const existing = await resolveBotUser(telegramUserId);
    if (existing) {
      await ctx.reply(
        `👋 Olá${existing.name ? `, ${existing.name}` : ""}! Seu Telegram já está vinculado. ` +
          `Pode mandar seus gastos: "mercado 230 no nubank".`
      );
    } else {
      await ctx.reply(ACCESS_RESTRICTED);
    }
    return;
  }

  const [candidate] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      and(
        eq(users.telegramLinkCode, code),
        gt(users.telegramLinkCodeExpiresAt, new Date()),
        isNull(users.telegramUserId)
      )
    )
    .limit(1);

  if (!candidate) {
    await ctx.reply(
      "❌ Código inválido ou expirado. Gere um novo no app (Perfil → Vincular Telegram)."
    );
    return;
  }

  await db
    .update(users)
    .set({
      telegramUserId,
      telegramLinkCode: null,
      telegramLinkCodeExpiresAt: null,
    })
    .where(eq(users.id, candidate.id));

  await ctx.reply(
    `✅ Telegram vinculado${candidate.name ? `, ${candidate.name}` : ""}! ` +
      `A partir de agora é só mandar seus gastos por aqui. Ex: "mercado 230 no nubank".`
  );
}

// ---------------------------------------------------------------------------
// Mensagens de texto — orquestrador principal
// ---------------------------------------------------------------------------

export async function handleTextMessage(ctx: Context): Promise<void> {
  const telegramUserId = String(ctx.from?.id ?? "");
  const text = ctx.message?.text;
  if (!telegramUserId || !text) return;

  const user = await resolveBotUser(telegramUserId);
  if (!user) {
    await ctx.reply(ACCESS_RESTRICTED);
    return;
  }

  const hctx = await loadHouseholdContext(user.householdId);
  const result = await extractIntent(text, hctx.forPrompt);

  if (!result.ok) {
    await ctx.reply(result.error.code === "ai/api_error" ? AI_UNAVAILABLE : REFORMULATE);
    return;
  }

  await dispatchIntent(ctx, user, hctx, result.data);
}

// ---------------------------------------------------------------------------
// Callbacks dos botoes inline (pa:<pendingActionId>:<opcao>)
// ---------------------------------------------------------------------------

export async function handleCallback(ctx: Context): Promise<void> {
  const telegramUserId = String(ctx.from?.id ?? "");
  const data = ctx.callbackQuery?.data ?? "";
  const match = data.match(/^pa:([0-9a-f-]{36}):(.+)$/);
  if (!telegramUserId || !match) {
    await ctx.answerCallbackQuery();
    return;
  }
  const [, pendingId, choice] = match;

  const user = await resolveBotUser(telegramUserId);
  if (!user) {
    await ctx.answerCallbackQuery({ text: "Acesso restrito." });
    return;
  }

  const pending = await loadPendingAction(pendingId, telegramUserId);
  if (!pending) {
    await ctx.answerCallbackQuery({ text: "Essa escolha expirou. Manda a mensagem de novo." });
    await ctx.editMessageText("⏳ Escolha expirada — manda a mensagem de novo.").catch(() => {});
    return;
  }

  const hctx = await loadHouseholdContext(user.householdId);
  const payload = pending.payload;

  // Apos responder, o resultado substitui a pergunta. Se a resposta for uma
  // NOVA pergunta com botoes (ex: conta escolhida → falta categoria), o
  // teclado e repassado no proprio edit.
  const replyViaEdit = {
    reply: async (
      replyText: string,
      options?: { reply_markup?: import("grammy").InlineKeyboard }
    ) => {
      await ctx
        .editMessageText(replyText, { reply_markup: options?.reply_markup })
        .catch(() => ctx.reply(replyText, { reply_markup: options?.reply_markup }));
    },
  };

  await ctx.answerCallbackQuery();

  if (pending.kind === "choose_account") {
    const idx = Number(choice);
    const optionIds = payload.accountOptionIds ?? [];
    const accountId = optionIds[idx];
    const account = hctx.accounts.find((a) => a.id === accountId);
    if (!account) {
      await replyViaEdit.reply("Conta não encontrada. Manda a mensagem de novo.");
      await deletePendingAction(pendingId);
      return;
    }
    await deletePendingAction(pendingId);

    switch (payload.flow) {
      case "expense":
      case "income":
        return finalizeSimpleTransaction(
          replyViaEdit,
          user,
          hctx,
          {
            flow: payload.flow,
            amountCents: payload.amountCents,
            description: payload.description,
            categoryName: payload.categoryName,
            dateISO: payload.dateISO,
          },
          account
        );
      case "installment":
        return finalizeInstallment(
          replyViaEdit,
          user,
          hctx,
          {
            flow: "installment",
            totalCents: payload.totalCents,
            count: payload.count,
            alreadyPaid: payload.alreadyPaid,
            description: payload.description,
            categoryName: payload.categoryName,
          },
          account
        );
      case "recurring":
        return finalizeRecurring(
          replyViaEdit,
          user,
          hctx,
          {
            flow: "recurring",
            amountCents: payload.amountCents,
            description: payload.description,
            dayOfMonth: payload.dayOfMonth,
            type: payload.type,
            categoryName: payload.categoryName,
          },
          account
        );
      case "bill":
        return finalizeBill(
          replyViaEdit,
          user,
          hctx,
          { flow: "bill", name: payload.name, expectedDueDay: payload.expectedDueDay },
          account
        );
    }
  }

  if (
    pending.kind === "confirm_category" &&
    (payload.flow === "expense" || payload.flow === "installment")
  ) {
    const account = hctx.accounts.find((a) => a.id === payload.accountId);
    if (!account) {
      await replyViaEdit.reply("Conta não encontrada. Manda a mensagem de novo.");
      await deletePendingAction(pendingId);
      return;
    }
    await deletePendingAction(pendingId);

    let categoryChoice: { id: string | null; name: string | null };
    if (choice === "create" && payload.categoryName) {
      const [created] = await db
        .insert(categories)
        .values({ householdId: user.householdId, name: payload.categoryName })
        .onConflictDoNothing()
        .returning({ id: categories.id, name: categories.name });
      if (created) {
        categoryChoice = created;
      } else {
        // ja existia (corrida) — usa a existente
        const [existing] = await db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(
            and(
              eq(categories.householdId, user.householdId),
              eq(categories.name, payload.categoryName)
            )
          )
          .limit(1);
        categoryChoice = existing ?? { id: null, name: null };
      }
    } else if (choice === "none" || choice === "create") {
      categoryChoice = { id: null, name: null };
    } else {
      const idx = Number(choice.replace(/^c/, ""));
      const catId = (payload.categoryOptionIds ?? [])[idx];
      const cat = hctx.categories.find((c) => c.id === catId);
      categoryChoice = cat ?? { id: null, name: null };
    }

    if (payload.flow === "installment") {
      return finalizeInstallment(
        replyViaEdit,
        user,
        hctx,
        {
          flow: "installment",
          totalCents: payload.totalCents,
          count: payload.count,
          alreadyPaid: payload.alreadyPaid,
          description: payload.description,
          categoryName: payload.categoryName,
        },
        account,
        categoryChoice
      );
    }

    return finalizeSimpleTransaction(
      replyViaEdit,
      user,
      hctx,
      {
        flow: "expense",
        amountCents: payload.amountCents,
        description: payload.description,
        categoryName: payload.categoryName,
        dateISO: payload.dateISO,
      },
      account,
      categoryChoice
    );
  }

  await replyViaEdit.reply("Não consegui processar essa escolha. Manda a mensagem de novo.");
  await deletePendingAction(pendingId);
}
