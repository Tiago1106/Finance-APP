"use client";

import { useActionState } from "react";
import { createInvite, type InviteActionState } from "./actions";
import { Button } from "@/components/ui/button";

const initialState: InviteActionState = { error: null };

export function InviteButton() {
  const [state, formAction, pending] = useActionState(createInvite, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Gerando código..." : "Convidar membro"}
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-expense">
          {state.error}
        </p>
      )}
    </form>
  );
}
