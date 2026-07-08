"use client";

import { useActionState, useCallback, useState } from "react";
import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { AccountType } from "@/lib/db/schema";
import { centsToBRLInput } from "@/lib/core/money";
import { archiveAccount, unarchiveAccount, updateAccount } from "./actions";
import { AccountForm } from "./account-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type AccountRowData = {
  id: string;
  name: string;
  type: AccountType;
  closingDay: number | null;
  dueDay: number | null;
  creditLimitCents: number | null;
  archived: boolean;
};

function ArchiveToggle({ account }: { account: AccountRowData }) {
  const action = account.archived ? unarchiveAccount : archiveAccount;
  const [state, formAction, pending] = useActionState(action, { error: null });

  return (
    <form action={formAction}>
      <input type="hidden" name="accountId" value={account.id} />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        disabled={pending}
        aria-label={account.archived ? `Desarquivar ${account.name}` : `Arquivar ${account.name}`}
        className="size-8 text-muted-foreground hover:text-foreground"
      >
        {account.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
      </Button>
      {state.error && <span className="sr-only">{state.error}</span>}
    </form>
  );
}

export function AccountRowActions({ account }: { account: AccountRowData }) {
  const [editOpen, setEditOpen] = useState(false);
  const closeEdit = useCallback(() => setEditOpen(false), []);

  return (
    <div className="flex items-center gap-1">
      {!account.archived && (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Editar ${account.name}`}
              className="size-8 text-muted-foreground hover:text-foreground"
            >
              <Pencil className="size-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Editar conta</DialogTitle>
              <DialogDescription>O tipo não pode ser alterado após a criação.</DialogDescription>
            </DialogHeader>
            <AccountForm
              action={updateAccount}
              submitLabel="Salvar"
              onSuccess={closeEdit}
              initial={{
                accountId: account.id,
                name: account.name,
                type: account.type,
                closingDay: account.closingDay,
                dueDay: account.dueDay,
                creditLimitInput:
                  account.creditLimitCents !== null
                    ? centsToBRLInput(account.creditLimitCents)
                    : undefined,
              }}
            />
          </DialogContent>
        </Dialog>
      )}
      <ArchiveToggle account={account} />
    </div>
  );
}
