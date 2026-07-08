import { describe, expect, it } from "vitest";
import { billInstanceDueDate, resolveBillStatus } from "./bills";
import { BillInstanceStatus } from "@/lib/db/schema";

function unwrap<T, E>(r: { ok: true; data: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error("esperava ok: " + JSON.stringify(r.error));
  return r.data;
}

describe("billInstanceDueDate", () => {
  it("dia previsto vira vencimento no mes", () => {
    expect(unwrap(billInstanceDueDate({ expectedDueDay: 10, year: 2026, month: 7 }))).toEqual({
      year: 2026,
      month: 7,
      day: 10,
    });
  });

  it("clampa dia 31 em fevereiro", () => {
    expect(unwrap(billInstanceDueDate({ expectedDueDay: 31, year: 2026, month: 2 }))).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    });
  });

  it("rejeita dia invalido", () => {
    expect(billInstanceDueDate({ expectedDueDay: 0, year: 2026, month: 1 }).ok).toBe(false);
  });
});

describe("resolveBillStatus", () => {
  const due = { year: 2026, month: 7, day: 10 };

  it("paga e sempre paid, mesmo vencida", () => {
    expect(
      resolveBillStatus({ dueDate: due, today: { year: 2026, month: 8, day: 1 }, isPaid: true })
    ).toBe(BillInstanceStatus.PAID);
  });

  it("vence hoje ainda e pending", () => {
    expect(resolveBillStatus({ dueDate: due, today: due, isPaid: false })).toBe(
      BillInstanceStatus.PENDING
    );
  });

  it("venceu ontem sem pagar → overdue", () => {
    expect(
      resolveBillStatus({ dueDate: due, today: { year: 2026, month: 7, day: 11 }, isPaid: false })
    ).toBe(BillInstanceStatus.OVERDUE);
  });

  it("antes do vencimento → pending", () => {
    expect(
      resolveBillStatus({ dueDate: due, today: { year: 2026, month: 7, day: 1 }, isPaid: false })
    ).toBe(BillInstanceStatus.PENDING);
  });
});
