import { describe, expect, it } from "vitest";
import {
  addInvoiceCycles,
  invoicePeriod,
  resolveInvoiceForPurchase,
  type CardCycle,
} from "./invoice";

// Cartao tipico brasileiro: fecha dia 28, vence dia 5 do mes seguinte.
const card: CardCycle = { closingDay: 28, dueDay: 5 };

function unwrap<T, E>(r: { ok: true; data: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error("esperava ok, veio erro: " + JSON.stringify(r.error));
  return r.data;
}

describe("resolveInvoiceForPurchase", () => {
  it("compra antes do fechamento cai na fatura que fecha no mes", () => {
    const inv = unwrap(
      resolveInvoiceForPurchase(card, { year: 2026, month: 7, day: 27 })
    );
    expect(inv.closingDate).toEqual({ year: 2026, month: 7, day: 28 });
    expect(inv.dueDate).toEqual({ year: 2026, month: 8, day: 5 });
    expect(inv.referenceMonth).toBe(8);
    expect(inv.referenceYear).toBe(2026);
  });

  it("compra NO DIA do fechamento cai na fatura seguinte", () => {
    const inv = unwrap(
      resolveInvoiceForPurchase(card, { year: 2026, month: 7, day: 28 })
    );
    expect(inv.closingDate).toEqual({ year: 2026, month: 8, day: 28 });
    expect(inv.dueDate).toEqual({ year: 2026, month: 9, day: 5 });
  });

  it("compra depois do fechamento tambem cai na seguinte", () => {
    const inv = unwrap(
      resolveInvoiceForPurchase(card, { year: 2026, month: 7, day: 30 })
    );
    expect(inv.closingDate).toEqual({ year: 2026, month: 8, day: 28 });
  });

  it("dueDay maior que closingDay vence no MESMO mes do fechamento", () => {
    const early: CardCycle = { closingDay: 5, dueDay: 15 };
    const inv = unwrap(
      resolveInvoiceForPurchase(early, { year: 2026, month: 7, day: 3 })
    );
    expect(inv.closingDate).toEqual({ year: 2026, month: 7, day: 5 });
    expect(inv.dueDate).toEqual({ year: 2026, month: 7, day: 15 });
  });

  it("virada de ano: compra em dezembro apos fechamento vence em fevereiro", () => {
    const inv = unwrap(
      resolveInvoiceForPurchase(card, { year: 2026, month: 12, day: 29 })
    );
    expect(inv.closingDate).toEqual({ year: 2027, month: 1, day: 28 });
    expect(inv.dueDate).toEqual({ year: 2027, month: 2, day: 5 });
  });

  it("fechamento dia 31 clampa em fevereiro e compra 28/02 vai para marco", () => {
    const c: CardCycle = { closingDay: 31, dueDay: 10 };
    // fev/2026 tem 28 dias; fechamento efetivo = 28. Compra dia 27 fecha em fev.
    const feb = unwrap(resolveInvoiceForPurchase(c, { year: 2026, month: 2, day: 27 }));
    expect(feb.closingDate).toEqual({ year: 2026, month: 2, day: 28 });
    // Compra no dia 28 (dia efetivo do fechamento) vai para a fatura de marco.
    const mar = unwrap(resolveInvoiceForPurchase(c, { year: 2026, month: 2, day: 28 }));
    expect(mar.closingDate).toEqual({ year: 2026, month: 3, day: 31 });
  });

  it("vencimento dia 31 clampa em mes de 30 dias", () => {
    const c: CardCycle = { closingDay: 15, dueDay: 31 };
    // fechamento 15/abr, vencimento 31/abr → clampa para 30/abr
    const inv = unwrap(resolveInvoiceForPurchase(c, { year: 2026, month: 4, day: 10 }));
    expect(inv.dueDate).toEqual({ year: 2026, month: 4, day: 30 });
  });

  it("rejeita dias invalidos", () => {
    const r = resolveInvoiceForPurchase(
      { closingDay: 0, dueDay: 5 },
      { year: 2026, month: 7, day: 1 }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("invoice/invalid_day");
  });
});

describe("addInvoiceCycles", () => {
  it("projeta faturas consecutivas", () => {
    const first = unwrap(
      resolveInvoiceForPurchase(card, { year: 2026, month: 7, day: 10 })
    );
    const second = addInvoiceCycles(card, first, 1);
    expect(second.closingDate).toEqual({ year: 2026, month: 8, day: 28 });
    expect(second.dueDate).toEqual({ year: 2026, month: 9, day: 5 });
    const sixth = addInvoiceCycles(card, first, 5);
    expect(sixth.closingDate).toEqual({ year: 2026, month: 12, day: 28 });
    expect(sixth.dueDate).toEqual({ year: 2027, month: 1, day: 5 });
  });

  it("fechamento clampado em fevereiro volta ao dia 31 em marco", () => {
    const c: CardCycle = { closingDay: 31, dueDay: 10 };
    const jan = unwrap(resolveInvoiceForPurchase(c, { year: 2026, month: 1, day: 10 }));
    expect(jan.closingDate).toEqual({ year: 2026, month: 1, day: 31 });
    const feb = addInvoiceCycles(c, jan, 1);
    expect(feb.closingDate).toEqual({ year: 2026, month: 2, day: 28 });
    const mar = addInvoiceCycles(c, jan, 2);
    expect(mar.closingDate).toEqual({ year: 2026, month: 3, day: 31 });
  });
});

describe("invoicePeriod", () => {
  it("vai do fechamento anterior (inclusive) a vespera do fechamento", () => {
    // fatura que fecha 28/07: compras de 28/06 a 27/07
    const inv = unwrap(resolveInvoiceForPurchase(card, { year: 2026, month: 7, day: 10 }));
    const period = invoicePeriod(card, inv);
    expect(period.start).toEqual({ year: 2026, month: 6, day: 28 });
    expect(period.end).toEqual({ year: 2026, month: 7, day: 27 });
  });

  it("compra no limite do periodo pertence a fatura (consistencia com resolve)", () => {
    const inv = unwrap(resolveInvoiceForPurchase(card, { year: 2026, month: 7, day: 10 }));
    const period = invoicePeriod(card, inv);
    // compra exatamente em period.start cai nesta fatura
    const atStart = unwrap(resolveInvoiceForPurchase(card, period.start));
    expect(atStart.closingDate).toEqual(inv.closingDate);
    // compra exatamente em period.end tambem
    const atEnd = unwrap(resolveInvoiceForPurchase(card, period.end));
    expect(atEnd.closingDate).toEqual(inv.closingDate);
    // um dia depois do end ja e a proxima
    const after = unwrap(
      resolveInvoiceForPurchase(card, { year: 2026, month: 7, day: 28 })
    );
    expect(after.closingDate).not.toEqual(inv.closingDate);
  });

  it("virada de ano: fatura que fecha em janeiro comeca em dezembro", () => {
    const inv = unwrap(resolveInvoiceForPurchase(card, { year: 2027, month: 1, day: 10 }));
    const period = invoicePeriod(card, inv);
    expect(period.start).toEqual({ year: 2026, month: 12, day: 28 });
    expect(period.end).toEqual({ year: 2027, month: 1, day: 27 });
  });
});
