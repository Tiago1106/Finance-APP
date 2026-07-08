"use client";

import { useActionState, useCallback, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { centsToBRLInput } from "@/lib/core/money";
import type { TransactionType } from "@/lib/db/schema";
import { createTransaction, deleteTransaction, updateTransaction } from "./actions";
import { TransactionForm, type Option } from "./transaction-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function NewTransactionButton({
  accounts,
  categories,
  defaultDate,
}: {
  accounts: Option[];
  categories: Option[];
  defaultDate: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Novo lançamento
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Novo lançamento</DialogTitle>
          <DialogDescription>
            Alternativa manual ao assistente do Telegram.
          </DialogDescription>
        </DialogHeader>
        <TransactionForm
          action={createTransaction}
          accounts={accounts}
          categories={categories}
          submitLabel="Criar"
          onSuccess={close}
          initial={{ date: defaultDate }}
        />
      </DialogContent>
    </Dialog>
  );
}

export type TransactionRowData = {
  id: string;
  type: TransactionType;
  amountCents: number;
  description: string | null;
  occurredOn: string;
  accountId: string;
  categoryId: string | null;
  transferToAccountId: string | null;
};

export function TransactionRowActions({
  transaction,
  accounts,
  categories,
}: {
  transaction: TransactionRowData;
  accounts: Option[];
  categories: Option[];
}) {
  const [editOpen, setEditOpen] = useState(false);
  const closeEdit = useCallback(() => setEditOpen(false), []);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteTransaction, {
    error: null,
  });

  return (
    <div className="flex items-center gap-0.5">
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Editar lançamento"
            className="size-8 text-muted-foreground hover:text-foreground"
          >
            <Pencil className="size-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Editar lançamento</DialogTitle>
          </DialogHeader>
          <TransactionForm
            action={updateTransaction}
            accounts={accounts}
            categories={categories}
            submitLabel="Salvar"
            onSuccess={closeEdit}
            initial={{
              transactionId: transaction.id,
              type: transaction.type,
              amountInput: centsToBRLInput(transaction.amountCents),
              description: transaction.description ?? "",
              date: transaction.occurredOn,
              accountId: transaction.accountId,
              categoryId: transaction.categoryId,
              transferToAccountId: transaction.transferToAccountId,
            }}
          />
        </DialogContent>
      </Dialog>

      <form
        action={deleteAction}
        onSubmit={(e) => {
          if (!confirm("Apagar este lançamento?")) e.preventDefault();
        }}
      >
        <input type="hidden" name="transactionId" value={transaction.id} />
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          disabled={deletePending}
          aria-label="Apagar lançamento"
          className="size-8 text-muted-foreground hover:text-expense"
        >
          <Trash2 className="size-4" />
        </Button>
        {deleteState.error && <span className="sr-only">{deleteState.error}</span>}
      </form>
    </div>
  );
}
