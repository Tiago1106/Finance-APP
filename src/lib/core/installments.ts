import { addInvoiceCycles, type CardCycle, type InvoiceRef } from "./invoice";
import { err, ok, type Result } from "./result";

export type InstallmentError = {
  code:
    | "installments/invalid_total"
    | "installments/invalid_count"
    | "installments/invalid_paid";
  message: string;
};

export type PlannedInstallment = {
  /** 1-based, em relacao a compra original ("7 de 10"). */
  installmentNumber: number;
  amountCents: number;
  invoice: InvoiceRef;
};

/**
 * Divide o total em N parcelas iguais em centavos; a diferenca da divisao
 * nao exata vai TODA na primeira parcela (ESCOPO 6.2).
 * Ex: 1000 / 3 → [334, 333, 333].
 */
export function splitInstallments(
  totalCents: number,
  count: number
): Result<number[], InstallmentError> {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    return err({
      code: "installments/invalid_total",
      message: "O valor total deve ser positivo (em centavos).",
    });
  }
  if (!Number.isInteger(count) || count < 1) {
    return err({
      code: "installments/invalid_count",
      message: "O numero de parcelas deve ser pelo menos 1.",
    });
  }

  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  const amounts = new Array<number>(count).fill(base);
  amounts[0] += remainder;
  return ok(amounts);
}

/**
 * Plano completo de uma compra parcelada NOVA: parcela i cai na i-esima
 * fatura consecutiva a partir da fatura da compra.
 */
export function generateInstallmentPlan(params: {
  totalCents: number;
  count: number;
  card: CardCycle;
  firstInvoice: InvoiceRef;
}): Result<PlannedInstallment[], InstallmentError> {
  const split = splitInstallments(params.totalCents, params.count);
  if (!split.ok) return split;

  return ok(
    split.data.map((amountCents, i) => ({
      installmentNumber: i + 1,
      amountCents,
      invoice: i === 0 ? params.firstInvoice : addInvoiceCycles(params.card, params.firstInvoice, i),
    }))
  );
}

/**
 * Compra parcelada EM ANDAMENTO ("sofa 3000 em 10x, paguei 6"): gera apenas
 * as parcelas restantes, numeradas a partir de alreadyPaid + 1, começando na
 * proxima fatura. Os valores vem da divisao do total ORIGINAL, entao a
 * parcela 7 de 10 vale o mesmo que valia no carnê original; as ja pagas nao
 * entram (sem historico retroativo na v1).
 */
export function generateRemainingInstallments(params: {
  totalCents: number;
  count: number;
  alreadyPaid: number;
  card: CardCycle;
  nextInvoice: InvoiceRef;
}): Result<PlannedInstallment[], InstallmentError> {
  if (!Number.isInteger(params.alreadyPaid) || params.alreadyPaid < 0) {
    return err({
      code: "installments/invalid_paid",
      message: "O numero de parcelas ja pagas nao pode ser negativo.",
    });
  }
  if (params.alreadyPaid >= params.count) {
    return err({
      code: "installments/invalid_paid",
      message: "As parcelas ja pagas devem ser menos que o total de parcelas.",
    });
  }

  const split = splitInstallments(params.totalCents, params.count);
  if (!split.ok) return split;

  const remaining = split.data.slice(params.alreadyPaid);
  return ok(
    remaining.map((amountCents, i) => ({
      installmentNumber: params.alreadyPaid + i + 1,
      amountCents,
      invoice:
        i === 0 ? params.nextInvoice : addInvoiceCycles(params.card, params.nextInvoice, i),
    }))
  );
}
