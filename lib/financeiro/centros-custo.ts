/**
 * % por Centro de Custo (Passo 14) — distribuição da DESPESA por centro de custo
 * no ano, com previsto × realizado e % do total.
 *
 * FONTE = eventos de contas-a-pagar do Conta Azul (`.../contas-a-pagar/buscar`),
 * que trazem `centros_de_custo` preenchido (Comercial, Pedagógico, Marketing…).
 * As nossas tabelas (`fin_despesas`) NÃO servem aqui: o seed do Passo 2 trouxe um
 * conjunto de "centros" que não bate com os dos eventos, e o import do Passo 11
 * não mapeou centro. Como o Dashboard/DRE, lemos direto do CA (cacheado).
 *
 * Cada evento costuma ter 1 centro; usamos o primeiro (sem centro → "Sem centro").
 * Previsto = Σ `total`; Realizado = Σ `pago`. Server-only, por empresa.
 */
import "server-only";

import { caGet, ContaAzulError } from "@/lib/contaazul/client";
import { CONTA_AZUL_RESOURCES } from "@/lib/contaazul/config";

export interface CentroCustoLinha {
  centroId: string | null;
  centro: string;
  previsto: number;
  realizado: number;
}

export interface CentrosCustoResumo {
  connected: boolean;
  ano: number;
  linhas: CentroCustoLinha[];
  totais: { previsto: number; realizado: number };
  atualizadoEm: string;
  erro?: string;
}

const PAGAR = CONTA_AZUL_RESOURCES.contasAPagar.path!;
const TAM = 100;
const MAX_PAGINAS = 120;
const LOTE = 6;

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

interface ApiItem {
  total?: unknown;
  pago?: unknown;
  centros_de_custo?: { id?: string; nome?: string }[] | null;
}
interface ApiResp {
  itens_totais?: number;
  itens?: ApiItem[];
}

async function computeCentrosCusto(
  companyId: string,
  ano: number,
): Promise<CentrosCustoResumo> {
  const de = `${ano}-01-01`;
  const ate = `${ano}-12-31`;
  const atualizadoEm = new Date().toISOString();

  try {
    const buscar = (pagina: number) =>
      caGet<ApiResp>(companyId, PAGAR, {
        data_vencimento_de: de,
        data_vencimento_ate: ate,
        pagina,
        tamanho_pagina: TAM,
      });

    const primeira = await buscar(1);
    const itens: ApiItem[] = [...(primeira.itens ?? [])];
    const totalItens = primeira.itens_totais ?? itens.length;
    const totalPaginas = Math.min(MAX_PAGINAS, Math.ceil(totalItens / TAM));

    for (let inicio = 2; inicio <= totalPaginas; inicio += LOTE) {
      const fim = Math.min(inicio + LOTE - 1, totalPaginas);
      const paginas = [];
      for (let p = inicio; p <= fim; p++) paginas.push(buscar(p));
      const resps = await Promise.all(paginas);
      for (const r of resps) itens.push(...(r.itens ?? []));
    }

    const map = new Map<string, CentroCustoLinha>();
    for (const it of itens) {
      const cc = it.centros_de_custo?.[0] ?? null;
      const centroId = cc?.id ?? null;
      const centro = (cc?.nome ?? "").trim() || "Sem centro";
      const key = centroId ?? "__sem__";
      const linha = map.get(key) ?? { centroId, centro, previsto: 0, realizado: 0 };
      linha.previsto += num(it.total);
      linha.realizado += num(it.pago);
      map.set(key, linha);
    }

    const linhas = [...map.values()].sort(
      (a, b) => b.realizado - a.realizado || b.previsto - a.previsto,
    );
    const totais = linhas.reduce(
      (t, l) => ({ previsto: t.previsto + l.previsto, realizado: t.realizado + l.realizado }),
      { previsto: 0, realizado: 0 },
    );

    return { connected: true, ano, linhas, totais, atualizadoEm };
  } catch (error) {
    const erro =
      error instanceof ContaAzulError
        ? error.message
        : "Falha ao consultar a Conta Azul.";
    return {
      connected: false,
      ano,
      linhas: [],
      totais: { previsto: 0, realizado: 0 },
      atualizadoEm,
      erro,
    };
  }
}

/** Cache por processo (5 min) — a varredura pagina o ano de contas a pagar. */
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; data: CentrosCustoResumo }>();

export async function resumoCentrosCusto(
  companyId: string,
  opts: { ano?: number; force?: boolean } = {},
): Promise<CentrosCustoResumo> {
  const ano = opts.ano && opts.ano > 2000 ? opts.ano : new Date().getUTCFullYear();
  const key = `${companyId}:${ano}`;
  if (!opts.force) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  }
  const data = await computeCentrosCusto(companyId, ano);
  if (data.connected) cache.set(key, { at: Date.now(), data });
  return data;
}
