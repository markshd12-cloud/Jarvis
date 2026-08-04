/**
 * Recorrências (Passo 8): despesas fixas (aluguel, salário, assinatura) que se
 * MATERIALIZAM em despesa+parcela por competência. Server-only, escopado por
 * `companyId`. A materialização é idempotente — chave `recorrencia_id + competência`
 * (mês). Editar a recorrência NÃO mexe nas parcelas já geradas. Dia inválido no mês
 * (ex.: 31 em fev) cai no último dia. `anual` gera só no mês de criação (created_at).
 */
import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { mesCorrente } from "./competencia";
import {
  buPrincipal,
  inserirRateios,
  rateioLinhaSchema,
  validarRateio,
  type RateioLinha,
} from "./rateio";
import {
  fkFriendly,
  PASSO_MESES,
  PERIODICIDADES,
  type FinRecorrencia,
  type Periodicidade,
} from "./types";

export const recorrenciaInputSchema = z.object({
  descricao: z.string().trim().min(1, "descrição obrigatória"),
  categoria_id: z.string().uuid("categoria obrigatória"),
  bu_id: z.string().uuid("BU obrigatória"),
  centro_custo_id: z.string().uuid().nullish(),
  colaborador_id: z.string().uuid().nullish(),
  valor_previsto: z.coerce.number().nonnegative(),
  dia_vencimento: z.coerce.number().int().min(1).max(31),
  periodicidade: z.enum(PERIODICIDADES as [string, ...string[]]),
  // Rateio por BU da despesa gerada. Vazio/ausente = 100% na bu_id.
  rateio: rateioLinhaSchema.array().nullish(),
  // 1ª competência a gerar ('AAAA-MM'). Evita a 1ª parcela nascer VENCIDA
  // (recorrência criada dia 31 c/ vencimento dia 5). Null = sem restrição.
  inicio_competencia: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "competência AAAA-MM")
    .nullish(),
  // Meses entre a COMPETÊNCIA e o VENCIMENTO. 0 = mesmo mês; 1 = paga no mês
  // seguinte (folha, aluguel, encargos). Ver 0033 e o doc da defasagem.
  defasagem_meses: z.coerce.number().int().min(-12).max(12).optional(),
  // Repassado à parcela gerada. Texto livre como em fin_parcelas — a lista de
  // sugestões é METODOS_PAGAMENTO. Ver 0034.
  metodo_pagamento: z.string().trim().nullish(),
});
export type RecorrenciaInput = z.infer<typeof recorrenciaInputSchema>;

export async function listRecorrencias(companyId: string): Promise<FinRecorrencia[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_recorrencias")
    .select("*")
    .eq("company_id", companyId)
    .order("descricao", { ascending: true });
  if (error) throw new Error(`listRecorrencias: ${error.message}`);
  return (data ?? []) as FinRecorrencia[];
}

