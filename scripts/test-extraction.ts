/**
 * Smoke test manual da extracao (chama a API real da Anthropic).
 * Uso: npx tsx scripts/test-extraction.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { extractIntent } from "../src/lib/ai/extract";
import type { ExtractionContext } from "../src/lib/ai/prompt";

const ctx: ExtractionContext = {
  today: { year: 2026, month: 7, day: 7 },
  categories: ["Alimentação", "Transporte", "Moradia"],
  accounts: [
    { name: "Nubank débito", isCreditCard: false },
    { name: "Nubank crédito", isCreditCard: true },
    { name: "Itaú crédito", isCreditCard: true },
  ],
  bills: ["Conta de Luz"],
};

const phrases = [
  "mercado 230 no nubank crédito",
  "tv 4500 em 12x no itaú",
  "sofá 3000 em 10x, paguei 6",
  "netflix 55 todo mês",
  "cadastra conta de água, vence dia 10",
  "luz 187",
  "quanto gastei com mercado?",
  "o que falta pagar esse mês?",
  "apaga o último",
  "bom dia, tudo bem?",
];

async function main() {
  for (const phrase of phrases) {
    const result = await extractIntent(phrase, ctx);
    if (result.ok) {
      console.log(`OK "${phrase}"\n  -> ${JSON.stringify(result.data)}\n`);
    } else {
      console.log(`ERRO "${phrase}"\n  -> ${result.error.code}: ${result.error.message}\n`);
    }
  }
}

main();
