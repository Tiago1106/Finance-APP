import { describe, expect, it } from "vitest";
import { BudgetLevel, budgetProgress } from "./budget";

function unwrap<T, E>(r: { ok: true; data: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error("esperava ok: " + JSON.stringify(r.error));
  return r.data;
}

describe("budgetProgress", () => {
  const limit = 120000; // R$ 1.200,00

  it("abaixo de 80% e ok", () => {
    expect(unwrap(budgetProgress({ spentCents: 94800, limitCents: limit }))).toEqual({
      percent: 79,
      level: BudgetLevel.OK,
    });
  });

  it("80% exatos dispara warning", () => {
    expect(unwrap(budgetProgress({ spentCents: 96000, limitCents: limit }))).toEqual({
      percent: 80,
      level: BudgetLevel.WARNING,
    });
  });

  it("100% exatos ainda e warning (nao estourou)", () => {
    expect(unwrap(budgetProgress({ spentCents: 120000, limitCents: limit }))).toEqual({
      percent: 100,
      level: BudgetLevel.WARNING,
    });
  });

  it("acima de 100% e exceeded", () => {
    const r = unwrap(budgetProgress({ spentCents: 131000, limitCents: limit }));
    expect(r.level).toBe(BudgetLevel.EXCEEDED);
    expect(r.percent).toBe(109);
  });

  it("gasto zero", () => {
    expect(unwrap(budgetProgress({ spentCents: 0, limitCents: limit }))).toEqual({
      percent: 0,
      level: BudgetLevel.OK,
    });
  });

  it("cenario do ESCOPO: 92% do orcamento", () => {
    const r = unwrap(budgetProgress({ spentCents: 110400, limitCents: limit }));
    expect(r.percent).toBe(92);
    expect(r.level).toBe(BudgetLevel.WARNING);
  });

  it("rejeita limite zero/negativo e gasto negativo", () => {
    expect(budgetProgress({ spentCents: 100, limitCents: 0 }).ok).toBe(false);
    expect(budgetProgress({ spentCents: 100, limitCents: -1 }).ok).toBe(false);
    expect(budgetProgress({ spentCents: -1, limitCents: 100 }).ok).toBe(false);
  });
});
