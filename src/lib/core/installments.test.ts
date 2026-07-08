import { describe, expect, it } from "vitest";
import {
  generateInstallmentPlan,
  generateRemainingInstallments,
  splitInstallments,
} from "./installments";
import { resolveInvoiceForPurchase, type CardCycle } from "./invoice";

const card: CardCycle = { closingDay: 28, dueDay: 5 };

function unwrap<T, E>(r: { ok: true; data: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error("esperava ok, veio erro: " + JSON.stringify(r.error));
  return r.data;
}

const firstInvoice = unwrap(
  resolveInvoiceForPurchase(card, { year: 2026, month: 7, day: 10 })
); // fecha 28/07, vence 05/08

describe("splitInstallments", () => {
  it("divisao exata", () => {
    expect(unwrap(splitInstallments(450000, 12))).toEqual(new Array(12).fill(37500));
  });

  it("resto vai na primeira parcela e a soma bate com o total", () => {
    const parts = unwrap(splitInstallments(1000, 3));
    expect(parts).toEqual([334, 333, 333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("invariante: soma == total para varios casos", () => {
    for (const [total, count] of [
      [999, 7],
      [123456, 11],
      [100, 3],
      [299999, 10],
    ] as const) {
      const parts = unwrap(splitInstallments(total, count));
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.length).toBe(count);
    }
  });

  it("rejeita total <= 0 e count < 1", () => {
    expect(splitInstallments(0, 3).ok).toBe(false);
    expect(splitInstallments(-100, 3).ok).toBe(false);
    expect(splitInstallments(1000, 0).ok).toBe(false);
  });
});

describe("generateInstallmentPlan", () => {
  it("tv 4500 em 12x: parcelas de 375 comecando na fatura da compra", () => {
    const plan = unwrap(
      generateInstallmentPlan({ totalCents: 450000, count: 12, card, firstInvoice })
    );
    expect(plan).toHaveLength(12);
    expect(plan[0].installmentNumber).toBe(1);
    expect(plan[0].amountCents).toBe(37500);
    expect(plan[0].invoice.referenceMonth).toBe(8); // fatura de agosto (ESCOPO 4.2)
    expect(plan[11].installmentNumber).toBe(12);
    expect(plan[11].invoice.referenceMonth).toBe(7); // 11 meses depois: julho/2027
    expect(plan[11].invoice.referenceYear).toBe(2027);
  });
});

describe("generateRemainingInstallments", () => {
  it("sofa 3000 em 10x paguei 6: gera 4 parcelas de 300, numeradas 7-10", () => {
    const plan = unwrap(
      generateRemainingInstallments({
        totalCents: 300000,
        count: 10,
        alreadyPaid: 6,
        card,
        nextInvoice: firstInvoice,
      })
    );
    expect(plan).toHaveLength(4);
    expect(plan.map((p) => p.installmentNumber)).toEqual([7, 8, 9, 10]);
    expect(plan.every((p) => p.amountCents === 30000)).toBe(true);
    expect(plan[0].invoice.referenceMonth).toBe(8);
    expect(plan[3].invoice.referenceMonth).toBe(11);
  });

  it("resto de centavos ja ficou nas parcelas passadas: restantes usam valor base", () => {
    // 1000 em 3x = [334, 333, 333]; pagou 1 → restam [333, 333]
    const plan = unwrap(
      generateRemainingInstallments({
        totalCents: 1000,
        count: 3,
        alreadyPaid: 1,
        card,
        nextInvoice: firstInvoice,
      })
    );
    expect(plan.map((p) => p.amountCents)).toEqual([333, 333]);
  });

  it("borda: falta so a ultima parcela", () => {
    const plan = unwrap(
      generateRemainingInstallments({
        totalCents: 300000,
        count: 10,
        alreadyPaid: 9,
        card,
        nextInvoice: firstInvoice,
      })
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].installmentNumber).toBe(10);
  });

  it("rejeita alreadyPaid >= count e negativo", () => {
    const base = { totalCents: 1000, count: 3, card, nextInvoice: firstInvoice };
    expect(generateRemainingInstallments({ ...base, alreadyPaid: 3 }).ok).toBe(false);
    expect(generateRemainingInstallments({ ...base, alreadyPaid: -1 }).ok).toBe(false);
  });
});
