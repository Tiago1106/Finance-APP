import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

// ---------------------------------------------------------------------------
// Enums (const objects — ver CLAUDE.md secao 4)
// ---------------------------------------------------------------------------

export const HouseholdRole = {
  OWNER: "owner",
  MEMBER: "member",
} as const;
export type HouseholdRole = (typeof HouseholdRole)[keyof typeof HouseholdRole];

export const AccountType = {
  BANK: "bank",
  WALLET: "wallet",
  CREDIT_CARD: "credit_card",
} as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const TransactionType = {
  EXPENSE: "expense",
  INCOME: "income",
  TRANSFER: "transfer",
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

export const RecurringType = {
  EXPENSE: "expense",
  INCOME: "income",
} as const;
export type RecurringType = (typeof RecurringType)[keyof typeof RecurringType];

export const RecurringFrequency = {
  MONTHLY: "monthly",
} as const;
export type RecurringFrequency = (typeof RecurringFrequency)[keyof typeof RecurringFrequency];

export const BillInstanceStatus = {
  PENDING: "pending",
  PAID: "paid",
  OVERDUE: "overdue",
} as const;
export type BillInstanceStatus = (typeof BillInstanceStatus)[keyof typeof BillInstanceStatus];

// ---------------------------------------------------------------------------
// Households
// ---------------------------------------------------------------------------

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// ---------------------------------------------------------------------------
// Users (espelha auth.users do Supabase — id compartilhado)
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().notNull(),
    email: text("email").notNull(),
    name: text("name"),
    telegramUserId: text("telegram_user_id"),
    telegramLinkCode: text("telegram_link_code"),
    telegramLinkCodeExpiresAt: timestamp("telegram_link_code_expires_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.id],
      foreignColumns: [authUsers.id],
      name: "users_id_auth_users_fk",
    }).onDelete("cascade"),
    uniqueIndex("users_telegram_user_id_idx").on(table.telegramUserId),
    uniqueIndex("users_telegram_link_code_idx").on(table.telegramLinkCode),
  ]
).enableRLS();

// ---------------------------------------------------------------------------
// Household members
// ---------------------------------------------------------------------------

export const householdMembers = pgTable(
  "household_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: [HouseholdRole.OWNER, HouseholdRole.MEMBER] })
      .notNull()
      .default(HouseholdRole.MEMBER),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("household_members_household_user_idx").on(table.householdId, table.userId),
    check(
      "household_members_role_check",
      sql`${table.role} in ('owner', 'member')`
    ),
  ]
).enableRLS();

// ---------------------------------------------------------------------------
// Accounts (contas comuns e cartoes de credito)
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", {
      enum: [AccountType.BANK, AccountType.WALLET, AccountType.CREDIT_CARD],
    }).notNull(),
    closingDay: integer("closing_day"),
    dueDay: integer("due_day"),
    creditLimitCents: integer("credit_limit_cents"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("accounts_type_check", sql`${table.type} in ('bank', 'wallet', 'credit_card')`),
    check(
      "accounts_closing_day_check",
      sql`${table.closingDay} is null or (${table.closingDay} between 1 and 31)`
    ),
    check(
      "accounts_due_day_check",
      sql`${table.dueDay} is null or (${table.dueDay} between 1 and 31)`
    ),
  ]
).enableRLS();

// ---------------------------------------------------------------------------
// Categories (criadas dinamicamente pela IA, com confirmacao do usuario)
// ---------------------------------------------------------------------------

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("categories_household_name_idx").on(table.householdId, table.name),
  ]
).enableRLS();

// ---------------------------------------------------------------------------
// Installment purchases (compras parceladas)
// ---------------------------------------------------------------------------

export const installmentPurchases = pgTable("installment_purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  totalAmountCents: integer("total_amount_cents").notNull(),
  totalInstallments: integer("total_installments").notNull(),
  // numero da proxima parcela a ser gerada (1 para compra nova; N+1 para compra "em andamento")
  currentInstallment: integer("current_installment").notNull().default(1),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// ---------------------------------------------------------------------------
// Recurring rules (recorrencias de valor fixo)
// ---------------------------------------------------------------------------

export const recurringRules = pgTable(
  "recurring_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    type: text("type", { enum: [RecurringType.EXPENSE, RecurringType.INCOME] }).notNull(),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    frequency: text("frequency", { enum: [RecurringFrequency.MONTHLY] })
      .notNull()
      .default(RecurringFrequency.MONTHLY),
    dayOfMonth: integer("day_of_month").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("recurring_rules_type_check", sql`${table.type} in ('expense', 'income')`),
    check(
      "recurring_rules_day_of_month_check",
      sql`${table.dayOfMonth} between 1 and 31`
    ),
  ]
).enableRLS();

