import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  HouseholdRole,
  householdMembers,
  households,
  invites,
  users,
} from "@/lib/db/schema";
import { getSessionContext } from "@/lib/auth/session";
import { CopyCodeButton } from "./copy-code-button";
import { InviteButton } from "./invite-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export default async function FamiliaPage() {
  const session = await getSessionContext();

  const [household] = await db
    .select({ name: households.name })
    .from(households)
    .where(eq(households.id, session.householdId))
    .limit(1);

  const members = await db
    .select({
      id: householdMembers.id,
      role: householdMembers.role,
      name: users.name,
      email: users.email,
    })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, session.householdId));

  const isOwner = session.role === HouseholdRole.OWNER;

  const now = new Date();
  const householdInvites = isOwner
    ? await db
        .select()
        .from(invites)
        .where(eq(invites.householdId, session.householdId))
        .orderBy(desc(invites.createdAt))
        .limit(10)
    : [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Minha Família</h1>

      <Card>
        <CardHeader>
          <CardTitle>{household?.name ?? "Família"}</CardTitle>
          <CardDescription>Membros com acesso completo aos dados financeiros.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-between gap-2">
              <div className="flex flex-col">
                <span className="text-sm">{member.name ?? member.email}</span>
                <span className="text-xs text-muted-foreground">{member.email}</span>
              </div>
              <Badge variant={member.role === HouseholdRole.OWNER ? "default" : "secondary"}>
                {member.role === HouseholdRole.OWNER ? "Dono" : "Membro"}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Convidar membro</CardTitle>
            <CardDescription>
              Gere um código e envie para a pessoa. Ele vale por 48 horas e só pode ser usado
              uma vez, no cadastro.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <InviteButton />
            {householdInvites.length > 0 && (
              <>
                <Separator />
                <div className="flex flex-col gap-2">
                  {householdInvites.map((invite) => {
                    const used = invite.usedAt !== null;
                    const expired = !used && invite.expiresAt.getTime() <= now.getTime();
                    return (
                      <div key={invite.id} className="flex items-center justify-between gap-2">
                        <div className="flex flex-col">
                          <span className="font-mono text-sm tabular-nums">{invite.code}</span>
                          <span className="text-xs text-muted-foreground">
                            {used
                              ? `Usado em ${formatDateTime(invite.usedAt!)}`
                              : expired
                                ? `Expirado em ${formatDateTime(invite.expiresAt)}`
                                : `Expira em ${formatDateTime(invite.expiresAt)}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          {!used && !expired && <CopyCodeButton code={invite.code} />}
                          <Badge
                            variant={used || expired ? "outline" : "secondary"}
                            className={used || expired ? "text-muted-foreground" : "text-income"}
                          >
                            {used ? "Usado" : expired ? "Expirado" : "Ativo"}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
