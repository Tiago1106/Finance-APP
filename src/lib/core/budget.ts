import { err, ok, type Result } from "./result";

export const BudgetLevel = {
  OK: "ok",
  WARNING: "warning",
  EXCEEDED: "exceeded",
} as const;
export type BudgetLevel = (typeof BudgetLevel)[keyof typeof BudgetLevel];

export type BudgetProgress = {
  /** Percentual inteiro consumido (arredondado para baixo). Pode passar de 100. */
  percent: number;
  level: BudgetLevel;
};

export type BudgetError = {
  code: "budget/invalid_limit" | "budget/invalid_spent";
  message: string;
};

/** Limiar do alerta "⚠️ categoria em X% do orcamento" (ESCOPO 6.4). */
export const BUDGET_WARNING_THRESHOLD = 80;

/**
 * Progresso do orcamento mensal de uma categoria.
 * - >= 80%: warning ("Alimentacao em 92% do orcamento")
 * - > 100%: exceeded ("Alimentacao estourou o orcamento")
 * Nunca bloqueia lancamento — o app registra a realidade (ESCOPO 6.4).
 */
export function budgetProgress(params: {
  spentCents: number;
  limitCents: number;
}): Result<BudgetProgress, BudgetError> {
  if (!Number.isSafeInteger(params.limitCents) || params.limitCents <= 0) {
    return err({
      code: "budget/invalid_limit",
      message: "O limite do orcamento deve ser positivo.",
    });
  }
  if (!Number.isSafeInteger(params.spentCents) || params.spentCents < 0) {
    return err({
      code: "budget/invalid_spent",
      message: "O gasto nao pode ser negativo.",
    });
  }

  const percent = Math.floor((params.spentCents * 100) / params.limitCents);
  const level =
    params.spentCents > params.limitCents
      ? BudgetLevel.EXCEEDED
      : percent >= BUDGET_WARNING_THRESHOLD
        ? BudgetLevel.WARNING
        : BudgetLevel.OK;

  return ok({ percent, level });
}
