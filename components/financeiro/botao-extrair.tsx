"use client";

/**
 * Botão **Extrair** — gera a planilha de uma tela do Financeiro.
 *
 * O desenho resolve três coisas que doeram nas extrações manuais de 2026-08-12:
 *
 * 1. **Contagem ANTES do download.** A prévia diz "117 linhas · R$ 326.473,16"
 *    ou "0 linhas". Sem isso, a única forma de descobrir que a extração está
 *    vazia — ou que o filtro estava errado — é abrir o arquivo.
 * 2. **Avisos ANTES do download.** O arquivo circula sozinho depois; quem abre
 *    não tem o contexto de quem gerou. Aviso crítico exige confirmação.
 * 3. **Período aberto.** O padrão é o que está na tela, mas dá para pedir
 *    "ago/2026 até dez/2027" num clique — que foi o pedido real.
 *
 * Ver `docs/financeiro-exportacao.md`.
 */
import { useCallback, useEffect, useState } from "react";
import { IconAlertTriangle, IconDownload, IconInfoCircle } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Aviso {
  nivel: "critico" | "atencao" | "nota";
  texto: string;
}

interface Previa {
  titulo: string;
  subtitulo?: string;
  linhas: number;
  colunas: number;
  avisos: Aviso[];
  totais: Record<string, number> | null;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const ESTILO: Record<Aviso["nivel"], string> = {
  critico: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  atencao: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  nota: "border-border bg-muted/40 text-muted-foreground",
};

export interface BotaoExtrairProps {
  fonte: "contas-pagar" | "dre";
  /** Competência inicial sugerida ('AAAA-MM') — normalmente a da tela. */
  competencia: string;
  /**
   * Competência final sugerida. Ausente = igual à inicial (um mês).
   *
   * Existe para o diálogo abrir no MESMO recorte que está na tela: quem está
   * olhando o ano de 2026 e clica em Extrair espera o ano, não o mês corrente.
   */
  ate?: string;
  /** Params extras da fonte (regime, bu, buNome). */
  extra?: Record<string, string | undefined>;
  /** Contas a pagar: oferece o seletor de formato de rateio. */
  comRateio?: boolean;
  className?: string;
}

export function BotaoExtrair({
  fonte,
  competencia,
  ate: ateSugerido,
  extra,
  comRateio = false,
  className,
}: BotaoExtrairProps) {
  const [aberto, setAberto] = useState(false);
  const [de, setDe] = useState(competencia);
  const [ate, setAte] = useState(competencia);
  const [rateio, setRateio] = useState<"resumido" | "por-bu">("resumido");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /**
   * Reabrir o diálogo volta ao período da tela — o caso comum é "só este mês".
   *
   * No handler, não num efeito: é reação a um evento do usuário, e sincronizar
   * estado com estado dentro de `useEffect` gera renderização em cascata.
   */
  const abrir = () => {
    setDe(competencia);
    setAte(ateSugerido ?? competencia);
    setPrevia(null);
    setAberto(true);
  };

  const params = useCallback(
    (preview: boolean) => {
      const p = new URLSearchParams({ fonte, de, ate });
      if (comRateio) p.set("rateio", rateio);
      for (const [k, v] of Object.entries(extra ?? {})) if (v) p.set(k, v);
      if (preview) p.set("preview", "1");
      return p.toString();
    },
    [fonte, de, ate, rateio, comRateio, extra],
  );

  /** Busca a prévia a cada mudança de filtro (com respiro para não pedir a cada tecla). */
  useEffect(() => {
    if (!aberto) return;
    let cancel = false;
    // Dentro do timeout, não no corpo do efeito: além de satisfazer a regra de
    // não chamar setState sincronamente num efeito, evita piscar "Calculando…"
    // a cada tecla digitada no campo de mês.
    const t = setTimeout(() => {
      if (cancel) return;
      setCarregando(true);
      setErro(null);
      fetch(`/api/financeiro/exportar?${params(true)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: Previa) => !cancel && setPrevia(d))
        .catch((e) => !cancel && setErro((e as Error).message))
        .finally(() => !cancel && setCarregando(false));
    }, 350);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [aberto, params]);

  const criticos = (previa?.avisos ?? []).filter((a) => a.nivel === "critico");
  const vazio = previa?.linhas === 0;

  const baixar = () => {
    // Navegação simples: o `Content-Disposition` da rota faz o navegador salvar
    // em vez de abrir. Sem blob, sem memória extra.
    window.location.href = `/api/financeiro/exportar?${params(false)}`;
    setAberto(false);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={abrir}
        className={cn("gap-1.5", className)}
      >
        <IconDownload className="size-4" />
        Extrair
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Extrair planilha</DialogTitle>
            <DialogDescription>
              {fonte === "dre" ? "DRE" : "Contas a pagar"} em CSV, pronto para abrir no
              Excel.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                De (competência)
                <Input
                  type="month"
                  value={de}
                  max={ate}
                  onChange={(e) => setDe(e.target.value)}
                  className="h-8 w-40"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Até
                <Input
                  type="month"
                  value={ate}
                  min={de}
                  onChange={(e) => setAte(e.target.value)}
                  className="h-8 w-40"
                />
              </label>
            </div>

            {comRateio ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Rateio por BU</span>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["resumido", "Resumido — 1 linha por conta"],
                      ["por-bu", "Detalhado — 1 linha por BU"],
                    ] as const
                  ).map(([v, rot]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setRateio(v)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs transition-colors",
                        rateio === v
                          ? "border-transparent bg-foreground text-background"
                          : "border-border text-muted-foreground hover:bg-muted/60",
                      )}
                    >
                      {rot}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {rateio === "resumido"
                    ? "A soma da coluna Previsto fecha com o total real."
                    : "Boa para tabela dinâmica por BU — mas a conta rateada aparece em mais de uma linha."}
                </p>
              </div>
            ) : null}

            {/* Contagem e totais, antes de baixar. */}
            <div className="rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm">
              {erro ? (
                <span className="text-red-500 dark:text-red-400">
                  Não foi possível calcular a prévia ({erro}).
                </span>
              ) : carregando || !previa ? (
                <span className="text-muted-foreground">Calculando…</span>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className={cn("font-medium tabular-nums", vazio && "text-red-500 dark:text-red-400")}>
                    {previa.linhas.toLocaleString("pt-BR")} linha(s) · {previa.colunas} colunas
                  </span>
                  {previa.totais
                    ? Object.entries(previa.totais).map(([k, v]) => (
                        <span key={k} className="text-xs text-muted-foreground tabular-nums">
                          {k}: {brl.format(v)}
                        </span>
                      ))
                    : null}
                </div>
              )}
            </div>

            {(previa?.avisos ?? []).length ? (
              <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                {previa!.avisos.map((a, i) => (
                  <li
                    key={i}
                    className={cn(
                      "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-snug",
                      ESTILO[a.nivel],
                    )}
                  >
                    {a.nivel === "nota" ? (
                      <IconInfoCircle className="mt-0.5 size-3.5 shrink-0" />
                    ) : (
                      <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    )}
                    <span>{a.texto}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={baixar}
              // Vazio bloqueia; crítico só informa (o usuário pode ter motivo).
              disabled={carregando || vazio || !previa}
              className="gap-1.5"
            >
              <IconDownload className="size-4" />
              {criticos.length && !vazio ? "Baixar mesmo assim" : "Baixar CSV"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
