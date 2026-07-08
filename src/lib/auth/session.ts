import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { householdMembers, users, type HouseholdRole } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

export type SessionContext = {
  userId: string;
  email: string;
  name: string | null;
  householdId: string;
  role: HouseholdRole;
};

/**
 * Usuario autenticado da sessao Supabase (ou null).
 * As Server Actions e Server Components SEMPRE derivam a identidade daqui —
 * nunca de parametros vindos do client.
 */
export const getSessionUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Contexto completo: usuario + household + papel.
 * Redireciona para /login sem sessao. Toda query de dados do app
 * deve ser escopada pelo householdId retornado aqui.
 */
export const getSessionContext = cache(async (): Promise<SessionContext> => {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [row] = await db
    .select({
      householdId: householdMembers.householdId,
      role: householdMembers.role,
      name: users.name,
      email: users.email,
    })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.userId, user.id))
    .limit(1);

  // Sessao valida sem membership indica onboarding incompleto — refazer login.
  if (!row) redirect("/login");

  return {
    userId: user.id,
    email: row.email,
    name: row.name,
    householdId: row.householdId,
    role: row.role as HouseholdRole,
  };
});
