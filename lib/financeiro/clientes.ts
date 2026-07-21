/**
 * Clientes (Passo 16) — "visão de cliente" composta do Conta Azul, sem depender
 * de `/pessoa` (que não pôde ser sondado): junta VENDAS (`/venda/busca`) para o
 * LTV/última compra e CONTAS A RECEBER para em aberto/vencido/situação. Espelha
 * a aba Clientes do mock (documento/BU ficam p/ v2 quando lermos `/pessoa`).
 *
 * Situação = inadimplente se há título vencido em aberto (`nao_pago>0` e
 * `data_vencimento < hoje`), senão adimplente. Lê ao vivo do CA (cache 10 min),
 * como Dashboard/DRE. Server-only, por empresa.
 */
import "server-only";

import { caGet, ContaAzulError } from "@/lib/contaazul/client";
import { CONTA_AZUL_RESOURCES } from "@/lib/contaazul/config";
import { swr } from "@/lib/financeiro/cache";

export type SituacaoCliente = "inadimplente" | "adimplente";

export interface ClienteRow {
  id: string | null;
  nome: string;
  ltv: number; // Σ vendas não canceladas (lifetime)
  nCompras: number;
  ultimaCompra: string | null; // data da venda mais recente
  emAberto: number; // Σ nao_pago das contas a receber
  vencido: number; // parte do em aberto com vencimento < hoje
  situacao: SituacaoCliente;
}

export interface ClientesResumo {
  connected: boolean;
  clientes: ClienteRow[];
  totais: {
    qtd: number;
    inadimplentes: number;
    ltv: number;
    emAberto: number;
    vencido: number;
  };
  atualizadoEm: string;
  erro?: string;
}

const VENDAS = CONTA_AZUL_RESOURCES.vendas.path!;
const RECEBER = CONTA_AZUL_RESOURCES.contasAReceber.path!;
const TAM = 100;
const MAX_PAGINAS = 90; // ~9k itens por fonte
const LOTE = 6;

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}
function spToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** Pagina um recurso do CA (por `total_itens` OU `itens_totais`) e devolve os itens. */
async function paginarTudo<T>(
  companyId: string,
  path: string,
  params: Record<string, string | number>,
): Promise<T[]> {
  const buscar = (pagina: number) =>
    caGet<{ total_itens?: number; itens_totais?: number; itens?: T[] }>(companyId, path, {
      ...params,
      pagina,
      tamanho_pagina: TAM,
    });
  const primeira = await buscar(1);
  const itens: T[] = [...(primeira.itens ?? [])];
  const total = primeira.total_itens ?? primeira.itens_totais ?? itens.length;
  const totalPaginas = Math.min(MAX_PAGINAS, Math.ceil(total / TAM));
  for (let inicio = 2; inicio <= totalPaginas; inicio += LOTE) {
    const fim = Math.min(inicio + LOTE - 1, totalPaginas);
    const paginas = [];
    for (let p = inicio; p <= fim; p++) paginas.push(buscar(p));
    const resps = await Promise.all(paginas);
    for (const r of resps) itens.push(...(r.itens ?? []));
  }
  return itens;
}

interface VendaApi {
  data?: string | null;
  total?: unknown;
  cliente?: { id?: string; nome?: string } | null;
  situacao?: { nome?: string } | null;
}
interface ReceberApi {
  nao_pago?: unknown;
  data_vencimento?: string | null;
  cliente?: { id?: string; nome?: string } | null;
}

async function computeClientes(companyId: string): Promise<ClientesResumo> {
  const hoje = spToday();
  const atualizadoEm = new Date().toISOString();

  try {
    const [vendas, receber] = await Promise.all([
      paginarTudo<VendaApi>(companyId, VENDAS, {}),
      paginarTudo<ReceberApi>(companyId, RECEBER, {
        data_vencimento_de: "2018-01-01",
        data_vencimento_ate: "2035-12-31",
      }),
    ]);

    const mapa = new Map<string, ClienteRow>();
    const chave = (c?: { id?: string; nome?: string } | null) =>
      c?.id ?? (c?.nome ?? "").trim().toLowerCase() ?? "";
    const pega = (c?: { id?: string; nome?: string } | null): ClienteRow => {
      const key = chave(c) || "__sem__";
      let row = mapa.get(key);
      if (!row) {
        row = {
          id: c?.id ?? null,
          nome: (c?.nome ?? "").trim() || "Sem cliente",
          ltv: 0,
          nCompras: 0,
          ultimaCompra: null,
          emAberto: 0,
          vencido: 0,
          situacao: "adimplente",
        };
        mapa.set(key, row);
      }
      return row;
    };

    for (const v of vendas) {
      if ((v.situacao?.nome ?? "").toUpperCase() === "CANCELADO") continue;
      const row = pega(v.cliente);
      row.ltv += num(v.total);
      row.nCompras += 1;
      const d = v.data ?? null;
      if (d && (!row.ultimaCompra || d > row.ultimaCompra)) row.ultimaCompra = d;
    }

    for (const r of receber) {
      const naoPago = num(r.nao_pago);
      if (naoPago <= 0) continue;
      const row = pega(r.cliente);
      row.emAberto += naoPago;
      const venc = r.data_vencimento ?? "";
      if (venc && venc < hoje) row.vencido += naoPago;
    }

    const clientes = [...mapa.values()];
    for (const c of clientes) c.situacao = c.vencido > 0 ? "inadimplente" : "adimplente";
    clientes.sort((a, b) => b.ltv - a.ltv || b.emAberto - a.emAberto);

    const totais = clientes.reduce(
      (t, c) => ({
        qtd: t.qtd + 1,
        inadimplentes: t.inadimplentes + (c.situacao === "inadimplente" ? 1 : 0),
        ltv: t.ltv + c.ltv,
        emAberto: t.emAberto + c.emAberto,
        vencido: t.vencido + c.vencido,
      }),
      { qtd: 0, inadimplentes: 0, ltv: 0, emAberto: 0, vencido: 0 },
    );

    return { connected: true, clientes, totais, atualizadoEm };
  } catch (error) {
    const erro =
      error instanceof ContaAzulError ? error.message : "Falha ao consultar a Conta Azul.";
    return {
      connected: false,
      clientes: [],
      totais: { qtd: 0, inadimplentes: 0, ltv: 0, emAberto: 0, vencido: 0 },
      atualizadoEm,
      erro,
    };
  }
}

/** SWR 15 min (compõe vendas + recebíveis; varredura pesada). Ver `./cache`. */
export async function resumoClientes(
  companyId: string,
  opts: { force?: boolean } = {},
): Promise<ClientesResumo> {
  return swr(`clientes:${companyId}`, 15 * 60_000, () => computeClientes(companyId), {
    force: opts.force,
    cacheIf: (d) => d.connected,
  });
}
