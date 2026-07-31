"use client";

import { useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { BusinessUnit } from "@/lib/financeiro/types";

/**
 * Editor de rateio por BU, compartilhado entre Contas a Pagar (rateio da parcela)
 * e Recorrências (rateio padrão da despesa gerada). Linhas (BU × %); só aplica
 * com Σ=100% e BUs distintas. "Remover rateio" devolve `[]` → volta a valer a BU
 * única. As validações espelham `lib/financeiro/rateio.ts` (a app revalida no server).
 */
export type RateioLinha = { bu_id: string; percentual: number };

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const optionCls = "bg-background text-foreground";

/** Σ dos percentuais em centésimos (100% = 10000) — sem erro de float. */
export const somaRateioCent = (r: RateioLinha[]) =>
  r.reduce((s, l) => s + Math.round((Number(l.percentual) || 0) * 100), 0);
export const rateioValido = (r: RateioLinha[]) =>
  r.length === 0 || (r.length >= 2 && somaRateioCent(r) === 10000);

export function RateioEditorDialog({
  bus,
  initial,
  titulo,
  onSave,
  onCancel,
}: {
  bus: BusinessUnit[];
  initial: RateioLinha[];
  titulo: string;
  onSave: (linhas: RateioLinha[]) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<RateioLinha[]>(
    initial.length
      ? initial.map((r) => ({ ...r }))
      : [
          { bu_id: bus[0]?.id ?? "", percentual: 50 },
          { bu_id: bus[1]?.id ?? bus[0]?.id ?? "", percentual: 50 },
        ],
  );
  const somaC = somaRateioCent(rows);
  const dupBu = new Set(rows.map((r) => r.bu_id)).size !== rows.length;
  const ok = rows.length >= 2 && somaC === 10000 && !dupBu;

  const set = (i: number, patch: Partial<RateioLinha>) =>
    setRows((s) => s.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows((s) => [...s, { bu_id: bus[0]?.id ?? "", percentual: 0 }]);
  const del = (i: number) => setRows((s) => s.filter((_, j) => j !== i));
  const distribuir = () => {
    const n = rows.length;
    if (!n) return;
    const base = Math.floor(10000 / n);
    const resto = 10000 - base * n;
    setRows((s) => s.map((r, i) => ({ ...r, percentual: (base + (i < resto ? 1 : 0)) / 100 })));
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{titulo}</DialogTitle>
      </DialogHeader>
      <p className="text-xs text-muted-foreground">
        Divida o valor entre as BUs. A soma precisa ser exatamente 100%.
      </p>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              className={cn(selectCls, "h-8 flex-1")}
              value={r.bu_id}
              onChange={(e) => set(i, { bu_id: e.target.value })}
            >
              {bus.map((b) => (
                <option key={b.id} value={b.id} className={optionCls}>
                  {b.nome}
                </option>
              ))}
            </select>
            <div className="relative">
              <Input
                className="h-8 w-24 pr-6"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={String(r.percentual)}
                onChange={(e) => set(i, { percentual: Number(e.target.value) })}
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                %
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => del(i)}
              disabled={rows.length <= 2}
              title="Remover BU"
            >
              <IconTrash className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <IconPlus className="h-4 w-4" />
          BU
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={distribuir}>
          Dividir igual
        </Button>
        <span
          className={cn(
            "ml-auto text-xs font-medium tabular-nums",
            somaC === 10000 && !dupBu
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-destructive",
          )}
        >
          Σ {(somaC / 100).toFixed(2)}%
        </span>
      </div>
      {dupBu && <p className="text-xs text-destructive">Há BU repetida — escolha BUs distintas.</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        {initial.length > 0 && (
          <Button type="button" variant="ghost" onClick={() => onSave([])}>
            Remover rateio
          </Button>
        )}
        <Button type="button" disabled={!ok} onClick={() => onSave(rows.filter((r) => r.bu_id))}>
          Aplicar
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
