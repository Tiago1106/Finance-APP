"use client";

import { useActionState } from "react";
import { generateTelegramLinkCode, unlinkTelegram, type LinkCodeState } from "./actions";
import { Button } from "@/components/ui/button";

const initialState: LinkCodeState = { error: null };

export function GenerateLinkCodeButton({ hasCode }: { hasCode: boolean }) {
  const [state, formAction, pending] = useActionState(generateTelegramLinkCode, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Gerando..." : hasCode ? "Gerar novo código" : "Vincular Telegram"}
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-expense">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function UnlinkTelegramButton() {
  const [state, formAction, pending] = useActionState(unlinkTelegram, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Button type="submit" variant="outline" size="sm" disabled={pending} className="self-start">
        {pending ? "Desvinculando..." : "Refazer vínculo"}
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-expense">
          {state.error}
        </p>
      )}
    </form>
  );
}
