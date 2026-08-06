/**
 * Custo de Marketing/Comercial no BANCO PRÓPRIO do Jarvis — a fonte do CAC de
 * agosto/2026 em diante.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Até julho/2026 as despesas viviam no Conta Azul, e
 * o CAC lia de lá (`lib/financeiro/centros-custo.ts`, que diz explicitamente que
 * `fin_despesas` "não serve"). Isso deixou de valer quando as recorrências foram
 * importadas para cá e canceladas no CA a partir de agosto. Resultado medido: o
 * CAC enxergava **R$ 3.707,76** em agosto contra **R$ 65.363,45** reais — 6% do
 * custo. Ver `docs/cac-fontes.md`.
 *
 * DUAS MELHORIAS SOBRE A LEITURA DO CA:
 *  - **BU de verdade.** O CA obrigava adivinhar a unidade pelo NOME do centro
 *    ("Unicive marketing" → Unicive). Aqui `fin_parcelas.bu_id` é uma chave
 *    estrangeira, preenchida em 100% das parcelas verificadas.
 *  - **Competência.** O CA fatiava por vencimento; aqui existe
 *    `data_competencia`, que é o mês a que o custo pertence de fato.
 *
 * Só LÊ o financeiro — não escreve nada.
 */
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/** Tipo de custo que entra no CAC (mesma classificação usada para o CA). */
export type CustoTipo = "marketing" | "comercial";

export interface CustoLinha {
  /** Competência 'AAAA-MM'. */
  mes: string;
  /** Nome da BU (`business_units.nome`), ou 'Sem BU' se a parcela não tiver. */
  bu: string;
  tipo: CustoTipo;
  centro: string;
  previsto: number;
  /** Só o que tem `data_pagamento`. Sem pagamento não há realizado. */
  realizado: number;
}

/** Centro de custo cujo nome indica Marketing ou Comercial. */
function tipoDoCentro(nome: string): CustoTipo | null {
  const n = (nome ?? "").toLowerCase();
  if (/marketing|mkt/.test(n)) return "marketing";
  if (/comercial|vendas/.test(n)) return "comercial";
  return null;
}

/** Fatia um array em lotes — `.in()` com muitos UUIDs estoura o tamanho da URL. */
function lotes<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Paginação com `order` explícito.
 *
 * `range()` sem `order` é INSTÁVEL no PostgREST: a ordem entre páginas não é
 * garantida, e linhas se repetem ou somem. Já custou uma apuração errada neste
 * projeto — sempre ordenar por uma coluna única.
 */
async function paginado<T>(
  monta: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await monta(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Custo de Marketing/Comercial por mês, BU e tipo, no intervalo de competências.
 *
 * Exclui despesa cancelada e parcela cancelada — elas continuam na tabela para
 * histórico, e somá-las inflaria o custo com dinheiro que não vai sair.
 */
export async function custoBancoProprio(
  companyId: string,
  de: string,
  ate: string,
): Promise<CustoLinha[]> {
  const admin = createAdminClient();

  // 1. Centros de Marketing/Comercial.
  const { data: centros, error: eC } = await admin
    .from("fin_centros_custo")
    .select("id, nome")
    .eq("company_id", companyId);
  if (eC) throw new Error(`custoBancoProprio/centros: ${eC.message}`);

  const tipoPorCentro = new Map<string, { tipo: CustoTipo; nome: string }>();
  for (const c of centros ?? []) {
    const tipo = tipoDoCentro(c.nome as string);
    if (tipo) tipoPorCentro.set(c.id as string, { tipo, nome: c.nome as string });
  }
  if (tipoPorCentro.size === 0) return [];

  // 2. Nomes das BUs.
  const { data: bus } = await admin
    .from("business_units")
    .select("id, nome")
    .eq("company_id", companyId);
  const nomeBu = new Map((bus ?? []).map((b) => [b.id as string, b.nome as string]));

  // 3. Despesas desses centros, ignorando as canceladas.
  const idsCentro = [...tipoPorCentro.keys()];
  const despesas: { id: string; centro_custo_id: string }[] = [];
  for (const lote of lotes(idsCentro, 50)) {
    despesas.push(
      ...(await paginado<{ id: string; centro_custo_id: string }>((from, to) =>
        admin
          .from("fin_despesas")
          .select("id, centro_custo_id")
          .eq("company_id", companyId)
          .in("centro_custo_id", lote)
          .eq("cancelada", false)
          .order("id", { ascending: true })
          .range(from, to),
      )),
    );
  }
  if (despesas.length === 0) return [];

  const centroDaDespesa = new Map(
    despesas.map((d) => [d.id, tipoPorCentro.get(d.centro_custo_id)!]),
  );

  // 4. Parcelas dentro da janela de competência.
  interface ParcelaRow {
    despesa_id: string;
    bu_id: string | null;
    valor_previsto: number | null;
    valor_realizado: number | null;
    data_competencia: string | null;
    data_pagamento: string | null;
    status: string | null;
  }
  const parcelas: ParcelaRow[] = [];
  for (const lote of lotes(despesas.map((d) => d.id), 100)) {
    parcelas.push(
      ...(await paginado<ParcelaRow>((from, to) =>
        admin
          .from("fin_parcelas")
          .select(
            "despesa_id, bu_id, valor_previsto, valor_realizado, data_competencia, data_pagamento, status",
          )
          .in("despesa_id", lote)
          .gte("data_competencia", `${de}-01`)
          .lte("data_competencia", `${ate}-31`)
          .order("id", { ascending: true })
          .range(from, to),
      )),
    );
  }

  // 5. Agrega por (mês, BU, tipo, centro).
  const agg = new Map<string, CustoLinha>();
  for (const p of parcelas) {
    if (p.status === "cancelada") continue;
    const mes = (p.data_competencia ?? "").slice(0, 7);
    if (!mes) continue;
    const c = centroDaDespesa.get(p.despesa_id);
    if (!c) continue;

    const bu = p.bu_id ? (nomeBu.get(p.bu_id) ?? "Sem BU") : "Sem BU";
    const chave = `${mes}|${bu}|${c.tipo}|${c.nome}`;
    const linha =
      agg.get(chave) ??
      ({ mes, bu, tipo: c.tipo, centro: c.nome, previsto: 0, realizado: 0 } as CustoLinha);

    linha.previsto += Number(p.valor_previsto ?? 0);
    // Realizado exige pagamento. `valor_realizado` pode vir nulo numa baixa sem
    // ajuste de valor — nesse caso vale o previsto.
    if (p.data_pagamento)
      linha.realizado += Number(p.valor_realizado ?? p.valor_previsto ?? 0);

    agg.set(chave, linha);
  }

  return [...agg.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}
