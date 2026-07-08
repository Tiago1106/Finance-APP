"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { AccountType } from "@/lib/db/schema";
import type { AccountActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TYPE_LABELS: Record<AccountType, string> = {
  [AccountType.BANK]: "Conta bancária",
  [AccountType.WALLET]: "Dinheiro / carteira",
  [AccountType.CREDIT_CARD]: "Cartão de crédito",
};

export type AccountFormValues = {
  accountId?: string;
  name?: string;
  type?: AccountType;
  closingDay?: number | null;
  dueDay?: number | null;
  creditLimitInput?: string;
};

export function AccountForm({
  action,
  initial,
  submitLabel,
  onSuccess,
}: {
  action: (prev: AccountActionState, formData: FormData) => Promise<AccountActionState>;
  initial?: AccountFormValues;
  submitLabel: string;
  onSuccess: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [type, setType] = useState<AccountType>(initial?.type ?? AccountType.BANK);
  const isEdit = Boolean(initial?.accountId);
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current && !pending && state.error === null) {
      onSuccess();
    }
  }, [pending, state, onSuccess]);

  return (
    <form
      action={formAction}
      onSubmit={() => {
        submitted.current = true;
      }}
      className="flex flex-col gap-4"
    >
      {initial?.accountId && <input type="hidden" name="accountId" value={initial.accountId} />}

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Nome</Label>
        <Input
          id="name"
          name="name"
          required
          defaultValue={initial?.name}
          placeholder="Ex: Nubank"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="type">Tipo</Label>
        {/* Tipo nao muda apos a criacao: transacoes e faturas dependem dele. */}
        <input type="hidden" name="type" value={type} />
        <Select
          value={type}
          onValueChange={(v) => setType(v as AccountType)}
          disabled={isEdit}
        >
          <SelectTrigger id="type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {type === AccountType.CREDIT_CARD && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="closingDay">Dia de fechamento</Label>
              <Input
                id="closingDay"
                name="closingDay"
                type="number"
                min={1}
                max={31}
                required
                defaultValue={initial?.closingDay ?? undefined}
                placeholder="28"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="dueDay">Dia de vencimento</Label>
              <Input
                id="dueDay"
                name="dueDay"
                type="number"
                min={1}
                max={31}
                required
                defaultValue={initial?.dueDay ?? undefined}
                placeholder="5"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="creditLimit">Limite (opcional)</Label>
            <Input
              id="creditLimit"
              name="creditLimit"
              inputMode="decimal"
              defaultValue={initial?.creditLimitInput}
              placeholder="Ex: 5.000,00"
            />
          </div>
        </>
      )}

      {state.error && (
        <p role="alert" className="text-sm text-expense">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Salvando..." : submitLabel}
      </Button>
    </form>
  );
}
