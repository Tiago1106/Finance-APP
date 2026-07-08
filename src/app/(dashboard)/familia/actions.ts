"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { HouseholdRole, invites } from "@/lib/db/schema";
import { generateInviteCode, inviteExpiresAt } from "@/lib/core/invites";
import { getSessionContext } from "@/lib/auth/session";

export type InviteActionState = {
  error: string | null;
};

export async function createInvite(
  _prev: InviteActionState,
  _formData: FormData
): Promise<InviteActionState> {
  const session = await getSessionContext();

  if (session.role !== HouseholdRole.OWNER) {
    return { error: "Apenas o dono da família pode convidar membros." };
  }

  const code = generateInviteCode(new Uint8Array(randomBytes(16)));
  if (!code.ok) {
    return { error: "Não foi possível gerar o código. Tente novamente." };
  }

  await db.insert(invites).values({
    householdId: session.householdId,
    code: code.data,
    createdBy: session.userId,
    expiresAt: inviteExpiresAt(new Date()),
  });

  revalidatePath("/familia");
  return { error: null };
}
