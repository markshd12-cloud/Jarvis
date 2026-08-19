"use client";

/**
 * Seletor de PERÍODO do DRE: mês, trimestre, ano ou intervalo livre.
 *
 * O DRE nasceu mensal e o mês continua sendo o padrão — é a leitura de rotina.
 * Os outros recortes existem porque as perguntas de gestão não são mensais:
 * "como fechou o trimestre", "quanto sobrou no ano". Antes disso a única saída
 * era abrir mês a mês e somar na mão, que foi exatamente o pedido que originou a
 * extração em CSV.
 *
 * ## O mês âncora carrega o trimestre e o ano
 *
 * Trimestre e ano NÃO ganham parâmetros próprios: eles são derivados de `comp`,
 * o mesmo mês que o modo mensal já usa. `?comp=2026-08&per=tri` é o 3º trimestre
 * de 2026. Assim trocar de recorte preserva onde a pessoa estava (agosto vira "o
 * trimestre do agosto", não "o trimestre atual"), o endereço continua curto e
 * não há um segundo estado de data para sair de sincronia com o primeiro.
 *
 * Só o intervalo livre precisa de `de`/`ate`, porque aí não há o que derivar.
 */
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDownIcon } from "lucide-react";

export type ModoPeriodo = "mes" | "tri" | "ano" | "livre";

export const EH_MODO = (v: string): v is ModoPeriodo =>
  v === "mes" || v === "tri" || v === "ano" || v === "livre";

const MESES_ABREV = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

export const rotuloMes = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  return `${MESES_ABREV[(m - 1) % 12]}/${y}`;
};

/** Trimestre (1–4) a que o mês pertence. */
const triDo = (ym: string): number => Math.floor((Number(ym.split("-")[1]) - 1) / 3) + 1;
const anoDe = (ym: string): number => Number(ym.split("-")[0]);
const mm = (n: number) => String(n).padStart(2, "0");

/**
 * Intervalo de competências do recorte, com o rótulo que vai no botão.
 *
 * Puro e exportado porque a casca precisa exatamente do mesmo cálculo para
 * montar a chamada da API — duas versões disto divergiriam no primeiro ajuste.
 */
export function resolverPeriodo(
  modo: ModoPeriodo,
  comp: string,
  de: string,
  ate: string,
): { de: string; ate: string; label: string; meses: number } {
  const conta = (a: string, b: string) =>
    (anoDe(b) - anoDe(a)) * 12 + (Number(b.split("-")[1]) - Number(a.split("-")[1])) + 1;

  if (modo === "ano") {
    const y = anoDe(comp);
    return { de: `${y}-01`, ate: `${y}-12`, label: String(y), meses: 12 };
  }
  if (modo === "tri") {
    const y = anoDe(comp);
    const t = triDo(comp);
    const ini = (t - 1) * 3 + 1;
    return {
      de: `${y}-${mm(ini)}`,
      ate: `${y}-${mm(ini + 2)}`,
      label: `${t}º tri/${y}`,
      meses: 3,
    };
  }
  if (modo === "livre" && de && ate && de <= ate) {
    return {
      de,
      ate,
      label: de === ate ? rotuloMes(de) : `${rotuloMes(de)} – ${rotuloMes(ate)}`,
      meses: conta(de, ate),
    };
  }
  return { de: comp, ate: comp, label: rotuloMes(comp), meses: 1 };
}

const MODOS: { k: ModoPeriodo; label: string }[] = [
  { k: "mes", label: "Mensal" },
  { k: "tri", label: "Trimestral" },
  { k: "ano", label: "Anual" },
  { k: "livre", label: "Personalizado" },
];

export function SeletorPeriodo({
  modo,
  comp,
  de,
  ate,
  competencias,
  onChange,
}: {
  modo: ModoPeriodo;
  comp: string;
  de: string;
  ate: string;
  /** Meses oferecidos no modo mensal (a lista que a casca já monta). */
  competencias: string[];
  /** Grava o recorte inteiro de uma vez — evita estado intermediário inválido. */
  onChange: (v: { modo: ModoPeriodo; comp?: string; de?: string; ate?: string }) => void;
}) {
  const deRef = useRef<HTMLInputElement>(null);
  const ateRef = useRef<HTMLInputElement>(null);
  const atual = resolverPeriodo(modo, comp, de, ate);

  /** Anos e trimestres saem da lista de meses: uma fonte só para o que existe. */
  const anos = [...new Set(competencias.map(anoDe))].sort((a, b) => b - a);
  const trimestres = [
    ...new Map(
      competencias.map((m) => [`${anoDe(m)}-${triDo(m)}`, { ano: anoDe(m), tri: triDo(m) }]),
    ).values(),
  ].sort((a, b) => b.ano - a.ano || b.tri - a.tri);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
          {MODOS.find((m) => m.k === modo)?.label ?? "Mensal"}
          <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {MODOS.map((m) => (
            <DropdownMenuItem
              key={m.k}
              // Leva o mês âncora junto: trocar para Trimestral em agosto abre o
              // trimestre DE AGOSTO, não o trimestre corrente.
              onClick={() => onChange({ modo: m.k, comp, de: atual.de, ate: atual.ate })}
            >
              {m.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {modo === "livre" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            ref={deRef}
            type="month"
            defaultValue={atual.de}
            className="rounded-md border border-border bg-card px-2 py-1 text-sm"
          />
          <span className="text-sm text-muted-foreground">até</span>
          <input
            ref={ateRef}
            type="month"
            defaultValue={atual.ate}
            className="rounded-md border border-border bg-card px-2 py-1 text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const d = deRef.current?.value || atual.de;
              const a = ateRef.current?.value || atual.ate;
              // Invertido é engano de digitação, não pedido: desinverte em vez
              // de devolver uma tela vazia sem explicação.
              onChange(
                d <= a
                  ? { modo: "livre", de: d, ate: a }
                  : { modo: "livre", de: a, ate: d },
              );
            }}
          >
            Aplicar
          </Button>
        </div>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
            {atual.label}
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {modo === "ano"
              ? anos.map((a) => (
                  <DropdownMenuItem key={a} onClick={() => onChange({ modo, comp: `${a}-01` })}>
                    {a}
                  </DropdownMenuItem>
                ))
              : modo === "tri"
                ? trimestres.map(({ ano, tri }) => (
                    <DropdownMenuItem
                      key={`${ano}-${tri}`}
                      onClick={() =>
                        onChange({ modo, comp: `${ano}-${mm((tri - 1) * 3 + 1)}` })
                      }
                    >
                      {tri}º tri/{ano}
                    </DropdownMenuItem>
                  ))
                : competencias.map((m) => (
                    <DropdownMenuItem key={m} onClick={() => onChange({ modo, comp: m })}>
                      {rotuloMes(m)}
                    </DropdownMenuItem>
                  ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
