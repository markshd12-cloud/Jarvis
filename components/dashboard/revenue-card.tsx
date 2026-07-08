"use client";

import { useId, useMemo, useState } from "react";
import { ArrowUpRightIcon, RotateCcwIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const W = 320;
const H = 150;
const PAD = 12;

interface Pt {
  x: number;
  y: number;
}

/** Catmull-Rom → Bézier cúbico: curva suave passando por todos os pontos. */
function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

const sharpPath = (pts: Pt[]): string =>
  pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x},${p.y}`).join(" ");

/**
 * Card de receita com linha de tendência (recriação do componente esperado).
 * Interativo: toggle de curva (suave/reta), slider que inclina a tendência e
 * Replay que re-anima o traçado. Self-contained (SVG inline), cor via `--primary`.
 */
export function RevenueCard({
  label = "Receita",
  value,
  data,
  className,
}: {
  label?: string;
  value: string;
  /** Série base (será inclinada pelo slider de tendência). */
  data: number[];
  className?: string;
}) {
  const gradId = useId();
  const [smooth, setSmooth] = useState(true);
  const [trend, setTrend] = useState(200);
  const [replay, setReplay] = useState(0);

  const { line, area, end } = useMemo(() => {
    // Aplica a tendência: inclina a série para cima proporcional à posição.
    const n = data.length;
    const adjusted = data.map(
      (v, i) => v * (1 + (trend / 100) * (i / Math.max(1, n - 1))),
    );
    const min = Math.min(...adjusted);
    const max = Math.max(...adjusted);
    const span = max - min || 1;

    const pts: Pt[] = adjusted.map((v, i) => ({
      x: PAD + (i / Math.max(1, n - 1)) * (W - PAD * 2),
      y: H - PAD - ((v - min) / span) * (H - PAD * 2),
    }));

    const linePath = smooth ? smoothPath(pts) : sharpPath(pts);
    const last = pts[pts.length - 1];
    const areaPath = `${linePath} L ${last.x},${H} L ${pts[0].x},${H} Z`;
    return { line: linePath, area: areaPath, end: last };
  }, [data, trend, smooth]);

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 text-card-foreground",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <span className="sr-only">{label}</span>
        <div />
        <button
          type="button"
          onClick={() => setReplay((r) => r + 1)}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-card-foreground transition-colors hover:bg-accent"
        >
          <RotateCcwIcon className="h-3.5 w-3.5" />
          Replay
        </button>
      </div>

      {/* Painel do gráfico */}
      <div className="rounded-xl border border-border bg-background/40 p-4">
        <div className="flex items-start justify-between">
          <div className="flex flex-col">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {label}
            </span>
            <span className="text-3xl font-bold tracking-tight">{value}</span>
          </div>
          <span className="flex items-center gap-1 text-sm font-medium text-primary">
            <ArrowUpRightIcon className="h-4 w-4" />
            {trend}%
          </span>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="mt-2 h-32 w-full overflow-visible text-primary"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${label}: ${value}, tendência ${trend}%`}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          <path d={area} fill={`url(#${gradId})`} />
          {/* key={replay} remonta o path → reinicia a animação de traçado. */}
          <path
            key={replay}
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            style={{
              strokeDasharray: 1,
              strokeDashoffset: 1,
              animation: "revenue-draw 1.1s ease-out forwards",
            }}
          />
          <circle cx={end.x} cy={end.y} r={7} fill="currentColor" opacity={0.25} />
          <circle cx={end.x} cy={end.y} r={4} fill="currentColor" />
        </svg>
      </div>

      {/* Controles */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Curva
          </span>
          <div className="inline-flex rounded-lg bg-muted p-0.5">
            {(
              [
                ["Suave", true],
                ["Reta", false],
              ] as const
            ).map(([txt, val]) => (
              <button
                key={txt}
                type="button"
                onClick={() => setSmooth(val)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                  smooth === val
                    ? "bg-card text-card-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {txt}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-1 items-center gap-3">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Tendência
          </span>
          <input
            type="range"
            min={0}
            max={300}
            value={trend}
            onChange={(e) => setTrend(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
          />
          <span className="w-12 text-right text-sm font-medium tabular-nums">
            +{trend}%
          </span>
        </label>
      </div>

      <style>{`@keyframes revenue-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }`}</style>
    </div>
  );
}
