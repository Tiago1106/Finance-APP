import { clampDayToMonth, compareCivil, type CivilDate } from "./date";
import { err, ok, type Result } from "./result";
import { BillInstanceStatus } from "@/lib/db/schema";

export type BillError = {
  code: "bills/invalid_day";
  message: string;
};

/**
 * Vencimento da pendencia mensal de uma conta a pagar (ESCOPO 6.3.1):
 * o dia previsto, clampado ao tamanho do mes.
 */
export function billInstanceDueDate(params: {
  expectedDueDay: number;
  year: number;
  month: number;
}): Result<CivilDate, BillError> {
  if (
    !Number.isInteger(params.expectedDueDay) ||
    params.expectedDueDay < 1 ||
    params.expectedDueDay > 31
  ) {
    return err({
      code: "bills/invalid_day",
      message: "O dia de vencimento deve estar entre 1 e 31.",
    });
  }
  return ok({
    year: params.year,
    month: params.month,
    day: clampDayToMonth(params.expectedDueDay, params.year, params.month),
  });
}

/**
 * Status de uma pendencia: paga vence tudo; nao paga e vencida (dueDate
 * estritamente antes de hoje) → overdue; caso contrario pending.
 * "Vence hoje" ainda e pending — so vira overdue no dia seguinte.
 */
export function resolveBillStatus(params: {
  dueDate: CivilDate;
  today: CivilDate;
  isPaid: boolean;
}): BillInstanceStatus {
  if (params.isPaid) return BillInstanceStatus.PAID;
  if (compareCivil(params.dueDate, params.today) < 0) return BillInstanceStatus.OVERDUE;
  return BillInstanceStatus.PENDING;
}
