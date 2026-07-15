"use client";

/**
 * Barras agrupadas interativas (fluxo mensal recebido×pago). Mesma geometria do
 * `FluxoChart` original (640×200): hover por coluna → banda + tooltip; legenda
 * clicável opcional (liga/desliga série, Fase 2); e drill-down opcional (Fase 3)
 * — clicar numa coluna abre um painel com o detalhe daquele mês (dados já
 * computados no server, passados como props serializáveis). Zero dependência.
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

export interface BarDetailRow {
  label: string;
  value: string;
  color: string;
}

export interface BarDetailSection {
  title: string;
  rows: BarDetailRow[];
}

/** Detalhe de um grupo (mês), alinhado a `groups` por índice. */
export interface BarGroupDetail {
  sections: BarDetailSection[];
}

const W = 640;
const H = 200;
const PAD_T = 8;
const PAD_B = 22;

export function InteractiveBarsChart({
  groups,
  bars,
  ariaLabel,
  legend = false,
  details,
}: {
  groups: BarGroup[];
  bars: BarSeries[];
  ariaLabel: string;
  /** Mostra uma legenda clicável que liga/desliga cada série. */
  legend?: boolean;
  /** Se presente (alinhado a `groups`), clicar numa coluna abre o detalhe. */
  details?: BarGroupDetail[];
}) {
  const n = groups.length;
  const [hover, setHover] = useState<{ i: number; width: number } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<number | null>(null);

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (bars.length - prev.size > 1) next.add(key);
      return next;
    });

  const visible = bars.filter((b) => !hidden.has(b.key));

  const max = Math.max(
    1,
    ...groups.flatMap((g) => visible.map((b) => g.values[b.key] ?? 0)),
  );
  const slot = n ? W / n : W;
  const barW = Math.min(26, slot * 0.36);
  const gap = 2;
  const groupW = visible.length * barW + Math.max(0, visible.length - 1) * gap;
  const y = (v: number) => H - PAD_B - (v / max) * (H - PAD_T - PAD_B);

  const indexFromEvent = (e: React.MouseEvent<HTMLDivElement>): number | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !n) return null;
    const frac = (e.clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(n - 1, Math.floor(frac * n)));
  };

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const i = indexFromEvent(e);
    if (i == null) return;
    setHover({ i, width: e.currentTarget.getBoundingClientRect().width });
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!details) return;
    const i = indexFromEvent(e);
    if (i == null) return;
    setSelected((prev) => (prev === i ? null : i));
  };

  const hovered = hover ? groups[hover.i] : null;
  const pxHeight = hover ? (hover.width * H) / W : 0;
  const cxUnits = hover ? hover.i * slot + slot / 2 : 0;
  const tipLeft = hover
    ? Math.max(48, Math.min(hover.width - 48, (cxUnits / W) * hover.width))
    : 0;
  const tipTop =
    hover && hovered && visible.length
      ? (Math.min(...visible.map((b) => y(hovered.values[b.key] ?? 0))) / H) *
        pxHeight
      : 0;

  const detail = selected != null ? details?.[selected] : undefined;

  return (
    <div>
      {legend ? (
        <div className="mb-2 flex flex-wrap justify-end gap-3 text-xs">
          {bars.map((b) => {
            const off = hidden.has(b.key);
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => toggle(b.key)}
                className={`inline-flex items-center gap-1.5 transition-opacity ${off ? "opacity-40" : ""}`}
                aria-pressed={!off}
              >
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ background: b.color }}
                />
                <span
                  className={`text-muted-foreground ${off ? "line-through" : ""}`}
                >
                  {b.label}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div
        className={`relative ${details ? "cursor-pointer" : ""}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={onClick}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
          {selected != null ? (
            <rect
              x={selected * slot}
              y={PAD_T}
              width={slot}
              height={H - PAD_T - PAD_B}
              fill="var(--brand)"
              opacity="0.1"
              stroke="var(--brand)"
              strokeOpacity="0.5"
              strokeWidth="1"
              rx="6"
            />
          ) : null}
          {hover && hover.i !== selected ? (
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
                {visible.map((b, bi) => {
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
        {hover && hovered && visible.length ? (
          <ChartTooltip left={tipLeft} top={tipTop}>
            <p className="mb-1 font-medium text-foreground">{hovered.label}</p>
            <div className="flex flex-col gap-0.5">
              {visible.map((b) => (
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
      {details && detail && selected != null ? (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">
              {groups[selected].label}
              <span className="ml-2 font-normal text-muted-foreground">
                detalhe do mês
              </span>
            </p>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              fechar ✕
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {detail.sections.map((sec) => (
              <div key={sec.title}>
                <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                  {sec.title}
                </p>
                {sec.rows.length ? (
                  <ul className="flex flex-col gap-1">
                    {sec.rows.map((r) => (
                      <li key={r.label} className="flex items-center gap-2 text-sm">
                        <span
                          className="h-2 w-2 flex-none rounded-sm"
                          style={{ background: r.color }}
                        />
                        <span className="truncate text-muted-foreground">
                          {r.label}
                        </span>
                        <span className="ml-auto tabular-nums font-medium">
                          {r.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">—</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
