import { formatInTimeZone } from "date-fns-tz";

export const APP_TIMEZONE = "America/Sao_Paulo";

/**
 * Data civil: um dia de calendario no fuso de Brasilia, sem hora.
 * Todas as regras de negocio (fatura, recorrencia, contas a pagar)
 * operam sobre CivilDate — nunca sobre Date cru, para nao depender
 * do timezone do servidor.
 */
export type CivilDate = {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
};

/**
 * Unica fronteira entre o tempo real e o core: converte um instante
 * (Date) para o dia civil correspondente em Brasilia.
 */
export function toSaoPauloCivilDate(instant: Date): CivilDate {
  const iso = formatInTimeZone(instant, APP_TIMEZONE, "yyyy-MM-dd");
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

export function daysInMonth(year: number, month: number): number {
  // Date.UTC com dia 0 do mes seguinte = ultimo dia do mes.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function lastDayOfMonthCivil(year: number, month: number): CivilDate {
  return { year, month, day: daysInMonth(year, month) };
}

/** Dia 31 em fevereiro → 28/29; dia valido permanece. */
export function clampDayToMonth(day: number, year: number, month: number): number {
  return Math.min(day, daysInMonth(year, month));
}

/**
 * Avanca (ou retrocede) meses mantendo o dia, clampado ao tamanho
 * do mes de destino (31/jan + 1 mes → 28 ou 29/fev).
 */
export function addMonthsCivil(date: CivilDate, months: number): CivilDate {
  const totalMonths = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  return { year, month, day: clampDayToMonth(date.day, year, month) };
}

/** Soma (ou subtrai) dias de calendario. */
export function addDaysCivil(date: CivilDate, days: number): CivilDate {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

/** Dias de a - b (positivo quando a e depois de b). */
export function civilDiffDays(a: CivilDate, b: CivilDate): number {
  const utcA = Date.UTC(a.year, a.month - 1, a.day);
  const utcB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((utcA - utcB) / 86_400_000);
}

/** < 0 se a antes de b; 0 se iguais; > 0 se a depois de b. */
export function compareCivil(a: CivilDate, b: CivilDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

/** "2026-07-06" — formato aceito pelas colunas date do Postgres. */
export function civilToISO(d: CivilDate): string {
  const mm = String(d.month).padStart(2, "0");
  const dd = String(d.day).padStart(2, "0");
  return `${d.year}-${mm}-${dd}`;
}
