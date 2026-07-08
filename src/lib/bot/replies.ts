import { formatBRL } from "@/lib/format";
import { BudgetLevel, type BudgetProgress } from "@/lib/core/budget";
import type { CivilDate } from "@/lib/core/date";
import type { InvoiceRef } from "@/lib/core/invoice";

export const ACCESS_RESTRICTED =
  "🔒 Acesso restrito. Este assistente é de uso exclusivo da família. " +
  "Se você faz parte dela, vincule sua conta pelo app (Perfil → Vincular Telegram) " +
  "e envie /start SEU_CODIGO.";

export const REFORMULATE =
  "🤔 Não entendi. Tenta de novo? Exemplos:\n" +
  "• mercado 230 no nubank\n" +
  "• tv 4500 em 12x no itaú\n" +
  "• netflix 55 todo mês\n" +
  "• quanto gastei com mercado?";

export const AI_UNAVAILABLE =
  "⚠️ Tive um problema para interpretar agora. Tenta de novo em instantes.";

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export function monthName(month: number): string {
  return MONTHS[month - 1];
}

export function formatCivilShort(d: CivilDate): string {
  return `${String(d.day).padStart(2, "0")}/${String(d.month).padStart(2, "0")}`;
}

/** "fatura de agosto" — referencia = mes do vencimento (como os bancos). */
export function invoiceLabel(ref: InvoiceRef): string {
  return `fatura de ${monthName(ref.referenceMonth)}`;
}

/** Alerta de orcamento anexado a confirmacoes (ESCOPO 4.4). */
export function budgetAlert(categoryName: string, progress: BudgetProgress, limitCents: number, spentCents: number): string | null {
  if (progress.level === BudgetLevel.EXCEEDED) {
    return `🚨 ${categoryName} estourou o orçamento (${formatBRL(spentCents)} de ${formatBRL(limitCents)})`;
  }
  if (progress.level === BudgetLevel.WARNING) {
    return `⚠️ ${categoryName} em ${progress.percent}% do orçamento do mês`;
  }
  return null;
}

export { formatBRL };
