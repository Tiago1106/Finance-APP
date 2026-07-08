import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSessionContext } from "@/lib/auth/session";
import { CopyCodeButton } from "../familia/copy-code-button";
import { GenerateLinkCodeButton, UnlinkTelegramButton } from "./link-telegram-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PerfilPage() {
  const session = await getSessionContext();

  const [user] = await db
    .select({
      telegramUserId: users.telegramUserId,
      linkCode: users.telegramLinkCode,
      linkCodeExpiresAt: users.telegramLinkCodeExpiresAt,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  const linked = user.telegramUserId !== null;
  const activeCode =
    !linked && user.linkCode && user.linkCodeExpiresAt && user.linkCodeExpiresAt > new Date()
      ? user.linkCode
      : null;

  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">Perfil</h1>

      <Card>
        <CardHeader>
          <CardTitle>Seus dados</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <span>{session.name ?? "—"}</span>
          <span className="text-muted-foreground">{session.email}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Telegram</CardTitle>
            <Badge variant={linked ? "secondary" : "outline"} className={linked ? "text-income" : ""}>
              {linked ? "Vinculado" : "Não vinculado"}
            </Badge>
          </div>
          <CardDescription>
            O assistente no Telegram é a forma mais rápida de lançar gastos: &quot;mercado 230
            no nubank&quot;.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {linked ? (
            <>
              <p className="text-sm text-muted-foreground">
                Seu Telegram está vinculado e pronto para uso. Se trocou de conta no Telegram,
                refaça o vínculo.
              </p>
              <UnlinkTelegramButton />
            </>
          ) : (
            <>
              {activeCode && (
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-lg tabular-nums">{activeCode}</span>
                    <CopyCodeButton code={`/start ${activeCode}`} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Abra o chat do bot no Telegram e envie{" "}
                    <span className="font-mono">/start {activeCode}</span> (válido por 1 hora).
                  </p>
                  {botUsername && (
                    <a
                      href={`https://t.me/${botUsername}?start=${activeCode}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:text-primary-hover"
                    >
                      Abrir o bot no Telegram →
                    </a>
                  )}
                </div>
              )}
              <GenerateLinkCodeButton hasCode={activeCode !== null} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
