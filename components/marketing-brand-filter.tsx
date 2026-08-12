"use client";

/**
 * Chips de marca para a aba **Instagram**.
 *
 * A aba lia `?brand=` e até escrevia "Todas as marcas" no cabeçalho, mas os
 * chips viviam em `marketing-metrics.tsx`, que só renderiza na aba Meta Ads —
 * quem estava no Instagram não tinha como trocar de marca. O filtro existia no
 * servidor e não existia na tela.
 *
 * Cliente (não server component) para navegar sem recarga total e sem precisar
 * receber os searchParams de mão em mão — o mesmo padrão de
 * `marketing-date-range.tsx` e do seletor de mês do Painel.
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function MarketingBrandFilter({
  marcas,
  /** Aba a preservar na URL — sem isto, filtrar devolveria o usuário ao Painel. */
  aba,
}: {
  marcas: string[];
  aba: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ativa = params.get("brand");

  const ir = (marca: string | null) => {
    const qs = new URLSearchParams(params.toString());
    // Vazio REMOVE a chave: o endereço não deve acumular `brand=` quando o
    // filtro é "todas".
    if (marca) qs.set("brand", marca);
    else qs.delete("brand");
    qs.set("aba", aba);
    router.replace(`${pathname}?${qs}`, { scroll: false });
  };

  const cls = (ativo: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm transition-colors ${
      ativo
        ? "border-transparent bg-[var(--brand)] text-black"
        : "border-border text-muted-foreground hover:bg-muted/60"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => ir(null)} className={cls(!ativa)}>
        Todas
      </button>
      {marcas.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => ir(m)}
          className={cls(ativa === m)}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
