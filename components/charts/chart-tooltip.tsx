"use client";

/**
 * Tooltip flutuante compartilhado pelos gráficos interativos. Presentational e
 * leve (sem libs): um card posicionado em coordenadas de pixel dentro de um
 * container `relative`. `pointer-events-none` garante que não rouba o hover do
 * SVG abaixo. Usa tokens de tema (`bg-card`/`border`/`text-foreground`) → claro
 * e escuro automáticos.
 */
import type { ReactNode } from "react";

export function ChartTooltip({
  left,
  top,
  children,
}: {
  left: number;
  top: number;
  children: ReactNode;
}) {
  return (
    <div
      className="pointer-events-none absolute z-20 min-w-[7rem] whitespace-nowrap rounded-lg border border-border bg-card/95 px-2.5 py-1.5 text-xs shadow-md backdrop-blur-sm"
      style={{ left, top, transform: "translate(-50%, calc(-100% - 10px))" }}
    >
      {children}
    </div>
  );
}

/** Linha do tooltip: bolinha de cor + rótulo à esquerda, valor à direita. */
export function TooltipRow({
  color,
  label,
  value,
}: {
  color?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {color ? (
        <span
          className="h-2 w-2 flex-none rounded-sm"
          style={{ background: color }}
        />
      ) : null}
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto pl-3 font-semibold tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}