// ---------------------------------------------------------------------------
// Bills (contas a pagar de valor variavel) + instances (pendencia mensal)
// ---------------------------------------------------------------------------

export const bills = pgTable(
  "bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    expectedDueDay: integer("expected_due_day").notNull(),
    isFixedAmount: boolean("is_fixed_amount").notNull().default(false),
    fixedAmountCents: integer("fixed_amount_cents"),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "bills_expected_due_day_check",
      sql`${table.expectedDueDay} between 1 and 31`
    ),
  ]
).enableRLS();

export const billInstances = pgTable(
  "bill_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    billId: uuid("bill_id")
      .notNull()
      .references(() => bills.id, { onDelete: "cascade" }),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    dueDate: date("due_date").notNull(),
    status: text("status", {
      enum: [BillInstanceStatus.PENDING, BillInstanceStatus.PAID, BillInstanceStatus.OVERDUE],
    })
      .notNull()
      .default(BillInstanceStatus.PENDING),
    amountCents: integer("amount_cents"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "bill_instances_status_check",
      sql`${table.status} in ('pending', 'paid', 'overdue')`
    ),
  ]
).enableRLS();

// ---------------------------------------------------------------------------
// Transactions (despesa | receita | transferencia)
// ---------------------------------------------------------------------------

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [TransactionType.EXPENSE, TransactionType.INCOME, TransactionType.TRANSFER],
    }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    description: text("description"),
    occurredOn: date("occurred_on").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    transferToAccountId: uuid("transfer_to_account_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    installmentPurchaseId: uuid("installment_purchase_id").references(
      () => installmentPurchases.id,
      { onDelete: "cascade" }
    ),
    installmentNumber: integer("installment_number"),
    recurringRuleId: uuid("recurring_rule_id").references(() => recurringRules.id, {
      onDelete: "set null",
    }),
    billInstanceId: uuid("bill_instance_id").references(() => billInstances.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "transactions_type_check",
      sql`${table.type} in ('expense', 'income', 'transfer')`
    ),
    check("transactions_amount_positive_check", sql`${table.amountCents} > 0`),
  ]
).enableRLS();

// ---------------------------------------------------------------------------
// Budgets (limite mensal por categoria)
// ---------------------------------------------------------------------------

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    monthlyLimitCents: integer("monthly_limit_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("budgets_household_category_idx").on(table.householdId, table.categoryId),
  ]
).enableRLS();

// ---------------------------------------------------------------------------
// Invites (convite de household, validade 48h)
// ---------------------------------------------------------------------------

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedBy: uuid("used_by").references(() => users.id, { onDelete: "set null" }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("invites_code_idx").on(table.code)]
).enableRLS();

// ---------------------------------------------------------------------------
// Bot pending actions (estado de conversa para botoes inline do Telegram).
// Acesso exclusivamente server-side (Drizzle) — RLS sem policies nega tudo
// via PostgREST. callback_data carrega apenas "pa:<id>:<opcao>" (limite de
// 64 bytes do Telegram); o payload completo fica aqui.
// ---------------------------------------------------------------------------

export const BotPendingActionKind = {
  CHOOSE_ACCOUNT: "choose_account",
  CONFIRM_CATEGORY: "confirm_category",
} as const;
export type BotPendingActionKind =
  (typeof BotPendingActionKind)[keyof typeof BotPendingActionKind];

export const botPendingActions = pgTable("bot_pending_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  telegramUserId: text("telegram_user_id").notNull(),
  kind: text("kind", {
    enum: [BotPendingActionKind.CHOOSE_ACCOUNT, BotPendingActionKind.CONFIRM_CATEGORY],
  }).notNull(),
  payload: jsonb("payload").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
