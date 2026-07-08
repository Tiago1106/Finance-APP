import { webhookCallback } from "grammy";
import { getBot } from "@/lib/bot/bot";

export const dynamic = "force-dynamic";

/**
 * Webhook do Telegram. O grammY valida o header
 * X-Telegram-Bot-Api-Secret-Token contra TELEGRAM_WEBHOOK_SECRET
 * (CLAUDE.md secao 10) e responde 401 quando nao bater.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return new Response("webhook nao configurado", { status: 500 });
  }
  const handler = webhookCallback(getBot(), "std/http", { secretToken: secret });
  try {
    return await handler(request);
  } catch (e) {
    console.error("[telegram webhook]", e);
    // 200 evita re-entrega em loop pelo Telegram para erros de aplicacao.
    return new Response("ok", { status: 200 });
  }
}
