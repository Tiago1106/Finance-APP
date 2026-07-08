"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard indisponivel (ex: contexto sem HTTPS) — sem feedback.
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleCopy}
      aria-label={copied ? "Código copiado" : `Copiar código ${code}`}
      className="size-8 text-muted-foreground hover:text-foreground"
    >
      {copied ? <Check className="size-4 text-income" /> : <Copy className="size-4" />}
    </Button>
  );
}
