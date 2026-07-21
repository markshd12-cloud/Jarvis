/**
 * Inadimplentes (Conta Azul) — contas a receber VENCIDAS e não pagas, agrupadas
 * por cliente. Mesma fonte do Dashboard/DRE (`contas-a-receber/buscar`), só que
 * varrendo todo o histórico de vencimentos e ficando com o que está em aberto e
 * vencido (`nao_pago > 0` e `data_vencimento < hoje`). Espelha a tela
 * "Inadimplentes" do próprio Conta Azul. Server-only, gated por `financeiro`.
 *
 * O total reconstruído aqui bate com `totais.vencido` da API (fonte de verdade).
 */
import "server-only";

import { caGet, ContaAzulError } from "@/lib/contaazul/client";
import { CONTA_AZUL_RESOURCES } from "@/lib/contaazul/config";
import { swr } from "@/lib/financeiro/cache";

/** Um lançamento vencido de um cliente. */
export interface InadimplenteItem {
  id: string;
  descricao: string;
  /** Vencimento 'AAAA-MM-DD'. */
  vencimento: string;
  /** Valor em aberto (`nao_pago`). */
  valor: number;
}

/** Cliente inadimplente com seus lançamentos e total em aberto. */
export interface InadimplenteCliente {
  cliente: string;
  clienteId: string | null;
  total: number;
  itens: InadimplenteItem[];
}

export interface InadimplentesResult {
  connected: boolean;
  /** Total geral em aberto vencido (soma de `nao_pago`). */
  total: number;
  /** `totais.vencido` reportado pela própria API (sanity/reconciliação). */
  totalApi: number;
  /** Nº de lançamentos vencidos. */
  registros: number;
  clientes: InadimplenteCliente[];
  atualizadoEm: string;
  erro?: string;
}

const RECEBER = CONTA_AZUL_RESOURCES.contasAReceber.path!;

// Janela de varredura: bem no passado até hoje (pega inadimplência antiga também).
const DESDE = "2018-01-01";
const TAM = 100;
const MAX_PAGINAS = 120; // trava anti-runaway (~12k lançamentos)
const LOTE = 6; // páginas simultâneas

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

/** Hoje em 'AAAA-MM-DD', fuso de São Paulo (mesmo eixo do resto do financeiro). */
function spToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

interface ApiItem {
  id?: string;
  descricao?: string | null;
  total?: unknown;
  nao_pago?: unknown;
  data_vencimento?: string | null;
  cliente?: { id?: string; nome?: string } | null;
}
interface ApiResp {
  itens_totais?: number;
  itens?: ApiItem[];
  totais?: { vencido?: { valor?: unknown } | null } | null;
}

async function computeInadimplentes(companyId: string): Promise<InadimplentesResult> {
  const hoje = spToday();
  const atualizadoEm = new Date().toISOString();

  try {
    const buscar = (pagina: number) =>
      caGet<ApiResp>(companyId, RECEBER, {
        data_vencimento_de: DESDE,
        data_vencimento_ate: hoje,
        pagina,
        tamanho_pagina: TAM,
      });

    // Página 1 traz `totais` (agregado de toda a consulta) e `itens_totais`.
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

    const grupos = new Map<string, InadimplenteCliente>();
    let total = 0;
    let registros = 0;

    for (const it of itens) {
      const naoPago = num(it.nao_pago);
      const venc = it.data_vencimento ?? "";
      // Inadimplente = em aberto e vencido (vence hoje NÃO conta, igual ao CA).
      if (naoPago <= 0 || !venc || venc >= hoje) continue;

      const nome = (it.cliente?.nome ?? "").trim() || "Sem cliente";
      const grupo =
        grupos.get(nome) ??
        { cliente: nome, clienteId: it.cliente?.id ?? null, total: 0, itens: [] };
      grupo.total += naoPago;
      grupo.itens.push({
        id: it.id ?? "",
        descricao: (it.descricao ?? "").trim() || "—",
        vencimento: venc,
        valor: naoPago,
      });
      grupos.set(nome, grupo);
      total += naoPago;
      registros += 1;
    }

    const clientes = [...grupos.values()].sort((a, b) => b.total - a.total);
    for (const c of clientes) c.itens.sort((a, b) => a.vencimento.localeCompare(b.vencimento));

    return {
      connected: true,
      total,
      totalApi: num(primeira.totais?.vencido?.valor),
      registros,
      clientes,
      atualizadoEm,
    };
  } catch (error) {
    const erro =
      error instanceof ContaAzulError
        ? error.message
        : "Falha ao consultar a Conta Azul.";
    return {
      connected: false,
      total: 0,
      totalApi: 0,
      registros: 0,
      clientes: [],
      atualizadoEm,
      erro,
    };
  }
}

/** SWR 10 min (serve instantâneo + revalida em background). Ver `./cache`. */
export async function listarInadimplentes(
  companyId: string,
  opts: { force?: boolean } = {},
): Promise<InadimplentesResult> {
  return swr(`inadimplentes:${companyId}`, 10 * 60_000, () => computeInadimplentes(companyId), {
    force: opts.force,
    cacheIf: (d) => d.connected,
  });
}
