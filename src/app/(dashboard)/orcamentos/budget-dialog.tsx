"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { centsToBRLInput } from "@/lib/core/money";
import { setBudget, type CategoryActionState } from "../categorias/actions";
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

function BudgetForm({
  categoryId,
  currentCents,
  onSuccess,
}: {
  categoryId: string;
  currentCents: number | null;
  onSuccess: () => void;
}) {
  const [state, formAction, pending] = useActionState<CategoryActionState, FormData>(
    setBudget,
    { error: null }
  );
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
      <input type="hidden" name="categoryId" value={categoryId} />
      <div className="flex flex-col gap-2">
        <Label htmlFor={`budget-${categoryId}`}>Limite mensal (R$)</Label>
        <Input
          id={`budget-${categoryId}`}
          name="amount"
          inputMode="decimal"
          defaultValue={currentCents !== null ? centsToBRLInput(currentCents) : ""}
          placeholder="Ex: 1.200,00"
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-expense">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Salvar"}
      </Button>
    </form>
  );
}

export function EditBudgetButton({
  categoryId,
  categoryName,
  currentCents,
}: {
  categoryId: string;
  categoryName: string;
  currentCents: number | null;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Ajustar orçamento de ${categoryName}`}
          className="size-8 text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Orçamento — {categoryName}</DialogTitle>
          <DialogDescription>Deixe vazio para remover o limite.</DialogDescription>
        </DialogHeader>
        <BudgetForm categoryId={categoryId} currentCents={currentCents} onSuccess={close} />
      </DialogContent>
    </Dialog>
  );
}
