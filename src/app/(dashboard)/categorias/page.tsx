import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { budgets, categories, transactions } from "@/lib/db/schema";
import { formatBRL } from "@/lib/format";
import { getSessionContext } from "@/lib/auth/session";
import { CategoryRowMenu, type CategoryRowData } from "./category-row-menu";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function CategoriasPage() {
  const session = await getSessionContext();

  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      budgetCents: budgets.monthlyLimitCents,
      transactionCount: sql<number>`count(${transactions.id})::int`,
    })
    .from(categories)
    .leftJoin(budgets, eq(budgets.categoryId, categories.id))
    .leftJoin(transactions, eq(transactions.categoryId, categories.id))
    .where(eq(categories.householdId, session.householdId))
    .groupBy(categories.id, categories.name, budgets.monthlyLimitCents)
    .orderBy(asc(categories.name));

  const list: CategoryRowData[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    budgetCents: r.budgetCents,
    transactionCount: r.transactionCount,
  }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Categorias</h1>

      <Card>
        <CardHeader>
          <CardTitle>Categorias da família</CardTitle>
          <CardDescription>
            Novas categorias nascem nos lançamentos pelo assistente do Telegram. Aqui você
            renomeia, mescla duplicatas e ajusta orçamentos.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma categoria ainda. Elas serão criadas conforme você lançar gastos pelo
              assistente.
            </p>
          ) : (
            list.map((category) => (
              <div key={category.id} className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                  <span className="text-sm">{category.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {category.transactionCount}{" "}
                    {category.transactionCount === 1 ? "lançamento" : "lançamentos"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {category.budgetCents !== null && (
                    <Badge variant="secondary" className="tabular-nums">
                      {formatBRL(category.budgetCents)}/mês
                    </Badge>
                  )}
                  <CategoryRowMenu
                    category={category}
                    otherCategories={list
                      .filter((c) => c.id !== category.id)
                      .map((c) => ({ id: c.id, name: c.name }))}
                  />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
