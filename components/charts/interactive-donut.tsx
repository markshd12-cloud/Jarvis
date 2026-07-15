"use client";

/**
 * Anel (donut) interativo. Mantém o MESMO visual do original — o `conic-gradient`
 * pinta as fatias e o miolo `bg-card` fica no centro (recebido via `children`,
 * então cada painel preserva seu conteúdo central exato). Por cima, um SVG com
 * arcos transparentes captura o hover de cada fatia → realce sutil + tooltip.
 * Nenhuma mudança de pixel no estado de repouso; nenhuma dependência externa.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";

import { ChartTooltip, TooltipRow } from "./chart-tooltip";
import { brlCompact } from "./format";

export interface DonutItem {
  label: string;
  value: number;
  color: string;
}

const SIZE = 112; // 7rem = h-28 w-28
const C = SIZE / 2;
const R_OUT = 56;
const R_IN = 35; // miolo de 70px (h-[70px])
const TAU = Math.PI * 2;

/** Ponto na circunferência: frac∈[0,1], 0 no topo, sentido horário. */
function polar(radius: number, frac: number): [number, number] {
  const a = frac * TAU - Math.PI / 2;
  return [C + radius * Math.cos(a), C + radius * Math.sin(a)];
}

/** Path de um setor anular [f0,f1]. */
function arc(f0: number, f1: number): string {
  const span = Math.min(0.9999, f1 - f0); // evita arco degenerado no círculo cheio
  const e = f0 + span;
  const [ox0, oy0] = polar(R_OUT, f0);
  const [ox1, oy1] = polar(R_OUT, e);
  const [ix1, iy1] = polar(R_IN, e);
  const [ix0, iy0] = polar(R_IN, f0);
  const large = span > 0.5 ? 1 : 0;
  return `M${ox0} ${oy0} A${R_OUT} ${R_OUT} 0 ${large} 1 ${ox1} ${oy1} L${ix1} ${iy1} A${R_IN} ${R_IN} 0 ${large} 0 ${ix0} ${iy0} Z`;
}

export function InteractiveDonutRing({
  items,
  children,
  hrefs,
}: {
  items: DonutItem[];
  children: ReactNode;
  /** Se presente (alinhado a `items`), clicar na fatia navega para o href
   *  correspondente — reusa os filtros por `searchParam` do dashboard. */
  hrefs?: string[];
}) {
  const router = useRouter();
  const [hi, setHi] = useState<number | null>(null);
  const total = items.reduce((s, i) => s + i.value, 0);

  // Fatias cumulativas + stops do conic-gradient (idêntico ao original).
  // Offsets calculados sem estado mutável (n minúsculo: categorias/marcas).
  const shares = items.map((it) => (total ? it.value / total : 0));
  const slices = items.map((it, i) => {
    const f0 = shares.slice(0, i).reduce((a, b) => a + b, 0);
    return { ...it, f0, f1: f0 + shares[i], share: shares[i] };
  });
  const stops = slices
    .map((s) => `${s.color} ${(s.f0 * 100).toFixed(2)}% ${(s.f1 * 100).toFixed(2)}%`)
    .join(", ");

  const hovered = hi != null ? slices[hi] : null;

  return (
    <div className="relative h-28 w-28 flex-none">
      <div
        className="grid h-full w-full place-items-center rounded-full"
        style={{
          background: total ? `conic-gradient(${stops})` : "var(--muted)",
        }}
      >
        <div className="grid h-[70px] w-[70px] place-items-center rounded-full bg-card text-center">
          {children}
        </div>
      </div>
      {total ? (
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="absolute inset-0 h-full w-full"
        >
          {slices.map((s, i) => (
            <path
              key={s.label}
              d={arc(s.f0, s.f1)}
              fill="transparent"
              className={hrefs?.[i] ? "cursor-pointer" : "cursor-default"}
              onMouseEnter={() => setHi(i)}
              onMouseLeave={() => setHi(null)}
              onClick={
                hrefs?.[i]
                  ? () => router.push(hrefs[i], { scroll: false })
                  : undefined
              }
            />
          ))}
          {hovered ? (
            <path
              d={arc(hovered.f0, hovered.f1)}
              fill="var(--foreground)"
              opacity="0.12"
              pointerEvents="none"
            />
          ) : null}
        </svg>
      ) : null}
      {hovered ? (
        <ChartTooltip left={C} top={0}>
          <TooltipRow
            color={hovered.color}
            label={hovered.label}
            value={`${brlCompact.format(hovered.value)} · ${Math.round(hovered.share * 100)}%`}
          />
        </ChartTooltip>
      ) : null}
    </div>
  );
}
