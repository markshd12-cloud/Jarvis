"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon, TrendingUpIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ActivityBar {
  label: string;
  value: number;
}

export interface ActivitySeries {
  /** Rótulo do período no dropdown (ex.: "Semanal"). */
  period: string;
  bars: ActivityBar[];
}

/**
 * Card de atividade com barras por período (recriação do componente esperado).
 * Self-contained: barras em flex/SVG, animação de subida na montagem, cores só
 * via tokens (`--primary` na barra de pico, `--foreground` nas demais).
 */
export function ActivityCard({
  title = "Atividade",
  value,
  deltaLabel,
  series,
  className,
}: {
  title?: string;
  value: string;
  deltaLabel?: string;
  series: ActivitySeries[];
  className?: string;
}) {
  const [periodIdx, setPeriodIdx] = useState(0);
  const { bars, max } = useMemo(() => {
    const b = series[periodIdx]?.bars ?? [];
    return { bars: b, max: Math.max(1, ...b.map((x) => x.value)) };
  }, [series, periodIdx]);

  return (
    <div
      className={cn(
        "flex flex-col gap-6 rounded-2xl border border-border bg-card p-6 text-card-foreground",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-4">
        <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
        <div className="relative">
          <select
            aria-label="Período"
            value={periodIdx}
            onChange={(e) => setPeriodIdx(Number(e.target.value))}
            className="appearance-none rounded-md bg-transparent py-1 pr-6 pl-1 text-sm font-medium text-muted-foreground outline-none [color-scheme:light_dark] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {series.map((s, i) => (
              <option key={s.period} value={i} className="bg-popover">
                {s.period}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-1 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </header>

      <div className="flex items-end gap-6">
        <div className="flex shrink-0 flex-col">
          <span className="text-5xl leading-none font-bold tracking-tight">
            {value}
          </span>
          {deltaLabel ? (
            <span className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <TrendingUpIcon className="h-4 w-4 text-primary" />
              {deltaLabel}
            </span>
          ) : null}
        </div>

        <ul className="flex h-32 flex-1 items-end justify-between gap-2">
          {bars.map((bar, i) => {
            const isPeak = bar.value === max;
            const heightPct = Math.round((bar.value / max) * 100);
            return (
              <li
                key={`${bar.label}-${i}`}
                className="flex h-full flex-1 flex-col items-center justify-end gap-2"
              >
                <div
                  className={cn(
                    "w-full rounded-md transition-[height] duration-500 ease-out",
                    isPeak ? "bg-primary" : "bg-foreground/80",
                  )}
                  style={{ height: `${heightPct}%` }}
                  title={`${bar.label}: ${bar.value}`}
                />
                <span className="text-xs text-muted-foreground">
                  {bar.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
