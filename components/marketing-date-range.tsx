"use client";

/**
 * Seletor de intervalo custom do Meta Ads. Substitui o `<form method="get">`
 * (que fazia navegação nativa → recarregava e rolava pro topo) por um
 * `router.push(..., { scroll: false })`: aplica o filtro sem sair do lugar e
 * preservando TODOS os params atuais (inclusive os da Conta Azul), lidos via
 * `useSearchParams`. Uncontrolled + `key` no pai (re-monta quando o período
 * muda por outro filtro, refletindo as novas datas).
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";

export function MarketingDateRange({
  since,
  until,
  isCustom,
}: {
  since: string;
  until: string;
  isCustom: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const sinceRef = useRef<HTMLInputElement>(null);
  const untilRef = useRef<HTMLInputElement>(null);

  const apply = () => {
    const p = new URLSearchParams(params.toString());
    p.set("range", "custom");
    p.set("since", sinceRef.current?.value || since);
    p.set("until", untilRef.current?.value || until);
    router.push(`/dashboard?${p.toString()}`, { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={sinceRef}
        type="date"
        defaultValue={since}
        max={until}
        className="rounded-md border border-border bg-card px-2 py-1 text-sm"
      />
      <span className="text-sm text-muted-foreground">a</span>
      <input
        ref={untilRef}
        type="date"
        defaultValue={until}
        className="rounded-md border border-border bg-card px-2 py-1 text-sm"
      />
      <button
        type="button"
        onClick={apply}
        className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
          isCustom
            ? "border-transparent bg-foreground text-background"
            : "border-border text-muted-foreground hover:bg-muted/60"
        }`}
      >
        Aplicar
      </button>
    </div>
  );
}
