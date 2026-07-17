/**
 * Snapshot de receita do Conta Azul (Passo 10). Lê contas-a-receber do CA (client
 * validado), resolve `bu_id` via `fin_categorias` (por `ca_categoria_id`) e faz
 * UPSERT por `ca_evento_id` em `fin_receita_snapshot`. Idempotente (não duplica).
 * Tolera token expirado: degrada (`connected:false`), nunca quebra nem apaga o
 * snapshot. Sync SEMPRE pela app (nunca refresh em processo separado → evita a
 * corrida de refresh_token no deploy). Server-only.
 */
import "server-only";

import { caGet, ContaAzulError } from "@/lib/contaazul/client";
import { CONTA_AZUL_RESOURCES } from "@/lib/contaazul/config";
import { createAdminClient } from "@/lib/supabase/admin";

interface EventoReceita {
  id?: string | null;
  total?: unknown;
  data_competencia?: string | null;
  data_vencimento?: string | null;
  data_pagamento?: string | null;
  data_recebimento?: string | null;
  status?: string | null;
  situacao?: string | null;
  categorias?: Array<{ id?: string | null }> | null;
}
interface BuscaResp {
  itens?: EventoReceita[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 'AAAA-MM-DD' de hoje + delta meses (dia 1). */
function ymdAddMonths(delta: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + delta, 1));
  return d.toISOString().slice(0, 10);
}

async function fetchRecebiveis(
  companyId: string,
  de: string,
  ate: string,
): Promise<EventoReceita[]> {
  const path = CONTA_AZUL_RESOURCES.contasAReceber.path!;
  const out: EventoReceita[] = [];
  for (let pagina = 1; pagina <= 60; pagina++) {
    const resp = await caGet<BuscaResp>(companyId, path, {
      data_vencimento_de: de,
      data_vencimento_ate: ate,
      pagina,
      tamanho_pagina: 100,
    });
    const itens = resp.itens ?? [];
    out.push(...itens);
    if (itens.length < 100) break;
  }
  return out;
}

const foiRecebido = (e: EventoReceita): boolean =>
  !!(e.data_pagamento || e.data_recebimento) ||
  /receb|pag|quit/i.test(`${e.status ?? ""} ${e.situacao ?? ""}`);

export interface SyncReceitaResult {
  connected: boolean;
  janela: { de: string; ate: string };
  lidos: number;
  gravados: number;
  semId: number;
  semCategoria: number;
  sincronizadoEm: string | null;
  erro?: string;
}

/**
 * Sincroniza a receita da janela (default: últimos 12 meses até +1 mês, por
 * vencimento). Upsert por `ca_evento_id`. Degrada em erro do CA.
 */
export async function sincronizarReceita(
  companyId: string,
  meses = 12,
): Promise<SyncReceitaResult> {
  const de = ymdAddMonths(-meses);
  const ate = ymdAddMonths(1);
  const janela = { de, ate };

  let eventos: EventoReceita[];
  try {
    eventos = await fetchRecebiveis(companyId, de, ate);
  } catch (e) {
    const erro =
      e instanceof ContaAzulError
        ? e.message
        : `Falha ao ler o Conta Azul: ${(e as Error).message}`;
    return {
      connected: false,
      janela,
      lidos: 0,
      gravados: 0,
      semId: 0,
      semCategoria: 0,
      sincronizadoEm: null,
      erro,
    };
  }

  const admin = createAdminClient();

  // de-para: ca_categoria_id → { fin_categoria_id, bu_id }
  const { data: cats, error: eCat } = await admin
    .from("fin_categorias")
    .select("id, ca_categoria_id, bu_id")
    .eq("company_id", companyId)
    .not("ca_categoria_id", "is", null);
  if (eCat) throw new Error(`sincronizarReceita (categorias): ${eCat.message}`);
  const porCaCat = new Map<string, { id: string; bu_id: string | null }>();
  for (const c of cats ?? [])
    porCaCat.set(c.ca_categoria_id as string, {
      id: c.id as string,
      bu_id: (c.bu_id as string | null) ?? null,
    });

  const sincronizadoEm = new Date().toISOString();
  let semId = 0;
  let semCategoria = 0;

  const rows = [];
  for (const e of eventos) {
    if (!e.id) {
      semId++;
      continue;
    }
    const caCat = e.categorias?.[0]?.id ?? null;
    const map = caCat ? porCaCat.get(caCat) : undefined;
    if (!map) semCategoria++;
    rows.push({
      company_id: companyId,
      ca_evento_id: e.id,
      categoria_id: map?.id ?? null,
      bu_id: map?.bu_id ?? null,
      valor: Math.abs(num(e.total)),
      data_competencia: e.data_competencia ?? e.data_vencimento ?? null,
      data_vencimento: e.data_vencimento ?? null,
      data_pagamento: e.data_pagamento ?? e.data_recebimento ?? null,
      recebido: foiRecebido(e),
      sincronizado_em: sincronizadoEm,
      updated_at: sincronizadoEm,
    });
  }

  if (rows.length > 0) {
    const { error } = await admin
      .from("fin_receita_snapshot")
      .upsert(rows, { onConflict: "company_id,ca_evento_id" });
    if (error) throw new Error(`sincronizarReceita (upsert): ${error.message}`);
  }

  return {
    connected: true,
    janela,
    lidos: eventos.length,
    gravados: rows.length,
    semId,
    semCategoria,
    sincronizadoEm,
  };
}

export interface ReceitaCompetencia {
  competencia: string; // 'AAAA-MM'
  total: number;
  recebido: number;
}
export interface ResumoReceita {
  meses: ReceitaCompetencia[];
  sincronizadoEm: string | null;
}

/** Resumo do snapshot por competência (mês), com total e o quanto já foi recebido. */
export async function resumoReceita(companyId: string): Promise<ResumoReceita> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_receita_snapshot")
    .select("valor, recebido, data_competencia, sincronizado_em")
    .eq("company_id", companyId);
  if (error) throw new Error(`resumoReceita: ${error.message}`);

  const porMes = new Map<string, ReceitaCompetencia>();
  let sincronizadoEm: string | null = null;
  for (const r of data ?? []) {
    const comp = (r.data_competencia as string | null)?.slice(0, 7);
    if (comp) {
      const cur = porMes.get(comp) ?? { competencia: comp, total: 0, recebido: 0 };
      cur.total += num(r.valor);
      if (r.recebido) cur.recebido += num(r.valor);
      porMes.set(comp, cur);
    }
    const s = r.sincronizado_em as string | null;
    if (s && (!sincronizadoEm || s > sincronizadoEm)) sincronizadoEm = s;
  }

  const meses = [...porMes.values()].sort((a, b) => b.competencia.localeCompare(a.competencia));
  return { meses, sincronizadoEm };
}
