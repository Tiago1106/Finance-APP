import { z } from "zod";

/**
 * Contrato da IA de extracao (CLAUDE.md secao 9): a IA retorna APENAS JSON
 * neste schema. Valores monetarios sao strings em reais, exatamente como o
 * usuario escreveu ("230", "1.500,50") — a conversao para centavos e feita
 * pelo servidor com parseBRLToCents. A IA nunca faz aritmetica.
 *
 * Sem constraints numericos (min/max) aqui: structured outputs da API nao
 * suporta; ranges sao validados nos executores.
 */

const amount = z.string();
const nullableString = z.string().nullable();

export const QueryKind = {
  CATEGORY_TOTAL: "category_total",
  MONTH_TOTAL: "month_total",
  BUDGET_STATUS: "budget_status",
  CARD_INVOICE: "card_invoice",
  PENDING_PAYMENTS: "pending_payments",
} as const;
export type QueryKind = (typeof QueryKind)[keyof typeof QueryKind];

export const IntentSchema = z.discriminatedUnion("intent", [
  z.strictObject({
    intent: z.literal("add_expense"),
    amount,
    description: z.string(),
    account_name: nullableString,
    category_name: nullableString,
    /** "2026-07-05" apenas quando o usuario disser a data ("ontem", "dia 3"). */
    date: nullableString,
  }),
  z.strictObject({
    intent: z.literal("add_income"),
    amount,
    description: z.string(),
    account_name: nullableString,
    category_name: nullableString,
    date: nullableString,
  }),
  z.strictObject({
    intent: z.literal("add_installment"),
    description: z.string(),
    total_amount: amount,
    installments: z.int(),
    /** "paguei 6" → 6. Null para compra nova. */
    already_paid: z.int().nullable(),
    account_name: nullableString,
    category_name: nullableString,
  }),
  z.strictObject({
    intent: z.literal("add_recurring"),
    description: z.string(),
    amount,
    /** Dia do mes; null = usar o dia de hoje. */
    day_of_month: z.int().nullable(),
    type: z.enum(["expense", "income"]),
    account_name: nullableString,
    category_name: nullableString,
  }),
  z.strictObject({
    intent: z.literal("create_category"),
    name: z.string(),
    /** Valor em reais, string igual aos outros campos monetarios. Null = sem orcamento. */
    monthly_budget: nullableString,
  }),
  z.strictObject({
    intent: z.literal("add_bill"),
    name: z.string(),
    expected_due_day: z.int(),
    account_name: nullableString,
  }),
  z.strictObject({
    intent: z.literal("pay_bill"),
    bill_name: z.string(),
    amount,
  }),
  z.strictObject({
    intent: z.literal("query"),
    kind: z.enum([
      QueryKind.CATEGORY_TOTAL,
      QueryKind.MONTH_TOTAL,
      QueryKind.BUDGET_STATUS,
      QueryKind.CARD_INVOICE,
      QueryKind.PENDING_PAYMENTS,
    ]),
    category_name: nullableString,
    account_name: nullableString,
  }),
  z.strictObject({
    intent: z.literal("edit"),
    /** v1: apenas correcao de valor do ultimo lancamento ("o ultimo foi 250"). */
    new_amount: amount,
  }),
  z.strictObject({
    intent: z.literal("delete"),
  }),
  z.strictObject({
    intent: z.literal("unknown"),
  }),
]);

export type Intent = z.infer<typeof IntentSchema>;

/**
 * Adapta o JSON Schema do Zod ao subconjunto aceito pelo structured outputs:
 * - remove minimum/maximum (z.int() emite bounds de safe-integer);
 * - troca oneOf por anyOf (a API nao suporta oneOf; para uniao discriminada
 *   por literal os dois sao equivalentes).
 * Ranges sao validados nos executores do bot, nao no schema da IA.
 */
function sanitizeForStructuredOutputs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeForStructuredOutputs);
  if (typeof node === "object" && node !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "minimum" || key === "maximum") continue;
      const newKey = key === "oneOf" ? "anyOf" : key;
      out[newKey] = sanitizeForStructuredOutputs(value);
    }
    return out;
  }
  return node;
}

/** JSON Schema para structured outputs da API. */
export function intentJsonSchema(): Record<string, unknown> {
  return sanitizeForStructuredOutputs(z.toJSONSchema(IntentSchema)) as Record<string, unknown>;
}
