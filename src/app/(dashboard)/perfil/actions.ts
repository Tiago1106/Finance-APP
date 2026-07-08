"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { generateInviteCode } from "@/lib/core/invites";
import { getSessionContext } from "@/lib/auth/session";

export type LinkCodeState = {
  error: string | null;
};

const LINK_CODE_TTL_MS = 60 * 60 * 1000; // 1 hora

export async function generateTelegramLinkCode(
  _prev: LinkCodeState,
  _formData: FormData
): Promise<LinkCodeState> {
  const session = await getSessionContext();

  const code = generateInviteCode(new Uint8Array(randomBytes(16)));
  if (!code.ok) {
    return { error: "Não foi possível gerar o código. Tente novamente." };
  }

  await db
    .update(users)
    .set({
      telegramLinkCode: code.data,
      telegramLinkCodeExpiresAt: new Date(Date.now() + LINK_CODE_TTL_MS),
    })
    .where(eq(users.id, session.userId));

  revalidatePath("/perfil");
  return { error: null };
}

export async function unlinkTelegram(
  _prev: LinkCodeState,
  _formData: FormData
): Promise<LinkCodeState> {
  const session = await getSessionContext();
  await db
    .update(users)
    .set({ telegramUserId: null, telegramLinkCode: null, telegramLinkCodeExpiresAt: null })
    .where(eq(users.id, session.userId));
  revalidatePath("/perfil");
  return { error: null };
}
