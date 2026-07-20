/**
 * Vendas & Contas a Faturar (Passo 15) — leitura das VENDAS do Conta Azul
 * (`/venda/busca`, âncora fiscal). Cada venda tem `situacao`: FATURADO (NF
 * emitida) ou APROVADO (aprovada, A FATURAR). "Contas a faturar" = aprovadas e
 * ainda não faturadas. Lê ao vivo do CA (cacheado 5 min), como Dashboard/DRE.
 * Server-only, por empresa.
 *
 * ⚠️ Paginação usa `total_itens` (NÃO `itens_totais`, como os eventos financeiros).
 */
import "server-only";

import { caGet, ContaAzulError } from "@/lib/contaazul/client";
import { CONTA_AZUL_RESOURCES } from "@/lib/contaazul/config";

export interface VendaItem {
  id: string;
  numero: number | null;
  data: string;
  cliente: string;
  tipoItem: string; // PRODUCT | SERVICE | ...
  situacao: string; // FATURADO | APROVADO | CANCELADO | ...
  situacaoLabel: string; // descrição amigável do CA
  faturado: boolean;
  total: number;
}

export interface VendasResumo {
  connected: boolean;
  ano: number;
  vendas: VendaItem[];
  totais: {
    total: number;
    faturado: number;
    aFaturar: number;
    qtd: number;
    qtdFaturado: number;
    qtdAFaturar: number;
  };
  atualizadoEm: string;
  erro?: string;
}

const VENDAS = CONTA_AZUL_RESOURCES.vendas.path!;
const TAM = 100;
const MAX_PAGINAS = 80; // trava anti-runaway (~8k vendas)
const LOTE = 6;

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

interface ApiVenda {
  id?: string;
  numero?: number | null;
  data?: string | null;
  total?: unknown;
  itens?: string | null; // tipo dos itens (PRODUCT/SERVICE)
  cliente?: { nome?: string } | null;
  situacao?: { nome?: string; descricao?: string } | null;
}
interface ApiResp {
  total_itens?: number;
  itens?: ApiVenda[];
}

async function computeVendas(companyId: string, ano: number): Promise<VendasResumo> {
  const de = `${ano}-01-01`;
  const ate = `${ano}-12-31`;
  const atualizadoEm = new Date().toISOString();

  try {
    const buscar = (pagina: number) =>
      caGet<ApiResp>(companyId, VENDAS, {
        data_inicio: de,
        data_fim: ate,
        pagina,
        tamanho_pagina: TAM,
      });

    const primeira = await buscar(1);
    const brutas: ApiVenda[] = [...(primeira.itens ?? [])];
    const totalItens = primeira.total_itens ?? brutas.length;
    const totalPaginas = Math.min(MAX_PAGINAS, Math.ceil(totalItens / TAM));

    for (let inicio = 2; inicio <= totalPaginas; inicio += LOTE) {
      const fim = Math.min(inicio + LOTE - 1, totalPaginas);
      const paginas = [];
      for (let p = inicio; p <= fim; p++) paginas.push(buscar(p));
      const resps = await Promise.all(paginas);
      for (const r of resps) brutas.push(...(r.itens ?? []));
    }

    const vendas: VendaItem[] = brutas.map((v) => {
      const situacao = (v.situacao?.nome ?? "").toUpperCase();
      return {
        id: v.id ?? "",
        numero: v.numero ?? null,
        data: v.data ?? "",
        cliente: (v.cliente?.nome ?? "").trim() || "Sem cliente",
        tipoItem: v.itens ?? "",
        situacao,
        situacaoLabel: v.situacao?.descricao ?? situacao,
        faturado: situacao === "FATURADO",
        total: num(v.total),
      };
    });
    vendas.sort((a, b) => b.data.localeCompare(a.data));

    const totais = vendas.reduce(
      (t, v) => {
        const cancelada = v.situacao === "CANCELADO";
        t.total += v.total;
        t.qtd += 1;
        if (v.faturado) {
          t.faturado += v.total;
          t.qtdFaturado += 1;
        } else if (!cancelada) {
          t.aFaturar += v.total;
          t.qtdAFaturar += 1;
        }
        return t;
      },
      { total: 0, faturado: 0, aFaturar: 0, qtd: 0, qtdFaturado: 0, qtdAFaturar: 0 },
    );

    return { connected: true, ano, vendas, totais, atualizadoEm };
  } catch (error) {
    const erro =
      error instanceof ContaAzulError
        ? error.message
        : "Falha ao consultar a Conta Azul.";
    return {
      connected: false,
      ano,
      vendas: [],
      totais: { total: 0, faturado: 0, aFaturar: 0, qtd: 0, qtdFaturado: 0, qtdAFaturar: 0 },
      atualizadoEm,
      erro,
    };
  }
}

/** Cache por processo (5 min) — a varredura pagina o ano de vendas. */
const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; data: VendasResumo }>();

export async function resumoVendas(
  companyId: string,
  opts: { ano?: number; force?: boolean } = {},
): Promise<VendasResumo> {
  const ano = opts.ano && opts.ano > 2000 ? opts.ano : new Date().getUTCFullYear();
  const key = `${companyId}:${ano}`;
  if (!opts.force) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  }
  const data = await computeVendas(companyId, ano);
  if (data.connected) cache.set(key, { at: Date.now(), data });
  return data;
}
