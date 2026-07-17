"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown, IconSearch } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

/**
 * Select com busca por nome (combobox). O painel abre FLUTUANTE via portal em
 * `position: fixed` — assim não é cortado pelo `overflow` do dialog nem empurra o
 * conteúdo pra baixo. Fecha ao escolher, ao clicar fora ou ao rolar/redimensionar.
 */
export interface Opcao {
  value: string;
  label: string;
}

const triggerCls =
  "flex h-8 w-full items-center gap-1 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface Pos {
  left: number;
  width: number;
  top: number; // topo do botão
  bottom: number; // base do botão
  acima: boolean; // abrir pra cima?
}

export function SearchSelect({
  value,
  onChange,
  options,
  placeholder = "— selecione —",
  allowEmpty = false,
  emptyLabel = "— nenhum —",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Opcao[];
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [q, setQ] = useState("");
  const sel = options.find((o) => o.value === value);
  const open = pos !== null;

  const medir = (): Pos | null => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return null;
    const espacoAbaixo = window.innerHeight - r.bottom;
    return {
      left: r.left,
      width: r.width,
      top: r.top,
      bottom: r.bottom,
      acima: espacoAbaixo < 280 && r.top > espacoAbaixo,
    };
  };

  const abrir = () => {
    setQ("");
    setPos(medir());
  };
  const fechar = () => setPos(null);

  useEffect(() => {
    if (!open) return;
    const atualiza = () => setPos((p) => (p ? medir() ?? p : p));
    window.addEventListener("scroll", atualiza, true);
    window.addEventListener("resize", atualiza);
    return () => {
      window.removeEventListener("scroll", atualiza, true);
      window.removeEventListener("resize", atualiza);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

  const pick = (v: string) => {
    onChange(v);
    fechar();
  };

  return (
    <div className={cn("flex flex-col", className)}>
      <button
        ref={btnRef}
        type="button"
        className={triggerCls}
        onClick={() => (open ? fechar() : abrir())}
      >
        <span className={cn("flex-1 truncate text-left", !sel && "text-muted-foreground")}>
          {sel?.label ?? placeholder}
        </span>
        <IconChevronDown
          className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[60]" onMouseDown={fechar} />
            <div
              className="fixed z-[61] rounded-lg border border-input bg-popover shadow-md"
              style={{
                left: pos.left,
                width: pos.width,
                ...(pos.acima
                  ? { bottom: window.innerHeight - pos.top + 4 }
                  : { top: pos.bottom + 4 }),
              }}
            >
              <div className="flex items-center gap-1 border-b border-border px-2">
                <IconSearch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filtrar…"
                  className="h-8 w-full bg-transparent text-sm outline-none"
                />
              </div>
              <ul className="max-h-56 overflow-y-auto py-1">
                {allowEmpty && (
                  <li
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick("");
                    }}
                    className="cursor-pointer px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent"
                  >
                    {emptyLabel}
                  </li>
                )}
                {filtered.map((o) => (
                  <li
                    key={o.value}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(o.value);
                    }}
                    className={cn(
                      "cursor-pointer truncate px-2.5 py-1.5 text-sm hover:bg-accent",
                      o.value === value && "bg-accent/50",
                    )}
                  >
                    {o.label}
                  </li>
                ))}
                {filtered.length === 0 && (
                  <li className="px-2.5 py-1.5 text-sm text-muted-foreground">
                    nada encontrado
                  </li>
                )}
              </ul>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
