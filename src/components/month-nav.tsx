import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addMonthsRef,
  monthLabel,
  monthParamValue,
  type MonthRef,
} from "@/lib/queries/common";
import { Button } from "@/components/ui/button";

/** Navegacao ‹ mes › preservando os demais searchParams. */
export function MonthNav({
  month,
  basePath,
  extraParams = {},
}: {
  month: MonthRef;
  basePath: string;
  extraParams?: Record<string, string>;
}) {
  const href = (ref: MonthRef) => {
    const params = new URLSearchParams({ ...extraParams, m: monthParamValue(ref) });
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="flex items-center gap-1">
      <Button asChild variant="ghost" size="icon" className="size-8">
        <Link href={href(addMonthsRef(month, -1))} aria-label="Mês anterior">
          <ChevronLeft className="size-4" />
        </Link>
      </Button>
      <span className="min-w-32 text-center text-sm">{monthLabel(month)}</span>
      <Button asChild variant="ghost" size="icon" className="size-8">
        <Link href={href(addMonthsRef(month, 1))} aria-label="Próximo mês">
          <ChevronRight className="size-4" />
        </Link>
      </Button>
    </div>
  );
}
