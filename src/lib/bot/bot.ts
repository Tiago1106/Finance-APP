import { Bot } from "grammy";
import { handleCallback, handleStart, handleTextMessage } from "./handlers";

let instance: Bot | null = null;

/**
 * Instancia unica do bot, compartilhada pelo webhook (producao) e pelo
 * long polling (scripts/bot-dev.ts). Handlers registrados uma vez.
 */
export function getBot(): Bot {
  if (instance) return instance;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN nao definido. Configure o .env.local.");
  }

  const bot = new Bot(token);

  bot.command("start", handleStart);
  bot.on("callback_query:data", handleCallback);
  bot.on("message:text", handleTextMessage);

  bot.catch((err) => {
    console.error("[bot] erro nao tratado:", err.error);
  });

  instance = bot;
  return bot;
}
