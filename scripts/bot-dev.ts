/**
 * Bot em modo long polling para desenvolvimento local — teste do celular
 * sem URL publica. Uso: npm run bot:dev
 *
 * Nao rode com um webhook configurado no Telegram (nesta fase nenhum foi
 * configurado; o webhook entra no deploy da Vercel).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { getBot } = await import("../src/lib/bot/bot");
  const bot = getBot();
  const me = await bot.api.getMe();
  console.log(`🤖 @${me.username} rodando em long polling. Ctrl+C para parar.`);
  await bot.start();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
