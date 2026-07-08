import { describe, expect, it } from "vitest";
import { nextOccurrence, occursOn } from "./recurrence";

function unwrap<T, E>(r: { ok: true; data: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error("esperava ok: " + JSON.stringify(r.error));
  return r.data;
}

describe("occursOn", () => {
  it("dia comum bate exato", () => {
    expect(unwrap(occursOn({ dayOfMonth: 15 }, { year: 2026, month: 7, day: 15 }))).toBe(true);
    expect(unwrap(occursOn({ dayOfMonth: 15 }, { year: 2026, month: 7, day: 16 }))).toBe(false);
  });

  it("regra do dia 31 ocorre no ultimo dia de fevereiro", () => {
    expect(unwrap(occursOn({ dayOfMonth: 31 }, { year: 2026, month: 2, day: 28 }))).toBe(true);
    expect(unwrap(occursOn({ dayOfMonth: 31 }, { year: 2028, month: 2, day: 29 }))).toBe(true);
    expect(unwrap(occursOn({ dayOfMonth: 31 }, { year: 2028, month: 2, day: 28 }))).toBe(false);
    expect(unwrap(occursOn({ dayOfMonth: 31 }, { year: 2026, month: 4, day: 30 }))).toBe(true);
  });

  it("rejeita dia invalido", () => {
    expect(occursOn({ dayOfMonth: 0 }, { year: 2026, month: 1, day: 1 }).ok).toBe(false);
    expect(occursOn({ dayOfMonth: 32 }, { year: 2026, month: 1, day: 1 }).ok).toBe(false);
  });
});

describe("nextOccurrence", () => {
  it("ainda neste mes quando o dia nao passou (inclusive hoje)", () => {
    expect(unwrap(nextOccurrence({ dayOfMonth: 20 }, { year: 2026, month: 7, day: 6 }))).toEqual({
      year: 2026,
      month: 7,
      day: 20,
    });
    expect(unwrap(nextOccurrence({ dayOfMonth: 6 }, { year: 2026, month: 7, day: 6 }))).toEqual({
      year: 2026,
      month: 7,
      day: 6,
    });
  });

  it("mes seguinte quando o dia ja passou", () => {
    expect(unwrap(nextOccurrence({ dayOfMonth: 5 }, { year: 2026, month: 7, day: 6 }))).toEqual({
      year: 2026,
      month: 8,
      day: 5,
    });
  });

  it("virada de ano", () => {
    expect(unwrap(nextOccurrence({ dayOfMonth: 10 }, { year: 2026, month: 12, day: 15 }))).toEqual(
      { year: 2027, month: 1, day: 10 }
    );
  });

  it("dia 31 em janeiro apos o dia 31 → fim de fevereiro", () => {
    expect(unwrap(nextOccurrence({ dayOfMonth: 31 }, { year: 2026, month: 2, day: 1 }))).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
  });
});
