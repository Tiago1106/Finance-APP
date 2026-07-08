"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  HouseholdRole,
  householdMembers,
  households,
  invites,
  users,
} from "@/lib/db/schema";
import { validateInvite } from "@/lib/core/invites";
import { createClient } from "@/lib/supabase/server";

export type AuthActionState = {
  error: string | null;
};

const signUpSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome (minimo 2 letras)."),
  email: z.email("E-mail invalido."),
  password: z.string().min(8, "A senha precisa de pelo menos 8 caracteres."),
  inviteCode: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

const signInSchema = z.object({
  email: z.email("E-mail invalido."),
  password: z.string().min(1, "Informe a senha."),
});

export async function signUp(
  _prev: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    inviteCode: formData.get("inviteCode") ?? undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { name, email, password, inviteCode } = parsed.data;

  // Valida o convite ANTES de criar a conta — codigo invalido nao pode
  // deixar conta orfa no Supabase Auth.
  let invitedHouseholdId: string | null = null;
  let inviteId: string | null = null;

  if (inviteCode) {
    const [invite] = await db
      .select()
      .from(invites)
      .where(eq(invites.code, inviteCode))
      .limit(1);

    if (!invite) {
      return { error: "Convite invalido. Confira o codigo." };
    }
    const validation = validateInvite(
      { expiresAt: invite.expiresAt, usedAt: invite.usedAt },
      new Date()
    );
    if (!validation.ok) {
      return { error: validation.error.message };
    }
    invitedHouseholdId = invite.householdId;
    inviteId = invite.id;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error || !data.user) {
    const messages: Record<string, string> = {
      user_already_exists: "Ja existe uma conta com este e-mail.",
      email_address_invalid: "E-mail invalido ou de dominio nao aceito.",
      weak_password: "Senha fraca demais. Use ao menos 8 caracteres.",
      over_email_send_rate_limit:
        "Limite de e-mails do Supabase atingido. Desative 'Confirm email' no dashboard ou aguarde.",
    };
    return {
      error:
        (error?.code && messages[error.code]) ??
        "Nao foi possivel criar a conta. Tente novamente.",
    };
  }

  const userId = data.user.id;

  await db.transaction(async (tx) => {
    await tx.insert(users).values({ id: userId, email, name });

    if (invitedHouseholdId && inviteId) {
      await tx.insert(householdMembers).values({
        householdId: invitedHouseholdId,
        userId,
        role: HouseholdRole.MEMBER,
      });
      await tx
        .update(invites)
        .set({ usedBy: userId, usedAt: new Date() })
        .where(eq(invites.id, inviteId));
    } else {
      const [household] = await tx
        .insert(households)
        .values({ name: `Família de ${name}` })
        .returning({ id: households.id });
      await tx.insert(householdMembers).values({
        householdId: household.id,
        userId,
        role: HouseholdRole.OWNER,
      });
    }
  });

  // Sem sessao (e-mail de confirmacao ainda ativo no Supabase) → login manual.
  if (!data.session) {
    redirect("/login");
  }

  redirect("/");
}

export async function signIn(
  _prev: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "E-mail ou senha incorretos." };
  }

  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
