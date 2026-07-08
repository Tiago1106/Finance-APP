import {
  civilToISO,
  lastDayOfMonthCivil,
  toSaoPauloCivilDate,
  type CivilDate,
} from "@/lib/core/date";

/** Mes de referencia das telas (sem dia). */
export type MonthRef = { year: number; month: number };

export function currentMonthSP(): MonthRef {
  const today = toSaoPauloCivilDate(new Date());
  return { year: today.year, month: today.month };
}

/** Interpreta o searchParam ?m=YYYY-MM; invalido/ausente → mes corrente. */
export function parseMonthParam(value: string | string[] | undefined): MonthRef {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      if (month >= 1 && month <= 12) return { year, month };
    }
  }
  return currentMonthSP();
}

export function monthParamValue(ref: MonthRef): string {
  return `${ref.year}-${String(ref.month).padStart(2, "0")}`;
}

export function addMonthsRef(ref: MonthRef, n: number): MonthRef {
  const total = ref.year * 12 + (ref.month - 1) + n;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export function monthBoundsISO(ref: MonthRef): { start: string; end: string } {
  return {
    start: civilToISO({ year: ref.year, month: ref.month, day: 1 }),
    end: civilToISO(lastDayOfMonthCivil(ref.year, ref.month)),
  };
}

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

export function monthLabel(ref: MonthRef): string {
  const name = MONTHS[ref.month - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${ref.year}`;
}

export function isoToCivil(iso: string): CivilDate {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}
