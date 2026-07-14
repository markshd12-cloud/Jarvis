"use client";

/**
 * Barras agrupadas interativas (fluxo mensal recebido×pago). Mesma geometria do
 * `FluxoChart` original (640×200), agora com hover por coluna → banda de
 * destaque + tooltip com os valores do mês. Dados já computados no server.
 */
import { useState } from "react";

import { ChartTooltip, TooltipRow } from "./chart-tooltip";
import { brl } from "./format";

export interface BarSeries {
  key: string;
  color: string;
  label: string;
}

export interface BarGroup {
  /** Rótulo do eixo x (mês já formatado, ex.: "jul/25"). */
  label: string;
  values: Record<string, number>;
}

const W = 640;
const H = 200;
const PAD_T = 8;
const PAD_B = 22;

export function InteractiveBarsChart({
  groups,
  bars,
  ariaLabel,
}: {
  groups: BarGroup[];
  bars: BarSeries[];
  ariaLabel: string;
}) {
  const n = groups.length;
  const [hover, setHover] = useState<{ i: number; width: number } | null>(null);

  const max = Math.max(
    1,
    ...groups.flatMap((g) => bars.map((b) => g.values[b.key] ?? 0)),
  );
  const slot = n ? W / n : W;
  const barW = Math.min(26, slot * 0.36);
  const gap = 2;
  const groupW = bars.length * barW + (bars.length - 1) * gap;
  const y = (v: number) => H - PAD_B - (v / max) * (H - PAD_T - PAD_B);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !n) return;
    const frac = (e.clientX - rect.left) / rect.width;
    const i = Math.max(0, Math.min(n - 1, Math.floor(frac * n)));
    setHover({ i, width: rect.width });
  };

  const hovered = hover ? groups[hover.i] : null;
  const pxHeight = hover ? (hover.width * H) / W : 0;
  const cxUnits = hover ? hover.i * slot + slot / 2 : 0;
  const tipLeft = hover
    ? Math.max(48, Math.min(hover.width - 48, (cxUnits / W) * hover.width))
    : 0;
  const tipTop =
    hover && hovered
      ? (Math.min(...bars.map((b) => y(hovered.values[b.key] ?? 0))) / H) *
        pxHeight
      : 0;

  return (
    <div
      className="relative"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
        {hover ? (
          <rect
            x={hover.i * slot}
            y={PAD_T}
            width={slot}
            height={H - PAD_T - PAD_B}
            fill="var(--muted-foreground)"
            opacity="0.08"
            rx="6"
          />
        ) : null}
        {groups.map((g, i) => {
          const cx = i * slot + slot / 2;
          const startX = cx - groupW / 2;
          return (
            <g key={g.label}>
              {bars.map((b, bi) => {
                const v = g.values[b.key] ?? 0;
                const bx = startX + bi * (barW + gap);
                const by = y(v);
                return (
                  <rect
                    key={b.key}
                    x={bx}
                    y={by}
                    width={barW}
                    height={Math.max(0, H - PAD_B - by)}
                    rx="3"
                    fill={b.color}
                  />
                );
              })}
              <text
                x={cx}
                y={H - 6}
                textAnchor="middle"
                className="fill-muted-foreground"
                style={{ fontSize: "10px" }}
              >
                {g.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover && hovered ? (
        <ChartTooltip left={tipLeft} top={tipTop}>
          <p className="mb-1 font-medium text-foreground">{hovered.label}</p>
          <div className="flex flex-col gap-0.5">
            {bars.map((b) => (
              <TooltipRow
                key={b.key}
                color={b.color}
                label={b.label}
                value={brl.format(hovered.values[b.key] ?? 0)}
              />
            ))}
          </div>
        </ChartTooltip>
      ) : null}
    </div>
  );
}
