"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Option } from "./transaction-form";

const ALL = "all";

export function FiltersBar({
  accounts,
  categories,
  members,
}: {
  accounts: Option[];
  categories: Option[];
  members: Option[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === ALL || value === "") next.delete(key);
    else next.set(key, value);
    router.push(`/transacoes?${next.toString()}`);
  };

  const filterSelect = (
    key: string,
    placeholder: string,
    options: Option[],
    extra?: { value: string; label: string }[]
  ) => (
    <Select value={params.get(key) ?? ALL} onValueChange={(v) => setParam(key, v)}>
      <SelectTrigger className="h-8 w-auto min-w-28 text-xs" size="sm">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {(extra ?? []).map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        defaultValue={params.get("q") ?? ""}
        placeholder="Buscar..."
        className="h-8 w-36 text-xs"
        onKeyDown={(e) => {
          if (e.key === "Enter") setParam("q", e.currentTarget.value.trim());
        }}
      />
      {filterSelect("c", "Categoria", categories)}
      {filterSelect("a", "Conta", accounts)}
      {filterSelect("p", "Pessoa", members)}
      {filterSelect("t", "Tipo", [], [
        { value: "expense", label: "Despesa" },
        { value: "income", label: "Receita" },
        { value: "transfer", label: "Transferência" },
      ])}
    </div>
  );
}
