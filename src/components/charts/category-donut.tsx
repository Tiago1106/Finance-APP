"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatBRL } from "@/lib/format";

export type DonutSlice = { name: string; value: number };

// Paleta categorica derivada da marca (CLAUDE.md secao 6) — nunca hex fixo.
const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function CategoryDonut({ data }: { data: DonutSlice[] }) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nenhum gasto no mês ainda.
      </p>
    );
  }

  const total = data.reduce((a, b) => a + b.value, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="60%"
              outerRadius="90%"
              paddingAngle={2}
              stroke="var(--card)"
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => formatBRL(Number(value))}
              contentStyle={{
                backgroundColor: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                color: "var(--popover-foreground)",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm">
        {data.map((slice, i) => (
          <li key={slice.name} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="flex-1 truncate">{slice.name}</span>
            <span className="tabular-nums text-muted-foreground">
              {Math.round((slice.value / total) * 100)}%
            </span>
            <span className="tabular-nums">{formatBRL(slice.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
