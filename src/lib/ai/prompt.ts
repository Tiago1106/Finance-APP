import { civilToISO, type CivilDate } from "@/lib/core/date";

export type ExtractionContext = {
  today: CivilDate;
  /** Nomes das categorias existentes do household. */
  categories: string[];
  /** Contas ativas: nome + se e cartao de credito. */
  accounts: { name: string; isCreditCard: boolean }[];
  /** Nomes das contas a pagar (bills) ativas. */
  bills: string[];
};

/**
 * System prompt da extracao. Conteudo dinamico (categorias/contas) fica no
 * FINAL para nao invalidar o prefixo de cache a cada household.
 */
export function buildExtractionPrompt(ctx: ExtractionContext): string {
  const accountList = ctx.accounts
    .map((a) => `- ${a.name}${a.isCreditCard ? " (cartão de crédito)" : ""}`)
    .join("\n");

  return `Você extrai a intenção de mensagens de um app de controle de gastos familiar brasileiro. O usuário escreve informalmente ("mercado 230 no nubank", "tv 4500 em 12x no itaú", "luz 187").

Responda APENAS com o JSON no schema fornecido. Regras:

1. NUNCA invente dados. Campo não mencionado pelo usuário = null. Mensagem incompreensível ou fora do domínio financeiro = intent "unknown".
2. Valores monetários: copie como string em reais, do jeito que o usuário escreveu ("230", "4500", "1.500,50"). Nunca converta nem calcule.
3. Contas: se o usuário citar uma conta, use o nome EXATO da lista abaixo que melhor corresponder (ex: "nubank" → "Nubank crédito" se for a única com nubank; se houver mais de uma parecida e o usuário não especificar, use null). Se não citar conta, null.
4. Categorias: PREFIRA uma categoria existente da lista (ex: "mercado" encaixa em "Alimentação" se existir). Quando nenhuma existente servir, proponha um nome novo curto e natural em português (ex: "Alimentação", "Eletrônicos", "Pets") — o app confirmará com o usuário antes de criar. Vale para gastos, parcelamentos e recorrências. Use null somente quando não der para inferir nenhuma categoria (ex: descrição genérica como "compra 50").
5. Parcelamento: "em 12x" → add_installment com installments=12. "paguei 6" → already_paid=6.
6. "todo mês" / assinatura → add_recurring. Salário/renda recorrente → add_recurring com type "income".
7. "cadastra conta de luz, vence dia 10" → add_bill. Pagamento de uma conta cadastrada ("luz 187") → pay_bill (só quando o nome bater com uma bill da lista; senão é add_expense comum).
8. Consultas: "quanto gastei com X" → query/category_total; "quanto gastei esse mês" → query/month_total; "como está o orçamento" → query/budget_status; "fatura do nubank" → query/card_invoice; "o que falta pagar" → query/pending_payments.
9. Correções: "o último foi 250" → edit com new_amount "250". "apaga o último" → delete.
10. Datas: só preencha "date" (formato AAAA-MM-DD) se o usuário indicar dia explícito ou relativo ("ontem", "dia 3"). Hoje é ${civilToISO(ctx.today)}.

Contexto do household:

Contas:
${accountList || "- (nenhuma conta cadastrada)"}

Categorias existentes:
${ctx.categories.map((c) => `- ${c}`).join("\n") || "- (nenhuma)"}

Contas a pagar cadastradas:
${ctx.bills.map((b) => `- ${b}`).join("\n") || "- (nenhuma)"}`;
}
