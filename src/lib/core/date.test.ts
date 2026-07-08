import { describe, expect, it } from "vitest";
import {
  addMonthsCivil,
  civilToISO,
  clampDayToMonth,
  compareCivil,
  daysInMonth,
  lastDayOfMonthCivil,
  toSaoPauloCivilDate,
} from "./date";

describe("toSaoPauloCivilDate", () => {
  it("converte instante UTC para o dia em Brasilia (UTC-3)", () => {
    // 02:59Z do dia 7 ainda e 23:59 do dia 6 em Brasilia
    expect(toSaoPauloCivilDate(new Date("2026-07-07T02:59:00Z"))).toEqual({
      year: 2026,
      month: 7,
      day: 6,
    });
    // 03:00Z ja e meia-noite do dia 7 em Brasilia
    expect(toSaoPauloCivilDate(new Date("2026-07-07T03:00:00Z"))).toEqual({
      year: 2026,
      month: 7,
      day: 7,
    });
  });

  it("vira o ano corretamente", () => {
    expect(toSaoPauloCivilDate(new Date("2027-01-01T01:00:00Z"))).toEqual({
      year: 2026,
      month: 12,
      day: 31,
    });
  });
});

describe("daysInMonth / lastDayOfMonthCivil", () => {
  it("fevereiro comum e bissexto", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(lastDayOfMonthCivil(2028, 2)).toEqual({ year: 2028, month: 2, day: 29 });
  });

  it("meses de 30 e 31 dias", () => {
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe("clampDayToMonth", () => {
  it("clampa dia 31 em fevereiro", () => {
    expect(clampDayToMonth(31, 2026, 2)).toBe(28);
    expect(clampDayToMonth(31, 2028, 2)).toBe(29);
  });

  it("mantem dia valido", () => {
    expect(clampDayToMonth(15, 2026, 2)).toBe(15);
  });
});

describe("addMonthsCivil", () => {
  it("avanca mes simples", () => {
    expect(addMonthsCivil({ year: 2026, month: 7, day: 10 }, 1)).toEqual({
      year: 2026,
      month: 8,
      day: 10,
    });
  });

  it("vira o ano", () => {
    expect(addMonthsCivil({ year: 2026, month: 12, day: 5 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 5,
    });
    expect(addMonthsCivil({ year: 2026, month: 11, day: 5 }, 14)).toEqual({
      year: 2028,
      month: 1,
      day: 5,
    });
  });

  it("clampa 31/jan + 1 mes para fim de fevereiro", () => {
    expect(addMonthsCivil({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
    expect(addMonthsCivil({ year: 2028, month: 1, day: 31 }, 1)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
  });

  it("retrocede meses", () => {
    expect(addMonthsCivil({ year: 2026, month: 1, day: 15 }, -2)).toEqual({
      year: 2025,
      month: 11,
      day: 15,
    });
  });
});

describe("compareCivil", () => {
  it("ordena por ano, mes e dia", () => {
    expect(compareCivil({ year: 2026, month: 7, day: 6 }, { year: 2026, month: 7, day: 6 })).toBe(0);
    expect(
      compareCivil({ year: 2026, month: 7, day: 5 }, { year: 2026, month: 7, day: 6 })
    ).toBeLessThan(0);
    expect(
      compareCivil({ year: 2027, month: 1, day: 1 }, { year: 2026, month: 12, day: 31 })
    ).toBeGreaterThan(0);
  });
});

describe("civilDiffDays", () => {
  it("conta dias entre datas, inclusive atravessando meses", async () => {
    const { civilDiffDays } = await import("./date");
    expect(
      civilDiffDays({ year: 2026, month: 7, day: 10 }, { year: 2026, month: 7, day: 7 })
    ).toBe(3);
    expect(
      civilDiffDays({ year: 2026, month: 8, day: 1 }, { year: 2026, month: 7, day: 31 })
    ).toBe(1);
    expect(
      civilDiffDays({ year: 2026, month: 7, day: 5 }, { year: 2026, month: 7, day: 7 })
    ).toBe(-2);
  });
});

describe("civilToISO", () => {
  it("formata com zeros a esquerda", () => {
    expect(civilToISO({ year: 2026, month: 7, day: 6 })).toBe("2026-07-06");
    expect(civilToISO({ year: 2026, month: 11, day: 25 })).toBe("2026-11-25");
  });
});