export async function createRecorrencia(
  companyId: string,
  input: RecorrenciaInput,
): Promise<FinRecorrencia> {
  const v = recorrenciaInputSchema.parse(input);
  if (v.rateio?.length) {
    validarRateio(v.rateio);
    // Com rateio, a bu_id vira a principal (maior %) — o rateio manda na quebra.
    v.bu_id = buPrincipal(v.rateio) ?? v.bu_id;
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_recorrencias")
    .insert({ company_id: companyId, ...v, rateio: v.rateio?.length ? v.rateio : null })
    .select("*")
    .single();
  if (error) throw new Error(`createRecorrencia: ${error.message}`);
  return data as FinRecorrencia;
}

export async function updateRecorrencia(
  companyId: string,
  id: string,
  input: Partial<RecorrenciaInput>,
): Promise<FinRecorrencia> {
  const v = recorrenciaInputSchema.partial().parse(input);
  if (v.rateio?.length) {
    validarRateio(v.rateio);
    v.bu_id = buPrincipal(v.rateio) ?? v.bu_id;
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_recorrencias")
    .update({ ...v, ...(v.rateio !== undefined ? { rateio: v.rateio?.length ? v.rateio : null } : {}) })
    .eq("company_id", companyId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`updateRecorrencia: ${error.message}`);

  /**
   * Reflete a edição nos meses FUTUROS já gerados (não pagos): apaga e regera
   * com os valores novos. Sem isto, mudar o salário deixaria o DRE do ano
   * inteiro com o valor antigo — o horizonte de 12 meses transformaria um
   * incômodo pequeno numa armadilha silenciosa.
   *
   * Passado e parcela paga NUNCA se mexem (ver `despesasFuturasIntocadas`).
   */
  await removerFuturosGerados(companyId, id);
  await materializarHorizonte(companyId);

  return data as FinRecorrencia;
}

export async function setRecorrenciaAtivo(
  companyId: string,
  id: string,
  ativo: boolean,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("fin_recorrencias")
    .update({ ativo })
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw new Error(`setRecorrenciaAtivo: ${error.message}`);
}

/**
 * Despesas GERADAS por uma recorrência que ainda são "futuras e intocadas":
 * competência >= o mês corrente e NENHUMA parcela paga. São as únicas seguras de
 * regerar/remover — passado e pagamento nunca se mexem.
 */
async function despesasFuturasIntocadas(
  companyId: string,
  recorrenciaId: string,
): Promise<{ ids: string[]; competencias: string[] }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_despesas")
    .select("id, fin_parcelas ( data_competencia, status )")
    .eq("company_id", companyId)
    .eq("recorrencia_id", recorrenciaId);
  if (error) throw new Error(`despesasFuturasIntocadas: ${error.message}`);

  const atual = mesCorrente();
  const ids: string[] = [];
  const competencias: string[] = [];
  for (const d of data ?? []) {
    const ps = (d.fin_parcelas ?? []) as { data_competencia: string; status: string }[];
    if (!ps.length) continue;
    if (ps.some((p) => p.status === "paga")) continue; // já pago: não se toca
    const comp = String(ps[0].data_competencia).slice(0, 7);
    if (comp < atual) continue; // passado: histórico, não se toca
    ids.push(d.id as string);
    competencias.push(comp);
  }
  return { ids, competencias };
}

/** Quantos meses futuros (não pagos) esta recorrência tem gerados. */
export async function contarFuturosGerados(
  companyId: string,
  recorrenciaId: string,
): Promise<number> {
  return (await despesasFuturasIntocadas(companyId, recorrenciaId)).ids.length;
}

/** Remove as despesas futuras não pagas geradas por esta recorrência. */
export async function removerFuturosGerados(
  companyId: string,
  recorrenciaId: string,
): Promise<number> {
  const { ids } = await despesasFuturasIntocadas(companyId, recorrenciaId);
  if (!ids.length) return 0;
  const admin = createAdminClient();
  // Parcelas e rateios caem por cascade (0023).
  const { error } = await admin
    .from("fin_despesas")
    .delete()
    .eq("company_id", companyId)
    .in("id", ids);
  if (error) throw new Error(`removerFuturosGerados: ${error.message}`);
  return ids.length;
}

/** Exclui. FK `on delete set null` nas despesas geradas — solta o vínculo, não apaga. */
export async function deleteRecorrencia(companyId: string, id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("fin_recorrencias")
    .delete()
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw new Error(fkFriendly(error, "Recorrência"));
}

const ultimoDiaDoMes = (ano: number, mes1a12: number) =>
  new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate();

/** Meses de `de` até `ate` ('AAAA-MM'). Negativo se `ate` for anterior. */
export function mesesEntre(de: string, ate: string): number {
  const [a1, m1] = de.split("-").map(Number);
  const [a2, m2] = ate.split("-").map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
}

/**
 * A competência cai no ciclo da recorrência?
 *
 * Regra única para todas as periodicidades: conta os meses desde a âncora e
 * checa se são múltiplos do passo (mensal 1, bimestral 2, trimestral 3,
 * semestral 6, anual 12). Mensal aceita tudo, então nem calcula.
 *
 * A âncora é `inicio_competencia`; sem ela, o mês de criação — que preserva o
 * comportamento anterior do 'anual', o único ciclo > 1 que existia antes da 0035.
 * Sem nenhuma das duas não há como saber onde o ciclo começa: gera todo mês, que
 * é o que o sistema fazia antes e nunca esconde despesa.
 */
export function cabeNoCiclo(
  r: Pick<FinRecorrencia, "periodicidade" | "inicio_competencia"> & {
    created_at?: string | null;
  },
  competencia: string, // 'AAAA-MM'
): boolean {
  const passo = PASSO_MESES[r.periodicidade as Periodicidade] ?? 1;
  if (passo === 1) return true;
  const ancora = r.inicio_competencia ?? (r.created_at ?? "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ancora)) return true;
  const diff = mesesEntre(ancora, competencia);
  return diff >= 0 && diff % passo === 0;
}

/**
 * Data de VENCIMENTO a partir da competência + defasagem.
 *
 * A competência é o mês a que a despesa se refere; o vencimento pode cair meses
 * depois (folha de julho paga em 05/agosto → defasagem 1). O dia é limitado ao
 * último dia do mês de destino (dia 31 em fevereiro vira 28/29).
 */
export function vencimentoDaCompetencia(
  competencia: string, // 'AAAA-MM'
  diaVencimento: number,
  defasagemMeses: number,
): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const d = new Date(Date.UTC(ano, mes - 1 + defasagemMeses, 1));
  const vAno = d.getUTCFullYear();
  const vMes = d.getUTCMonth() + 1;
  const dia = Math.min(diaVencimento, ultimoDiaDoMes(vAno, vMes));
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${vAno}-${p2(vMes)}-${p2(dia)}`;
}

/**
 * Materializa as recorrências ativas na competência (mês). Idempotente: pula quem
 * já tem despesa gerada naquele mês. Retorna quantas geradas e quantas puladas.
 *
 * A COMPETÊNCIA é sempre o mês pedido; o VENCIMENTO é deslocado pela
 * `defasagem_meses` da recorrência (folha de julho → vence 05/agosto).
 */
export async function materializar(
  companyId: string,
  competencia: string, // "AAAA-MM"
): Promise<{ gerados: number; pulados: number; erros: string[] }> {
  if (!/^\d{4}-\d{2}$/.test(competencia))
    throw new Error("competência inválida (AAAA-MM)");

  const admin = createAdminClient();
  const recs = (await listRecorrencias(companyId)).filter((r) => r.ativo);

  /**
   * Despesas já geradas por recorrência (qualquer competência) → mês da 1ª parcela.
   *
   * PAGINADO. O PostgREST devolve no máximo 1000 linhas por requisição, em
   * silêncio. Sem o laço, a partir da 1000ª despesa de recorrência as demais
   * ficavam invisíveis para o `jaNoMes` abaixo — e a materialização recriava
   * competências que já existiam, duplicando a despesa no DRE. O bug só aparece
   * depois de ~84 recorrências (84 × 12 meses = 1008), então passou despercebido
   * até a carteira crescer.
   */
  const jaGeradas: { id: string; recorrencia_id: string; fin_parcelas?: { data_competencia: string }[] }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error: eJa } = await admin
      .from("fin_despesas")
      .select("id, recorrencia_id, fin_parcelas ( data_competencia )")
      .eq("company_id", companyId)
      .not("recorrencia_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (eJa) throw new Error(`materializar (existentes): ${eJa.message}`);
    const lote = (data ?? []) as typeof jaGeradas;
    jaGeradas.push(...lote);
    if (lote.length < PAGE) break;
  }

  const jaNoMes = new Set<string>();
  for (const d of jaGeradas ?? []) {
    const ps = (d.fin_parcelas ?? []) as { data_competencia: string }[];
    for (const p of ps) {
      if (p.data_competencia?.slice(0, 7) === competencia)
        jaNoMes.add(d.recorrencia_id as string);
    }
  }

  let gerados = 0;
  let pulados = 0;
  const erros: string[] = [];

  for (const r of recs) {
    // Ainda não começou: só gera de `inicio_competencia` em diante.
    if (r.inicio_competencia && competencia < r.inicio_competencia) continue;
    if (!cabeNoCiclo(r, competencia)) continue;
    if (jaNoMes.has(r.id)) {
      pulados++;
      continue;
    }

    const dataComp = `${competencia}-01`;
    const dataVenc = vencimentoDaCompetencia(
      competencia,
      r.dia_vencimento,
      r.defasagem_meses ?? 0,
    );

    const { data: desp, error: e1 } = await admin
      .from("fin_despesas")
      .insert({
        company_id: companyId,
        descricao: r.descricao,
        categoria_id: r.categoria_id,
        centro_custo_id: r.centro_custo_id ?? null,
        colaborador_id: r.colaborador_id,
        valor_total: r.valor_previsto,
        num_parcelas: 1,
        recorrencia_id: r.id,
      })
      .select("id")
      .single();
    if (e1) {
      erros.push(`${r.descricao}: ${e1.message}`);
      continue;
    }
    const { data: parc, error: e2 } = await admin
      .from("fin_parcelas")
      .insert({
        company_id: companyId,
        despesa_id: desp.id,
        numero: 1,
        bu_id: r.bu_id,
        valor_previsto: r.valor_previsto,
        data_competencia: dataComp,
        data_vencimento: dataVenc,
        // Vem do molde: preencher só na parcela não sobrevive a uma edição da
        // recorrência, que apaga e refaz as futuras não pagas.
        metodo_pagamento: r.metodo_pagamento ?? null,
        status: "a_pagar",
      })
      .select("id")
      .single();
    if (e2) {
      await admin.from("fin_despesas").delete().eq("company_id", companyId).eq("id", desp.id);
      erros.push(`${r.descricao}: ${e2.message}`);
      continue;
    }
    // Rateio da recorrência → fin_despesa_rateio da parcela gerada (rateio manda;
    // a bu_id acima é só a principal). Falha aqui não desfaz a despesa: registra
    // no erro e a parcela fica 100% na BU principal até ser corrigida.
    if (r.rateio?.length) {
      try {
        await inserirRateios(companyId, [
          { parcelaId: parc.id as string, linhas: r.rateio as RateioLinha[] },
        ]);
      } catch (e) {
        erros.push(`${r.descricao} (rateio): ${(e as Error).message}`);
      }
    }
    gerados++;
  }

  return { gerados, pulados, erros };
}

/** Horizonte padrão: um ano à frente. */
export const HORIZONTE_MESES = 12;

/**
 * Materializa um HORIZONTE de meses a partir do mês corrente (default: 12).
 *
 * Por quê: uma despesa parcelada em 12x já nasce com as 12 parcelas visíveis no
 * DRE dos meses futuros; a recorrência, que é ainda MAIS certa (aluguel, folha),
 * aparecia só no mês corrente e o resto do ano ficava vazio. O horizonte elimina
 * essa assimetria — o DRE do ano inteiro passa a refletir o que já se sabe.
 *
 * Idempotente por construção (delega a `materializar`, que pula o mês já gerado),
 * então rodar todo dia é seguro e mantém a janela rolando.
 */
export async function materializarHorizonte(
  companyId: string,
  meses = HORIZONTE_MESES,
  aPartirDe?: string,
): Promise<{ gerados: number; pulados: number; erros: string[]; competencias: string[] }> {
  const base = aPartirDe ?? mesCorrente();
  const [ano, mes] = base.split("-").map(Number);
  let gerados = 0;
  let pulados = 0;
  const erros: string[] = [];
  const competencias: string[] = [];

  for (let i = 0; i < meses; i++) {
    const d = new Date(Date.UTC(ano, mes - 1 + i, 1));
    const comp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    competencias.push(comp);
    const r = await materializar(companyId, comp);
    gerados += r.gerados;
    pulados += r.pulados;
    erros.push(...r.erros);
  }
  return { gerados, pulados, erros, competencias };
}
