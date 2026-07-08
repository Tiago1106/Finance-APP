import {
  addMonthsCivil,
  clampDayToMonth,
  compareCivil,
  type CivilDate,
} from "./date";
import { err, ok, type Result } from "./result";

export type RecurrenceError = {
  code: "recurrence/invalid_day";
  message: string;
};

function validDay(day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= 31;
}

/** Dia efetivo da regra num dado mes: dia 31 em fevereiro → ultimo dia. */
function effectiveDay(dayOfMonth: number, year: number, month: number): number {
  return clampDayToMonth(dayOfMonth, year, month);
}

/**
 * O cron diario pergunta: "esta regra ocorre HOJE?" (ESCOPO 6.3).
 * Considera o clamp de fim de mes: regra do dia 31 ocorre no dia 28/29
 * de fevereiro, 30 de abril etc.
 */
export function occursOn(
  rule: { dayOfMonth: number },
  date: CivilDate
): Result<boolean, RecurrenceError> {
  if (!validDay(rule.dayOfMonth)) {
    return err({
      code: "recurrence/invalid_day",
      message: "O dia da recorrencia deve estar entre 1 e 31.",
    });
  }
  return ok(date.day === effectiveDay(rule.dayOfMonth, date.year, date.month));
}

/**
 * Proxima ocorrencia da regra numa data >= after (inclusive).
 * Usado para exibir "proxima data" nas telas e agendar lembretes.
 */
export function nextOccurrence(
  rule: { dayOfMonth: number },
  after: CivilDate
): Result<CivilDate, RecurrenceError> {
  if (!validDay(rule.dayOfMonth)) {
    return err({
      code: "recurrence/invalid_day",
      message: "O dia da recorrencia deve estar entre 1 e 31.",
    });
  }

  const thisMonth: CivilDate = {
    year: after.year,
    month: after.month,
    day: effectiveDay(rule.dayOfMonth, after.year, after.month),
  };

  if (compareCivil(thisMonth, after) >= 0) {
    return ok(thisMonth);
  }

  const next = addMonthsCivil({ year: after.year, month: after.month, day: 1 }, 1);
  return ok({
    year: next.year,
    month: next.month,
    day: effectiveDay(rule.dayOfMonth, next.year, next.month),
  });
}
