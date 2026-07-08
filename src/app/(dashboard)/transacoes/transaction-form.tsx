"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { TransactionType } from "@/lib/db/schema";
import type { TransactionActionState } from "./actions";
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

export type Option = { id: string; name: string };

export type TransactionFormValues = {
  transactionId?: string;
  type?: TransactionType;
  amountInput?: string;
  description?: string;
  date?: string;
  accountId?: string;
  categoryId?: string | null;
  transferToAccountId?: string | null;
};

const TYPE_LABELS: Record<TransactionType, string> = {
  [TransactionType.EXPENSE]: "Despesa",
  [TransactionType.INCOME]: "Receita",
  [TransactionType.TRANSFER]: "Transferência",
};

export function TransactionForm({
  action,
  initial,
  accounts,
  categories,
  submitLabel,
  onSuccess,
}: {
  action: (
    prev: TransactionActionState,
    formData: FormData
  ) => Promise<TransactionActionState>;
  initial?: TransactionFormValues;
  accounts: Option[];
  categories: Option[];
  submitLabel: string;
  onSuccess: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [type, setType] = useState<TransactionType>(initial?.type ?? TransactionType.EXPENSE);
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current && !pending && state.error === null) onSuccess();
  }, [pending, state, onSuccess]);

  return (
    <form
      action={formAction}
      onSubmit={() => {
        submitted.current = true;
      }}
      className="flex flex-col gap-4"
    >
      {initial?.transactionId && (
        <input type="hidden" name="transactionId" value={initial.transactionId} />
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="tx-type">Tipo</Label>
        <input type="hidden" name="type" value={type} />
        <Select value={type} onValueChange={(v) => setType(v as TransactionType)}>
          <SelectTrigger id="tx-type" className="w-full">
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

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="tx-amount">Valor (R$)</Label>
          <Input
            id="tx-amount"
            name="amount"
            inputMode="decimal"
            required
            defaultValue={initial?.amountInput}
            placeholder="230,00"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="tx-date">Data</Label>
          <Input id="tx-date" name="date" type="date" required defaultValue={initial?.date} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="tx-description">Descrição</Label>
        <Input
          id="tx-description"
          name="description"
          defaultValue={initial?.description}
          placeholder="Ex: mercado"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="tx-account">
          {type === TransactionType.TRANSFER ? "Da conta" : "Conta"}
        </Label>
        <Select name="accountId" defaultValue={initial?.accountId} required>
          <SelectTrigger id="tx-account" className="w-full">
            <SelectValue placeholder="Escolha a conta" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {type === TransactionType.TRANSFER ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="tx-to">Para a conta</Label>
          <Select
            name="transferToAccountId"
            defaultValue={initial?.transferToAccountId ?? undefined}
            required
          >
            <SelectTrigger id="tx-to" className="w-full">
              <SelectValue placeholder="Conta de destino" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="tx-category">Categoria</Label>
          <Select name="categoryId" defaultValue={initial?.categoryId ?? "none"}>
            <SelectTrigger id="tx-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem categoria</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
