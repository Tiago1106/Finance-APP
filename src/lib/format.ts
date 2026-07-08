const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Unica forma permitida de exibir dinheiro na UI (CLAUDE.md secao 5). */
export function formatBRL(cents: number): string {
  return brl.format(cents / 100);
}
