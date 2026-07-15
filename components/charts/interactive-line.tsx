"use client";

/**
 * Gráfico de linha/área interativo. Mesma geometria SVG dos gráficos originais
 * (viewBox 640×190, grid em 25/50/75%), agora com hover → crosshair vertical +
 * pontos nos valores + tooltip, e (opcional) legenda clicável para ligar/desligar
 * séries (Fase 2). Cada série tem eixo-y implícito próprio (escala independente),
 * como nos designs atuais (Meta: investimento×cliques; IG: seguidores). Recebe
 * dados JÁ computados no server como props serializáveis — zero cálculo pesado,
 * zero dependência externa.
 */
import { useState } from "react";

import { ChartTooltip, TooltipRow } from "./chart-tooltip";
import { brl, int } from "./format";

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** Preenche a área abaixo da curva (investimento, seguidores). */
  area?: boolean;
  /** Linha tracejada (cliques). */
  dashed?: boolean;
  /** Base da escala: `zero` (padrão) ou `min` (curva de seguidores). */
  baseline?: "zero" | "min";
  format?: "brl" | "int";
}

export interface LinePoint {
  /** Rótulo do eixo x (data já formatada) exibido no tooltip. */
  label: string;
  values: Record<string, number>;
}

const W = 640;
const H = 190;
const PAD = 10;

export function InteractiveLineChart({
  points,
  series,
  ariaLabel,
  legend = false,
}: {
  points: LinePoint[];
  series: LineSeries[];
  ariaLabel: string;
  /** Mostra uma legenda clicável que liga/desliga cada série. */
  legend?: boolean;
}) {
  const n = points.length;
  const [hover, setHover] = useState<{ i: number; width: number } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      // Nunca esconde a última série visível.
      else if (series.length - prev.size > 1) next.add(key);
      return next;
    });

  const visible = series.filter((s) => !hidden.has(s.key));

  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);

  // Escala independente por série (eixos-y implícitos), indexada por key.
  const scale: Record<string, (v: number) => number> = {};
  for (const s of series) {
    const vals = points.map((p) => p.values[s.key] ?? 0);
    const max = Math.max(1, ...vals);
    const min = s.baseline === "min" ? Math.min(...vals) : 0;
    const span = Math.max(1, max - min);
    scale[s.key] = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);
  }

  const linePath = (s: LineSeries) =>
    points
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${x(i).toFixed(1)},${scale[s.key](p.values[s.key] ?? 0).toFixed(1)}`,
      )
      .join(" ");

  const fmt = (s: LineSeries, v: number) =>
    s.format === "brl" ? brl.format(v) : int.format(v);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const frac = (e.clientX - rect.left) / rect.width;
    const i =
      n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
    setHover({ i, width: rect.width });
  };

  const hoveredPoint = hover ? points[hover.i] : null;
  const pxHeight = hover ? (hover.width * H) / W : 0;
  const tipLeft = hover
    ? Math.max(48, Math.min(hover.width - 48, (x(hover.i) / W) * hover.width))
    : 0;
  // Ancoragem vertical: topo do maior valor das séries visíveis no índice.
  const tipTop =
    hover && hoveredPoint && visible.length
      ? (Math.min(
          ...visible.map((s) => scale[s.key](hoveredPoint.values[s.key] ?? 0)),
        ) /
          H) *
        pxHeight
      : 0;

  return (
    <div>
      {legend ? (
        <div className="mb-2 flex flex-wrap justify-end gap-3 text-xs">
          {series.map((s) => {
            const off = hidden.has(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggle(s.key)}
                className={`inline-flex items-center gap-1.5 transition-opacity ${off ? "opacity-40" : ""}`}
                aria-pressed={!off}
              >
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ background: s.color }}
                />
                <span
                  className={`text-muted-foreground ${off ? "line-through" : ""}`}
                >
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div
        className="relative"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
          <defs>
            {visible
              .filter((s) => s.area)
              .map((s) => (
                <linearGradient
                  key={s.key}
                  id={`larea-${s.key}`}
                  x1="0"
                  x2="0"
                  y1="0"
                  y2="1"
                >
                  <stop offset="0" stopColor={s.color} stopOpacity="0.28" />
                  <stop offset="1" stopColor={s.color} stopOpacity="0" />
                </linearGradient>
              ))}
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1="0"
              y1={H * f}
              x2={W}
              y2={H * f}
              stroke="var(--border)"
              strokeWidth="1"
            />
          ))}
          {visible.map((s) => {
            const d = linePath(s);
            return (
              <g key={s.key}>
                {s.area ? (
                  <path d={`${d} L${W},${H} L0,${H} Z`} fill={`url(#larea-${s.key})`} />
                ) : null}
                <path
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.area ? 2.5 : 2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={s.dashed ? "4 3" : undefined}
                />
              </g>
            );
          })}
          {hover ? (
            <g pointerEvents="none">
              <line
                x1={x(hover.i)}
                y1={PAD}
                x2={x(hover.i)}
                y2={H}
                stroke="var(--muted-foreground)"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.6"
              />
              {visible.map((s) => (
                <circle
                  key={s.key}
                  cx={x(hover.i)}
                  cy={scale[s.key](points[hover.i].values[s.key] ?? 0)}
                  r="4"
                  fill={s.color}
                  stroke="var(--card)"
                  strokeWidth="1.5"
                />
              ))}
            </g>
          ) : n > 0 ? (
            // Ponto final estático — preserva o design quando não há hover.
            visible.map((s) => (
              <circle
                key={s.key}
                cx={x(n - 1)}
                cy={scale[s.key](points[n - 1].values[s.key] ?? 0)}
                r={s.area ? 4 : 3.5}
                fill={s.color}
              />
            ))
          ) : null}
        </svg>
        {hover && hoveredPoint && visible.length ? (
          <ChartTooltip left={tipLeft} top={tipTop}>
            <p className="mb-1 font-medium text-foreground">{hoveredPoint.label}</p>
            <div className="flex flex-col gap-0.5">
              {visible.map((s) => (
                <TooltipRow
                  key={s.key}
                  color={s.color}
                  label={s.label}
                  value={fmt(s, hoveredPoint.values[s.key] ?? 0)}
                />
              ))}
            </div>
          </ChartTooltip>
        ) : null}
      </div>
    </div>
  );
}
