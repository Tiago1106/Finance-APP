import { describe, expect, it } from "vitest";
import { IntentSchema, intentJsonSchema } from "./schema";

describe("IntentSchema", () => {
  it("aceita add_expense completo", () => {
    const r = IntentSchema.safeParse({
      intent: "add_expense",
      amount: "230",
      description: "mercado",
      account_name: "Nubank crédito",
      category_name: "Alimentação",
      date: null,
    });
    expect(r.success).toBe(true);
  });

  it("aceita add_installment em andamento", () => {
    const r = IntentSchema.safeParse({
      intent: "add_installment",
      description: "sofá",
      total_amount: "3000",
      installments: 10,
      already_paid: 6,
      account_name: null,
      category_name: null,
    });
    expect(r.success).toBe(true);
  });

  it("aceita query de pendencias", () => {
    const r = IntentSchema.safeParse({
      intent: "query",
      kind: "pending_payments",
      category_name: null,
      account_name: null,
    });
    expect(r.success).toBe(true);
  });

  it("aceita unknown e delete sem campos extras", () => {
    expect(IntentSchema.safeParse({ intent: "unknown" }).success).toBe(true);
    expect(IntentSchema.safeParse({ intent: "delete" }).success).toBe(true);
  });

  it("rejeita intent desconhecida", () => {
    expect(IntentSchema.safeParse({ intent: "transfer_money" }).success).toBe(false);
  });

  it("rejeita campo faltando (amount ausente em add_expense)", () => {
    const r = IntentSchema.safeParse({
      intent: "add_expense",
      description: "mercado",
      account_name: null,
      category_name: null,
      date: null,
    });
    expect(r.success).toBe(false);
  });

  it("rejeita campo extra (strictObject)", () => {
    const r = IntentSchema.safeParse({
      intent: "delete",
      extra: "hack",
    });
    expect(r.success).toBe(false);
  });

  it("rejeita amount numerico (deve ser string)", () => {
    const r = IntentSchema.safeParse({
      intent: "add_expense",
      amount: 230,
      description: "mercado",
      account_name: null,
      category_name: null,
      date: null,
    });
    expect(r.success).toBe(false);
  });
});

describe("intentJsonSchema", () => {
  it("gera JSON schema com discriminated union e sem constraints numericos", () => {
    const schema = intentJsonSchema();
    const json = JSON.stringify(schema);
    expect(json).toContain("add_expense");
    expect(json).toContain("pending_payments");
    // structured outputs nao suporta minimum/maximum
    expect(json).not.toContain('"minimum"');
    expect(json).not.toContain('"maximum"');
  });

  it("objetos proibem propriedades extras", () => {
    const json = JSON.stringify(intentJsonSchema());
    expect(json).toContain('"additionalProperties":false');
  });
});
