"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CAC_JANELAS } from "@/lib/marketing/cac-opcoes";

/**
 * Seletor de período do CAC.
 *
 * NÃO há seletor de regime. Meta, Previsto e Realizado aparecem os três como
 * cartões no painel — botões para alternar entre eles só mudariam qual número
 * fica grande, sem revelar nada novo. O período é a única escolha que muda o
 * conteúdo de fato.
 *
 * Estado na URL, como o resto do módulo — o link fica compartilhável e o botão
 * voltar funciona.
 */
export function CacControles({ janela }: { janela: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const navegar = (chave: string, valor: string) => {
    const qs = new URLSearchParams(searchParams.toString());
    qs.set(chave, valor);
    qs.set("aba", "cac"); // não perder a aba ao navegar
    router.replace(`${pathname}?${qs}`, { scroll: false });
  };

  const grupo = (
    chave: string,
    atual: string,
    opcoes: readonly { valor: string; rotulo: string; ajuda?: string }[],
  ) => (
    <div className="flex overflow-hidden rounded-lg border border-input">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          title={o.ajuda}
          onClick={() => navegar(chave, o.valor)}
          className={
            o.valor === atual
              ? "bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground"
              : "bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          }
        >
          {o.rotulo}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {grupo("cacJanela", janela, CAC_JANELAS)}
    </div>
  );
}
