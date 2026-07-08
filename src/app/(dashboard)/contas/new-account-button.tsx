"use client";

import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { createAccount } from "./actions";
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

export function NewAccountButton() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Nova conta
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova conta</DialogTitle>
          <DialogDescription>
            Conta bancária, dinheiro físico ou cartão de crédito.
          </DialogDescription>
        </DialogHeader>
        <AccountForm action={createAccount} submitLabel="Criar conta" onSuccess={close} />
      </DialogContent>
    </Dialog>
  );
}
