"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { CAC_MES_MIN, cacDeslocaMes, cacMesCorrente } from "@/lib/marketing/cac-opcoes";

/**
 * Seletor de MÊS do CAC.
 *
 * `<input type="month">` em vez de uma lista de presets ("3 meses", "ano"): o
 * navegador entrega um calendário de meses nativo, com teclado e acessibilidade
 * de graça, e o usuário escolhe exatamente o mês que quer ver em vez de aceitar
 * uma janela pronta.
 *
 * As setas ao lado existem porque comparar meses vizinhos é o uso mais comum, e
 * abrir o calendário para andar um mês é atrito puro.
 *
 * NÃO há seletor de regime: Previsto e Realizado aparecem os dois como cartões,
 * e alternar entre eles só mudaria qual número fica grande.
 *
 * Estado na URL, como o resto do módulo — link compartilhável e botão voltar
 * funcionando.
 */
export function CacControles({ mes }: { mes: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hoje = cacMesCorrente();

  const irPara = (novo: string) => {
    if (!novo || novo < CAC_MES_MIN || novo > hoje) return;
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("cacMes", novo);
    qs.set("aba", "cac"); // não perder a aba ao navegar
    router.replace(`${pathname}?${qs}`, { scroll: false });
  };

  const anterior = cacDeslocaMes(mes, -1);
  const proximo = cacDeslocaMes(mes, 1);

  const seta =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-label="Mês anterior"
        onClick={() => irPara(anterior)}
        disabled={anterior < CAC_MES_MIN}
        className={seta}
      >
        ‹
      </button>

      <input
        type="month"
        aria-label="Mês do CAC"
        value={mes}
        min={CAC_MES_MIN}
        max={hoje}
        onChange={(e) => irPara(e.target.value)}
        className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none scheme-light dark:scheme-dark"
      />

      <button
        type="button"
        aria-label="Próximo mês"
        onClick={() => irPara(proximo)}
        disabled={proximo > hoje}
        className={seta}
      >
        ›
      </button>
    </div>
  );
}
