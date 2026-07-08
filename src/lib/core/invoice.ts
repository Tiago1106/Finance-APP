import {
  addDaysCivil,
  addMonthsCivil,
  clampDayToMonth,
  compareCivil,
  type CivilDate,
} from "./date";
import { err, ok, type Result } from "./result";

export type CardCycle = {
  /** Dia de fechamento configurado no cartao (1-31). */
  closingDay: number;
  /** Dia de vencimento configurado no cartao (1-31). */
  dueDay: number;
};

/**
 * Uma fatura concreta: quando fecha, quando vence e o mes de referencia.
 * Referencia = mes/ano do VENCIMENTO ("fatura de agosto" = a que vence em
 * agosto), como os bancos brasileiros exibem.
 */
export type InvoiceRef = {
  closingDate: CivilDate;
  dueDate: CivilDate;
  referenceMonth: number;
  referenceYear: number;
};

export type InvoiceError = {
  code: "invoice/invalid_day";
  message: string;
};

function validateCard(card: CardCycle): InvoiceError | null {
  const valid = (d: number) => Number.isInteger(d) && d >= 1 && d <= 31;
  if (!valid(card.closingDay) || !valid(card.dueDay)) {
    return {
      code: "invoice/invalid_day",
      message: "Dias de fechamento e vencimento devem estar entre 1 e 31.",
    };
  }
  return null;
}

/**
 * Fatura cujo fechamento cai no mes/ano informados.
 * Vencimento: no proprio mes do fechamento se dueDay > closingDay;
 * caso contrario, no mes seguinte. Dias clampados ao tamanho do mes.
 */
function invoiceClosingAt(card: CardCycle, year: number, month: number): InvoiceRef {
  const closingDate: CivilDate = {
    year,
    month,
    day: clampDayToMonth(card.closingDay, year, month),
  };

  const dueBase =
    card.dueDay > card.closingDay
      ? { year, month }
      : addMonthsCivil({ year, month, day: 1 }, 1);

  const dueDate: CivilDate = {
    year: dueBase.year,
    month: dueBase.month,
    day: clampDayToMonth(card.dueDay, dueBase.year, dueBase.month),
  };

  return {
    closingDate,
    dueDate,
    referenceMonth: dueDate.month,
    referenceYear: dueDate.year,
  };
}

/**
 * Em qual fatura cai uma compra (ESCOPO 6.1):
 * - compra ANTES do dia de fechamento → fatura que fecha neste mes;
 * - compra NO DIA do fechamento ou depois → fatura do mes seguinte.
 */
export function resolveInvoiceForPurchase(
  card: CardCycle,
  purchaseDate: CivilDate
): Result<InvoiceRef, InvoiceError> {
  const invalid = validateCard(card);
  if (invalid) return err(invalid);

  const closingThisMonth: CivilDate = {
    year: purchaseDate.year,
    month: purchaseDate.month,
    day: clampDayToMonth(card.closingDay, purchaseDate.year, purchaseDate.month),
  };

  if (compareCivil(purchaseDate, closingThisMonth) < 0) {
    return ok(invoiceClosingAt(card, purchaseDate.year, purchaseDate.month));
  }

  const next = addMonthsCivil({ ...purchaseDate, day: 1 }, 1);
  return ok(invoiceClosingAt(card, next.year, next.month));
}

/**
 * Projeta a n-esima fatura apos a informada (n >= 1), re-derivando os dias
 * a partir da configuracao do cartao (um fechamento clampado em fevereiro
 * nao "gruda" nos meses seguintes).
 */
export function addInvoiceCycles(card: CardCycle, ref: InvoiceRef, n: number): InvoiceRef {
  const base = addMonthsCivil({ ...ref.closingDate, day: 1 }, n);
  return invoiceClosingAt(card, base.year, base.month);
}

export type InvoicePeriod = {
  /** Primeiro dia de compra incluido na fatura (o dia do fechamento anterior). */
  start: CivilDate;
  /** Ultimo dia de compra incluido (vespera do fechamento). */
  end: CivilDate;
};

/**
 * Intervalo de compras de uma fatura: do fechamento ANTERIOR (inclusive —
 * compra no dia do fechamento cai na fatura seguinte) ate a vespera do
 * fechamento desta fatura. Usado pela consulta "fatura atual" do bot e
 * pelas telas de fatura da Fase 6.
 */
export function invoicePeriod(card: CardCycle, ref: InvoiceRef): InvoicePeriod {
  const prev = addInvoiceCycles(card, ref, -1);
  return {
    start: prev.closingDate,
    end: addDaysCivil(ref.closingDate, -1),
  };
}
