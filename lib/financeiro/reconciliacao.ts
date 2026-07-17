/**
 * Reconciliação de despesa (Passo 11): compara, para uma competência, a despesa
 * do Conta Azul (ao vivo) com a das NOSSAS parcelas (fin_parcelas), por grupo do
 * DRE. É o PORTÃO antes do cutover: só vira o mês pra fonte Jarvis quando o Δ ≈ 0
 * (ou conscientemente). Como o import traz as despesas do CA pra dentro, o Δ
 * nasce zerado e só muda conforme você reestrutura — dá visibilidade do que falta.
 *
 * Ambos os lados são chaveados por `ca_categoria_id`; o grupo (01…08) vem de
 * `fin_categorias.grupo_dre`. Server-only.
 */
import "server-only";

import {
  despesaCaPorCategoria,
  despesaCaPorMes,
  despesaJarvisPorCategoria,
} from "@/lib/contaazul/dre";
import { createAdminClient } from "@/lib/supabase/admin";

export interface ReconGrupo {
  grupo: string; // '01'…'08' ou 'sem'
  label: string;
  ca: number;
  jarvis: number;
  delta: number; // jarvis - ca
}

export interface ReconciliacaoResult {
  connected: boolean;
  competencia: string;
  ca: number;
  jarvis: number;
  delta: number;
  /** |delta| pequeno o bastante para cortar o mês com segurança. */
  ok: boolean;
  porGrupo: ReconGrupo[];
  erro?: string;
}

/** Tolerância de casamento: 1 centavo. */
const TOL = 0.01;

export async function reconciliarDespesa(
  companyId: string,
  competencia: string,
): Promise<ReconciliacaoResult> {
  try {
    const [{ mapa: caMap }, { mapa: jarvisMap }] = await Promise.all([
      despesaCaPorCategoria(companyId, competencia),
      despesaJarvisPorCategoria(companyId, competencia),
    ]);

    const admin = createAdminClient();
    const { data: cats, error } = await admin
      .from("fin_categorias")
      .select("ca_categoria_id, grupo_dre")
      .eq("company_id", companyId)
      .not("ca_categoria_id", "is", null);
    if (error) throw new Error(error.message);
    const grupoByCa = new Map<string, string>();
    for (const c of cats ?? [])
      if (c.ca_categoria_id)
        grupoByCa.set(c.ca_categoria_id as string, (c.grupo_dre as string | null) ?? "sem");

    const agg = new Map<string, { ca: number; jarvis: number }>();
    const add = (m: Map<string, number>, lado: "ca" | "jarvis") => {
      for (const [caId, v] of m) {
        const g = grupoByCa.get(caId) ?? "sem";
        const cur = agg.get(g) ?? { ca: 0, jarvis: 0 };
        cur[lado] += v;
        agg.set(g, cur);
      }
    };
    add(caMap, "ca");
    add(jarvisMap, "jarvis");

    const porGrupo: ReconGrupo[] = [...agg.entries()]
      .map(([grupo, v]) => ({
        grupo,
        label: grupo === "sem" ? "Sem grupo DRE" : `Grupo ${grupo}`,
        ca: v.ca,
        jarvis: v.jarvis,
        delta: v.jarvis - v.ca,
      }))
      .sort((a, b) => a.grupo.localeCompare(b.grupo));

    const ca = [...caMap.values()].reduce((s, v) => s + v, 0);
    const jarvis = [...jarvisMap.values()].reduce((s, v) => s + v, 0);
    const delta = jarvis - ca;

    return {
      connected: true,
      competencia,
      ca,
      jarvis,
      delta,
      ok: Math.abs(delta) <= TOL,
      porGrupo,
    };
  } catch (e) {
    return {
      connected: false,
      competencia,
      ca: 0,
      jarvis: 0,
      delta: 0,
      ok: false,
      porGrupo: [],
      erro: (e as Error).message,
    };
  }
}

// ------------------------- Reconciliação de PERÍODO ------------------------- //

export interface ReconMes {
  competencia: string;
  ca: number;
  jarvis: number;
  delta: number;
  ok: boolean;
}
export interface ReconPeriodoResult {
  connected: boolean;
  meses: ReconMes[]; // recente → antigo
  totalCa: number;
  totalJarvis: number;
  erro?: string;
}

/** 'AAAA-MM-DD' de hoje + delta meses (dia 1). */
function ymdAddMonths(delta: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + delta, 1));
  return d.toISOString().slice(0, 10);
}
/** Competências 'AAAA-MM' dos últimos `meses` meses (recente → antigo). */
function ultimasCompetencias(meses: number): string[] {
  const now = new Date();
  return Array.from({ length: meses }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

/** Despesa do Jarvis (fin_parcelas) por competência, paginada (o select capa em 1000). */
async function jarvisPorMes(
  companyId: string,
  deComp: string,
  ateComp: string,
): Promise<Map<string, number>> {
  const admin = createAdminClient();
  const mapa = new Map<string, number>();
  for (let pagina = 0; ; pagina++) {
    const { data, error } = await admin
      .from("fin_parcelas")
      .select("valor_previsto, data_competencia, fin_despesas!inner ( cancelada )")
      .eq("company_id", companyId)
      .gte("data_competencia", deComp)
      .lte("data_competencia", ateComp)
      .neq("status", "cancelada")
      .eq("fin_despesas.cancelada", false)
      .range(pagina * 1000, pagina * 1000 + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const ym = (r.data_competencia as string | null)?.slice(0, 7);
      if (ym) mapa.set(ym, (mapa.get(ym) ?? 0) + Number(r.valor_previsto ?? 0));
    }
    if (!data || data.length < 1000) break;
  }
  return mapa;
}

/**
 * Conferência de VÁRIOS meses de uma vez (Δ CA × Jarvis por competência). Uma
 * leitura só do CA (faixa larga por vencimento, superset das janelas do DRE) +
 * uma varredura das parcelas. É o material para decidir o mês de cutover.
 */
export async function reconciliarPeriodo(
  companyId: string,
  meses = 12,
): Promise<ReconPeriodoResult> {
  try {
    const comps = ultimasCompetencias(meses);
    const deComp = `${comps[comps.length - 1]}-01`;
    const ateComp = `${comps[0]}-31`;
    // Vencimento: superset das janelas [C-2, C+3] de todas as competências.
    const deVenc = ymdAddMonths(-(meses + 2));
    const ateVenc = ymdAddMonths(4);

    const [caMes, jarMes] = await Promise.all([
      despesaCaPorMes(companyId, deVenc, ateVenc),
      jarvisPorMes(companyId, deComp, ateComp),
    ]);

    const linhas = comps.map((competencia) => {
      const ca = caMes.get(competencia) ?? 0;
      const jarvis = jarMes.get(competencia) ?? 0;
      const delta = jarvis - ca;
      return { competencia, ca, jarvis, delta, ok: Math.abs(delta) <= TOL };
    });
    return {
      connected: true,
      meses: linhas,
      totalCa: linhas.reduce((s, m) => s + m.ca, 0),
      totalJarvis: linhas.reduce((s, m) => s + m.jarvis, 0),
    };
  } catch (e) {
    return { connected: false, meses: [], totalCa: 0, totalJarvis: 0, erro: (e as Error).message };
  }
}
