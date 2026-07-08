"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";
import { centsToBRLInput } from "@/lib/core/money";
import {
  mergeCategories,
  renameCategory,
  setBudget,
  type CategoryActionState,
} from "./actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CategoryRowData = {
  id: string;
  name: string;
  budgetCents: number | null;
  transactionCount: number;
};

type DialogKind = "rename" | "merge" | "budget" | null;

function ActionDialogForm({
  action,
  submitLabel,
  onSuccess,
  children,
}: {
  action: (prev: CategoryActionState, formData: FormData) => Promise<CategoryActionState>;
  submitLabel: string;
  onSuccess: () => void;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
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
      {children}
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

export function CategoryRowMenu({
  category,
  otherCategories,
}: {
  category: CategoryRowData;
  otherCategories: { id: string; name: string }[];
}) {
  const [dialog, setDialog] = useState<DialogKind>(null);
  const close = () => setDialog(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Ações de ${category.name}`}
            className="size-8 text-muted-foreground hover:text-foreground"
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("rename")}>Renomear</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("budget")}>
            Ajustar orçamento
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setDialog("merge")}
            disabled={otherCategories.length === 0}
          >
            Mesclar em outra
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Renomear */}
      <Dialog open={dialog === "rename"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Renomear categoria</DialogTitle>
            <DialogDescription>Vale para todos os lançamentos da família.</DialogDescription>
          </DialogHeader>
          <ActionDialogForm action={renameCategory} submitLabel="Renomear" onSuccess={close}>
            <input type="hidden" name="categoryId" value={category.id} />
            <div className="flex flex-col gap-2">
              <Label htmlFor={`rename-${category.id}`}>Novo nome</Label>
              <Input
                id={`rename-${category.id}`}
                name="name"
                required
                defaultValue={category.name}
              />
            </div>
          </ActionDialogForm>
        </DialogContent>
      </Dialog>

      {/* Orcamento */}
      <Dialog open={dialog === "budget"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Orçamento mensal — {category.name}</DialogTitle>
            <DialogDescription>
              Limite de gasto da família nesta categoria. Deixe vazio para remover.
            </DialogDescription>
          </DialogHeader>
          <ActionDialogForm action={setBudget} submitLabel="Salvar orçamento" onSuccess={close}>
            <input type="hidden" name="categoryId" value={category.id} />
            <div className="flex flex-col gap-2">
              <Label htmlFor={`budget-${category.id}`}>Valor (R$)</Label>
              <Input
                id={`budget-${category.id}`}
                name="amount"
                inputMode="decimal"
                defaultValue={
                  category.budgetCents !== null ? centsToBRLInput(category.budgetCents) : ""
                }
                placeholder="Ex: 1.200,00"
              />
            </div>
          </ActionDialogForm>
        </DialogContent>
      </Dialog>

      {/* Mesclar */}
      <Dialog open={dialog === "merge"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Mesclar {category.name}</DialogTitle>
            <DialogDescription>
              Move {category.transactionCount}{" "}
              {category.transactionCount === 1 ? "lançamento" : "lançamentos"} para a categoria
              escolhida e apaga &quot;{category.name}&quot;. Não dá para desfazer.
            </DialogDescription>
          </DialogHeader>
          <ActionDialogForm action={mergeCategories} submitLabel="Mesclar" onSuccess={close}>
            <input type="hidden" name="sourceId" value={category.id} />
            <div className="flex flex-col gap-2">
              <Label htmlFor={`merge-${category.id}`}>Mover tudo para</Label>
              <Select name="targetId" required>
                <SelectTrigger id={`merge-${category.id}`} className="w-full">
                  <SelectValue placeholder="Escolha a categoria de destino" />
                </SelectTrigger>
                <SelectContent>
                  {otherCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </ActionDialogForm>
        </DialogContent>
      </Dialog>
    </>
  );
}
