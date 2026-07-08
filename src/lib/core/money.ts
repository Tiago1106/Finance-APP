import { err, ok, type Result } from "./result";

export type MoneyError = {
  code: "money/invalid" | "money/negative";
  message: string;
};

/**
 * Converte entrada do usuario em reais para centavos (integer).
 * Aceita "1.500,50", "1500,50", "1500.50", "1500" e "R$ 1.500,50".
 * Dinheiro NUNCA trafega como float — conversao por manipulacao de string.
 */
export function parseBRLToCents(input: string): Result<number, MoneyError> {
  const cleaned = input.replace(/\s|R\$/g, "");
  if (cleaned === "") {
    return err({ code: "money/invalid", message: "Informe um valor." });
  }

  if (cleaned.startsWith("-")) {
    return err({ code: "money/negative", message: "O valor nao pode ser negativo." });
  }

  // Semantica pt-BR: virgula e SEMPRE decimal (1-2 digitos); ponto e milhar,
  // exceto no formato "1500.50" (decimal estilo US, aceito por conveniencia).
  let integerRaw: string;
  let decimalRaw: string;

  if (cleaned.includes(",")) {
    const m = cleaned.match(/^(\d{1,3}(?:\.\d{3})*|\d+),(\d{1,2})$/);
    if (!m) {
      return err({ code: "money/invalid", message: "Valor invalido. Ex: 1.500,50" });
    }
    integerRaw = m[1].replace(/\./g, "");
    decimalRaw = m[2];
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(cleaned)) {
    integerRaw = cleaned.replace(/\./g, "");
    decimalRaw = "";
  } else {
    const m = cleaned.match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (!m) {
      return err({ code: "money/invalid", message: "Valor invalido. Ex: 1.500,50" });
    }
    integerRaw = m[1];
    decimalRaw = m[2] ?? "";
  }

  const integerPart = integerRaw;
  const decimalPart = decimalRaw.padEnd(2, "0");

  const cents = parseInt(integerPart, 10) * 100 + (decimalPart ? parseInt(decimalPart, 10) : 0);

  if (!Number.isSafeInteger(cents)) {
    return err({ code: "money/invalid", message: "Valor alto demais." });
  }

  return ok(cents);
}

/**
 * Converte centavos para o formato de edicao em input ("1500,50").
 * Para EXIBICAO usar formatBRL (src/lib/format.ts), nunca esta funcao.
 */
export function centsToBRLInput(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  const reais = Math.trunc(abs / 100);
  const centavos = abs % 100;
  return `${reais},${String(centavos).padStart(2, "0")}`;
}
