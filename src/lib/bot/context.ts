import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  AccountType,
  accounts,
  bills,
  categories,
  householdMembers,
  users,
} from "@/lib/db/schema";
import type { ExtractionContext } from "@/lib/ai/prompt";
import { toSaoPauloCivilDate } from "@/lib/core/date";

export type BotUser = {
  userId: string;
  name: string | null;
  householdId: string;
  telegramUserId: string;
};

/**
 * Resolve o usuario do household pelo telegram_user_id. Mensagens de IDs
 * nao vinculados NUNCA sao processadas (CLAUDE.md secao 8).
 */
export async function resolveBotUser(telegramUserId: string): Promise<BotUser | null> {
  const [row] = await db
    .select({
      userId: users.id,
      name: users.name,
      householdId: householdMembers.householdId,
    })
    .from(users)
    .innerJoin(householdMembers, eq(householdMembers.userId, users.id))
    .where(eq(users.telegramUserId, telegramUserId))
    .limit(1);
  return row ? { ...row, telegramUserId } : null;
}

export type AccountOption = {
  id: string;
  name: string;
  type: AccountType;
  closingDay: number | null;
  dueDay: number | null;
};

export type CategoryOption = { id: string; name: string };

export type BillOption = {
  id: string;
  name: string;
  accountId: string;
  categoryId: string | null;
};

export type HouseholdContext = {
  accounts: AccountOption[];
  categories: CategoryOption[];
  bills: BillOption[];
  forPrompt: ExtractionContext;
};

/** Carrega o contexto do household usado pela IA e pelos executores. */
export async function loadHouseholdContext(householdId: string): Promise<HouseholdContext> {
  const [accountRows, categoryRows, billRows] = await Promise.all([
    db
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        closingDay: accounts.closingDay,
        dueDay: accounts.dueDay,
      })
      .from(accounts)
      .where(and(eq(accounts.householdId, householdId), isNull(accounts.archivedAt))),
    db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.householdId, householdId)),
    db
      .select({
        id: bills.id,
        name: bills.name,
        accountId: bills.accountId,
        categoryId: bills.categoryId,
      })
      .from(bills)
      .where(and(eq(bills.householdId, householdId), eq(bills.active, true))),
  ]);

  const accountOptions = accountRows.map((a) => ({ ...a, type: a.type as AccountType }));

  return {
    accounts: accountOptions,
    categories: categoryRows,
    bills: billRows,
    forPrompt: {
      today: toSaoPauloCivilDate(new Date()),
      categories: categoryRows.map((c) => c.name),
      accounts: accountOptions.map((a) => ({
        name: a.name,
        isCreditCard: a.type === AccountType.CREDIT_CARD,
      })),
      bills: billRows.map((b) => b.name),
    },
  };
}

/** Match de nome de conta: exato (case-insensitive) > unico contains. */
export function findAccount(
  options: AccountOption[],
  name: string | null
): AccountOption | null {
  if (!name) return null;
  const needle = name.trim().toLowerCase();
  const exact = options.filter((a) => a.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];
  const contains = options.filter(
    (a) => a.name.toLowerCase().includes(needle) || needle.includes(a.name.toLowerCase())
  );
  return contains.length === 1 ? contains[0] : null;
}

/** Match de categoria por nome (case-insensitive). */
export function findCategory(
  options: CategoryOption[],
  name: string | null
): CategoryOption | null {
  if (!name) return null;
  const needle = name.trim().toLowerCase();
  return options.find((c) => c.name.toLowerCase() === needle) ?? null;
}
