import { describe, expect, it } from "vitest";
import { centsToBRLInput, parseBRLToCents } from "./money";

function unwrap<T, E>(r: { ok: true; data: T } | { ok: false; error: E }): T {
  if (!r.ok) throw new Error("esperava ok: " + JSON.stringify(r.error));
  return r.data;
}

describe("parseBRLToCents", () => {
  it("aceita formato brasileiro com milhar e decimal", () => {
    expect(unwrap(parseBRLToCents("1.500,50"))).toBe(150050);
    expect(unwrap(parseBRLToCents("1500,50"))).toBe(150050);
  });

  it("aceita formato com ponto decimal e inteiro puro", () => {
    expect(unwrap(parseBRLToCents("1500.50"))).toBe(150050);
    expect(unwrap(parseBRLToCents("1500"))).toBe(150000);
  });

  it("aceita prefixo R$ e espacos", () => {
    expect(unwrap(parseBRLToCents("R$ 230"))).toBe(23000);
  });

  it("um digito decimal vale como dezena de centavos", () => {
    expect(unwrap(parseBRLToCents("10,5"))).toBe(1050);
  });

  it("rejeita negativo, vazio e texto", () => {
    expect(parseBRLToCents("-10").ok).toBe(false);
    expect(parseBRLToCents("").ok).toBe(false);
    expect(parseBRLToCents("abc").ok).toBe(false);
    expect(parseBRLToCents("10,555").ok).toBe(false);
  });
});

describe("centsToBRLInput", () => {
  it("formata para edicao", () => {
    expect(centsToBRLInput(150050)).toBe("1500,50");
    expect(centsToBRLInput(500)).toBe("5,00");
    expect(centsToBRLInput(1)).toBe("0,01");
  });
});
