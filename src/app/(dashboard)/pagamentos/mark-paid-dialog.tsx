"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { centsToBRLInput } from "@/lib/core/money";
import { markCommitmentPaid, type PayActionState } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type PayerOption = { id: string; name: string };

export function MarkPaidButton({
  kind,
  refId,
  name,
  prefillCents,
  defaultAccountId,
  payerAccounts,
}: {
  kind: "bill" | "invoice";
  refId: string;
  name: string;
  /** Valor pre-preenchido (fixo/fatura); null = conta variavel, campo aberto. */
  prefillCents: number | null;
  defaultAccountId: string | null;
  payerAccounts: PayerOption[];
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [state, formAction, pending] = useActionState<PayActionState, FormData>(
    markCommitmentPaid,
    { error: null }
  );
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current && !pending && state.error === null) close();
  }, [pending, state, close]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs">
          Marcar como paga
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Pagar {name}</DialogTitle>
          <DialogDescription>
            {kind === "invoice"
              ? "Gera uma transferência da conta escolhida para o cartão."
              : "Lança a despesa e marca a pendência como paga."}
          </DialogDescription>
        </DialogHeader>
        <form
          action={formAction}
          onSubmit={() => {
            submitted.current = true;
          }}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="refId" value={refId} />
          <div className="flex flex-col gap-2">
            <Label htmlFor={`pay-amount-${refId}`}>Valor (R$)</Label>
            <Input
              id={`pay-amount-${refId}`}
              name="amount"
              inputMode="decimal"
              required
              defaultValue={prefillCents !== null ? centsToBRLInput(prefillCents) : ""}
              placeholder="187,00"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`pay-account-${refId}`}>Pagar com</Label>
            <Select name="accountId" defaultValue={defaultAccountId ?? undefined} required>
              <SelectTrigger id={`pay-account-${refId}`} className="w-full">
                <SelectValue placeholder="Escolha a conta" />
              </SelectTrigger>
              <SelectContent>
                {payerAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {state.error && (
            <p role="alert" className="text-sm text-expense">
              {state.error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? "Pagando..." : "Confirmar pagamento"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
