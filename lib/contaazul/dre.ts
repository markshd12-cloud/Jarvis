/**
 * DRE Gerencial (Conta Azul) — cálculo por COMPETÊNCIA, realizado.
 *
 * Monta a MESMA estrutura do relatório do CA (grupos numerados 01…08, subgrupos
 * 03.1/03.2, folhas e linhas totalizadoras) a partir de duas fontes:
 *   - `/financeiro/categorias-dre`: a árvore do DRE + quais categorias financeiras
 *     entram em cada linha (mapa categoria→linha).
 *   - contas a pagar/receber: os lançamentos, com `total`, `data_competencia` e
 *     `categorias[{id}]`.
 *
 * Sinal pela FONTE: receber = +, pagar = − (bate com a print — deduções/custos/
 * despesas negativos, receitas positivas). Totalizadores = soma corrente. AV% é
 * sobre a Receita Bruta (grupo 01). Nunca lança: erro/desconexão → connected=false.
 */
import "server-only";

import { caGet } from "@/lib/contaazul/client";
import { CONTA_AZUL_RESOURCES } from "@/lib/contaazul/config";
import {
  getCutoverCompetencia,
  getDreEstruturaCache,
  saveDreEstruturaCache,
} from "@/lib/financeiro/dre-config";
import { expandirPorBu, listRateios } from "@/lib/financeiro/rateio";
import { createAdminClient } from "@/lib/supabase/admin";

const cents = (v: number) => Math.round(v * 100);

// ----------------------------- Tipos da API --------------------------------

interface DreCategoriaFin {
  id: string;
  nome: string;
  ativo: boolean;
}
interface DreItemApi {
  id: string;
  descricao: string;
  codigo: string | null;
  posicao: number;
  indica_totalizador: boolean;
  subitens: DreItemApi[];
  categorias_financeiras: DreCategoriaFin[];
}
interface DreStructResp {
  itens: DreItemApi[];
}
interface EventoDre {
  total?: unknown;
  data_competencia?: string | null;
  data_vencimento?: string | null;
  /** Carimbos de sincronização da CA (alimentam o selo de frescor). */
  data_emissao?: string | null;
  data_alteracao?: string | null;
  categorias?: Array<{ id?: string | null; nome?: string | null }> | null;
}
interface BuscaResp {
  itens_totais?: number;
  itens?: EventoDre[];
}

/**
 * Recorte do DRE — qual data decide em que mês a linha entra.
 *
 * - `competencia`: agrupa pelo mês a que a despesa/receita SE REFERE. O salário
 *   de julho pago em 05/08 cai em JULHO. É o resultado econômico do mês.
 * - `previsto-realizado`: agrupa pelo VENCIMENTO — "as contas que caem neste
 *   mês", como sempre foi antes da defasagem existir. Esse mesmo salário cai em
 *   AGOSTO.
 *
 * ⚠️ Não confundir com o Fluxo de Caixa, que não muda: lá o salário sai do caixa
 * em agosto (data de pagamento), independentemente do recorte escolhido aqui.
 */
export type DreRegime = "competencia" | "previsto-realizado";

// --------------------------- Tipos do resultado ----------------------------

export type DreChild = {
  label: string;
  /** REALIZADO (pago/recebido) com sinal do DRE. No modo CA (pré-cutover) = valor único. */
  valor: number;
  av: number;
  /** PREVISTO (comprometido/emitido) com sinal. No modo CA, igual a `valor`. */
  previsto: number;
  /** AV% do previsto (sobre a Receita Bruta prevista). */
  avPrev: number;
  /**
   * AV% da META, sobre a Receita Bruta **planejada** (não a realizada).
   *
   * Base própria de propósito: a meta é um plano inteiro e coerente consigo
   * mesmo. Medir a meta de despesa contra a receita que de fato entrou
   * misturaria dois mundos — num mês em que a receita frustrou, toda meta de
   * custo pareceria estourada em AV sem que ninguém tivesse gastado a mais.
   */
  avOrc: number;
  /**
   * Meta do mês (`fin_orcamentos`), já COM SINAL do DRE (receita +, despesa −).
   * 0 quando não há orçamento lançado para a categoria.
   */
  orcado: number;
  /**
   * A categoria TEM meta cadastrada? Distingue "meta = R$ 0,00" (alvo real: não
   * gastar nada) de "ninguém cadastrou" — `orcado` vale 0 nos dois casos e não
   * dá para inferir pelo valor. Sem isso, uma meta zero estourada apareceria
   * como "sem informação" em vez de estouro.
   */
  temMeta: boolean;
  /** Cabeçalho de subgrupo (03.1/03.2) — renderiza um pouco mais forte. */
  sub?: boolean;
  /**
   * Id da categoria financeira do CA desta FOLHA (subgrupos/grupos não têm).
   * Permite à UI editar a Meta direto no DRE (grava em `fin_orcamentos` via
   * de-para `ca_categoria_id` → `fin_categorias`).
   */
  caId?: string;
};
export type DreRow =
  | {
      kind: "group";
      codigo: string;
      label: string;
      valor: number;
      av: number;
      previsto: number;
      avPrev: number;
      orcado: number;
      avOrc: number;
      /** Alguma folha do grupo tem meta cadastrada. */
      temMeta: boolean;
      children: DreChild[];
    }
  | {
      kind: "subtotal";
      label: string;
      valor: number;
      av: number;
      previsto: number;
      avPrev: number;
      orcado: number;
      avOrc: number;
      /** Algum grupo acumulado até aqui tem meta cadastrada. */
      temMeta: boolean;
    };
export interface DreResult {
  connected: boolean;
  competencia: string;
  /** Receita Bruta REALIZADA (base do AV% realizado). */
  receitaBruta: number;
  /** Receita Bruta PREVISTA (base do AV% previsto). Igual à realizada no modo CA. */
  receitaBrutaPrev: number;
  /**
   * true = fonte Jarvis com colunas Previsto × Realizado de verdade (contas a
   * pagar entram no Previsto; ao pagar viram Realizado). false = modo CA
   * (pré-cutover), valor único — a UI mantém o layout antigo.
   */
  temPrevReal: boolean;
  rows: DreRow[];
  /** Valor de lançamentos cuja categoria não está em nenhuma linha do DRE. */
  semMapeamento: number;
  /**
   * Carimbo (ISO) do lançamento mais recente que a API da CA expôs neste fetch.
   * A API é eventualmente consistente — vendas do dia aparecem com atraso —,
   * então isto alimenta o selo "dados da CA até …" no DRE. `null` sem dados.
   */
  atualizadoAte: string | null;
  /**
   * false = nenhuma meta lançada para esta competência → a UI mostra estado-guia
   * em vez de uma coluna de zeros (que pareceria "orçamos R$ 0").
   */
  temOrcamento: boolean;
  /**
   * Quanto da competência já virou dinheiro: `realizado / previsto`, de 0 a 1,
   * por lado.
   *
   * É o que impede o painel de Fechamento de mentir. No dia 4 do mês a despesa
   * está em 0% liquidado (os vencimentos começam no dia 5), então Meta ×
   * Realizado mostraria −100% em tudo e pareceria catástrofe. Os dois lados vêm
   * separados porque se comportam diferente: a receita costuma liquidar acima de
   * 97%, a despesa varia com a rotina de baixa.
   *
   * `null` no lado sem nenhum previsto (divisão sem sentido).
   */
  liquidacao: { despesa: number | null; receita: number | null };
  /** Fonte da DESPESA nesta competência: 'jarvis' (≥ cutover) ou 'contaazul'. */
  despesaFonte: "contaazul" | "jarvis";
  /** Competência de cutover configurada (AAAA-MM), ou null se tudo vem do CA. */
  cutover: string | null;
  /**
   * Fonte da ESTRUTURA (árvore) do DRE: 'ca' = veio fresca do Conta Azul (e foi
   * regravada); 'cache' = o CA falhou e usamos a última árvore guardada. Deixa a
   * UI avisar quando o DRE está desenhado por uma cópia (CA fora do ar).
   */
  estruturaFonte?: "ca" | "cache";
  /** Carimbo (ISO) do último sync bem-sucedido da estrutura. */
  estruturaSyncAt?: string | null;
  /** Recorte usado nesta leitura (qual data decidiu o mês das linhas). */
  regime?: DreRegime;
  /**
   * Só no recorte `previsto-realizado`: os lançamentos que entraram neste mês
   * pelo VENCIMENTO mas cuja COMPETÊNCIA é de outro mês. É o "de onde veio" que
   * o DRE sozinho não mostra — e importa porque boa parte deles vem do import
   * do Conta Azul, cuja competência não segue a convenção de defasagem da casa.
   */
  foraDaCompetencia?: {
    total: number;
    /** Σ dos lançados no Jarvis — é a defasagem operando, não um problema. */
    totalProprio: number;
    /** Σ dos vindos do import do CA — competência definida lá fora, vale conferir. */
    totalImportado: number;
    itens: {
      descricao: string;
      categoria: string;
      competencia: string;
      vencimento: string;
      valor: number;
      /** true = veio do import do Conta Azul (fonte `ca_import`). */
      importado: boolean;
    }[];
  };
  aviso?: string;
}

// ------------------------------- Helpers -----------------------------------

/** 'AAAA-MM' + delta meses → 'AAAA-MM'. */
function ymAddMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function firstDay(ym: string): string {
  return `${ym}-01`;
}
function lastDay(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${ym}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function av(valor: number, base: number): number {
  return base ? (valor / base) * 100 : 0;
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Busca paginada dos eventos (por vencimento). Lança em erro de API. */
async function fetchEventos(
  companyId: string,
  path: string,
  de: string,
  ate: string,
): Promise<EventoDre[]> {
  const out: EventoDre[] = [];
  for (let pagina = 1; pagina <= 40; pagina++) {
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

/**
 * Despesa por categoria financeira do CA na competência, lida do Conta Azul ao
 * vivo (contas-a-pagar). Retorna a soma por `ca_categoria_id` + os carimbos de
 * frescor. Usada quando a competência é ANTERIOR ao cutover (ou sem cutover) e
 * pela reconciliação. Preserva o sinal do CA (o motor do DRE subtrai a magnitude).
 */
export async function despesaCaPorCategoria(
  companyId: string,
  competencia: string,
  regime: DreRegime = "competencia",
): Promise<{ mapa: Map<string, number>; carimbos: string[] }> {
  const de = firstDay(ymAddMonths(competencia, -2));
  const ate = lastDay(ymAddMonths(competencia, 3));
  const pagar = await fetchEventos(
    companyId,
    CONTA_AZUL_RESOURCES.contasAPagar.path!,
    de,
    ate,
  );
  const mapa = new Map<string, number>();
  const carimbos: string[] = [];
  for (const e of pagar) {
    const ym =
      regime === "previsto-realizado"
        ? (e.data_vencimento ?? "").slice(0, 7)
        : (e.data_competencia ?? e.data_vencimento ?? "").slice(0, 7);
    if (ym !== competencia) continue;
    const id = e.categorias?.[0]?.id;
    if (!id) continue;
    mapa.set(id, (mapa.get(id) ?? 0) + num(e.total));
    const c = e.data_alteracao ?? e.data_emissao ?? e.data_vencimento ?? "";
    if (c) carimbos.push(c);
  }
  return { mapa, carimbos };
}

/**
 * Despesa por categoria financeira na competência, lida das NOSSAS parcelas
 * (fin_parcelas → fin_despesas → fin_categorias.ca_categoria_id). Base do DRE v2
 * pós-cutover e da reconciliação. Usa `valor_previsto` (o comprometido do mês,
 * equivalente ao `total` do evento do CA). Ignora parcela/despesa cancelada.
 * Categoria própria (sem par no CA) não casa com nenhuma linha → vira semMapeamento.
 *
 * `buId` (DRE por BU): atribui a cada parcela SÓ a fatia daquela BU — pelo rateio
 * (`fin_despesa_rateio`) quando existe, senão 100% se a BU da parcela for a pedida.
 */
export async function despesaJarvisPorCategoria(
  companyId: string,
  competencia: string,
  buId?: string | null,
  regime: DreRegime = "competencia",
): Promise<{ mapa: Map<string, number>; carimbos: string[]; realizado: Map<string, number> }> {
  const admin = createAdminClient();
  // O RECORTE muda só a coluna de data usada pra decidir o mês da linha.
  const campoData =
    regime === "previsto-realizado" ? "data_vencimento" : "data_competencia";
  const { data, error } = await admin
    .from("fin_parcelas")
    .select(
      "id, valor_previsto, valor_realizado, status, bu_id, fin_despesas!inner ( cancelada, fin_categorias!inner ( ca_categoria_id ) )",
    )
    .eq("company_id", companyId)
    .gte(campoData, firstDay(competencia))
    .lte(campoData, lastDay(competencia))
    .neq("status", "cancelada")
    .eq("fin_despesas.cancelada", false);
  if (error) throw new Error(`despesaJarvisPorCategoria: ${error.message}`);
  const rows = data ?? [];
  const rateios = buId
    ? await listRateios(companyId, rows.map((r) => r.id as string))
    : null;
  // `mapa` = PREVISTO (comprometido do mês); `realizado` = só parcelas PAGAS.
  const mapa = new Map<string, number>();
  const realizado = new Map<string, number>();
  for (const r of rows) {
    const desp = r.fin_despesas as unknown as {
      fin_categorias?: { ca_categoria_id?: string | null } | null;
    };
    const caId = desp?.fin_categorias?.ca_categoria_id ?? null;
    if (!caId) continue;
    /** Fatia atribuível à BU pedida (ou o valor cheio sem filtro). */
    const fatiaDe = (val: number): number | null => {
      if (!buId) return val;
      const buPad = r.bu_id as string | null;
      if (!buPad) return null;
      const fatia = expandirPorBu(cents(val), buPad, rateios!.get(r.id as string)).find(
        (f) => f.bu_id === buId,
      );
      return fatia ? fatia.valorCents / 100 : null;
    };
    const prev = fatiaDe(num(r.valor_previsto));
    if (prev === null) continue; // esta parcela não toca a BU pedida
    mapa.set(caId, (mapa.get(caId) ?? 0) + prev);

    /**
     * REALIZADO = o que de fato saiu, e não "a parcela inteira se ela estiver
     * paga".
     *
     * Antes da 0038 isto era `status === 'paga' ? valor cheio : 0`. Com as
     * baixas parciais, uma conta com R$ 380 de R$ 10.000 consumidos aparecia
     * como ZERO — o dinheiro tinha saído e o DRE não via.
     *
     * `valor_realizado` é mantido por `recalcularParcela` como a soma das
     * baixas, então basta lê-lo em qualquer status. Uma parcela sem baixa tem
     * 0 e não contribui, que é o comportamento correto.
     *
     * ⚠️ O recorte de MÊS continua sendo o da parcela (competência ou
     * vencimento). Uma baixa lançada em setembro contra um envelope de agosto
     * conta em agosto. Fatiar o realizado pela data de cada baixa é o passo
     * seguinte — e muda o total do mês, então merece medição antes.
     */
    const real = fatiaDe(num(r.valor_realizado));
    if (real !== null && real !== 0)
      realizado.set(caId, (realizado.get(caId) ?? 0) + real);
  }
  return { mapa, carimbos: [], realizado };
}

/** Uma parcela que compõe a linha do DRE, já com a fatia da BU aplicada. */
export interface DreDetalheItem {
  parcelaId: string;
  despesaId: string;
  descricao: string;
  /** Valor que ESTA linha do DRE recebeu (já rateado, se houver rateio). */
  valor: number;
  /** Valor cheio da parcela — difere de `valor` quando há rateio/filtro de BU. */
  valorCheio: number;
  realizado: number | null;
  status: string;
  numero: number;
  numParcelas: number;
  dataCompetencia: string;
  dataVencimento: string;
  dataPagamento: string | null;
  buNome: string | null;
  /** true quando a parcela é dividida entre BUs (o valor acima é só a fatia). */
  rateada: boolean;
  centroNome: string | null;
  fonte: string;
  recorrente: boolean;
}

/**
 * As parcelas que COMPÕEM uma linha de despesa do DRE — o "de onde veio esse
 * número".
 *
 * Espelha `despesaJarvisPorCategoria` de propósito: mesma coluna de data por
 * regime, mesmos filtros de cancelamento e a MESMA fatia de rateio. Se as duas
 * divergirem, a soma do detalhe não bate com a linha, e um detalhamento que não
 * fecha é pior que nenhum. Qualquer mudança numa tem de ser feita na outra.
 */
export async function detalheDespesaPorCategoria(
  companyId: string,
  caCategoriaId: string,
  competencia: string,
  buId?: string | null,
  regime: DreRegime = "competencia",
  /**
   * Só as parcelas PAGAS. É o que o painel de Fechamento pede: lá a linha exibe
   * o Realizado, então a soma do detalhe tem de fechar com ela — listar o que
   * ainda não foi pago daria um total maior que a linha clicada.
   */
  somentePagas = false,
): Promise<{ itens: DreDetalheItem[]; total: number; totalRealizado: number }> {
  const admin = createAdminClient();
  const campoData =
    regime === "previsto-realizado" ? "data_vencimento" : "data_competencia";
  let consulta = admin
    .from("fin_parcelas")
    .select(
      `id, numero, valor_previsto, valor_realizado, status, bu_id,
       data_competencia, data_vencimento, data_pagamento,
       business_units ( nome ),
       fin_despesas!inner ( id, descricao, num_parcelas, cancelada, fonte, recorrencia_id,
         fin_centros_custo ( nome ),
         fin_categorias!inner ( ca_categoria_id ) )`,
    )
    .eq("company_id", companyId)
    .gte(campoData, firstDay(competencia))
    .lte(campoData, lastDay(competencia))
    .neq("status", "cancelada")
    .eq("fin_despesas.cancelada", false)
    .eq("fin_despesas.fin_categorias.ca_categoria_id", caCategoriaId);
  if (somentePagas) consulta = consulta.eq("status", "paga");
  const { data, error } = await consulta.order(campoData, { ascending: true });
  if (error) throw new Error(`detalheDespesaPorCategoria: ${error.message}`);

  const rows = data ?? [];
  const rateios = await listRateios(
    companyId,
    rows.map((r) => r.id as string),
  );

  const itens: DreDetalheItem[] = [];
  for (const r of rows) {
    const linhas = rateios.get(r.id as string) ?? [];
    /** Mesma fatia do agregado: sem BU pedida, valor cheio. */
    const fatiaDe = (val: number): number | null => {
      if (!buId) return val;
      const buPad = r.bu_id as string | null;
      if (!buPad) return null;
      const f = expandirPorBu(cents(val), buPad, linhas).find((x) => x.bu_id === buId);
      return f ? f.valorCents / 100 : null;
    };
    const cheio = num(r.valor_previsto);
    const valor = fatiaDe(cheio);
    if (valor === null) continue; // não toca a BU pedida

    const desp = r.fin_despesas as unknown as {
      id: string;
      descricao: string;
      num_parcelas: number;
      fonte: string;
      recorrencia_id: string | null;
      fin_centros_custo?: { nome?: string | null } | null;
    };
    const bu = r.business_units as unknown as { nome?: string | null } | null;
    /**
     * Mesma regra do agregado: realizado é a SOMA DAS BAIXAS
     * (`valor_realizado`), não "a parcela inteira se estiver paga". Sem isto o
     * popup "de onde veio esse número" mostraria zero numa linha parcial e não
     * fecharia com o total da linha clicada. Zero vira `null` = "nada saiu".
     */
    const realizadoFatia = fatiaDe(num(r.valor_realizado));
    itens.push({
      parcelaId: r.id as string,
      despesaId: desp.id,
      descricao: desp.descricao,
      valor,
      valorCheio: cheio,
      realizado: realizadoFatia && realizadoFatia !== 0 ? realizadoFatia : null,
      status: r.status as string,
      numero: (r.numero as number) ?? 1,
      numParcelas: desp.num_parcelas ?? 1,
      dataCompetencia: r.data_competencia as string,
      dataVencimento: r.data_vencimento as string,
      dataPagamento: (r.data_pagamento as string | null) ?? null,
      buNome: bu?.nome ?? null,
      rateada: linhas.length > 0,
      centroNome: desp.fin_centros_custo?.nome ?? null,
      fonte: desp.fonte,
      recorrente: !!desp.recorrencia_id,
    });
  }

  itens.sort((a, b) => b.valor - a.valor);
  return {
    itens,
    total: itens.reduce((s, i) => s + i.valor, 0),
    totalRealizado: itens.reduce((s, i) => s + (i.realizado ?? 0), 0),
  };
}

/**
 * Receita por categoria financeira do CA na competência, lida do NOSSO espelho
 * (`fin_receita_snapshot`, que já resolve a BU). Base da RECEITA no DRE por BU —
 * o CA ao vivo não carrega a BU. Mapeia via `fin_categorias.ca_categoria_id` (a
 * mesma chave das folhas do DRE). Competência = `data_competencia ?? data_vencimento`,
 * igual ao caminho do CA. `buId` filtra a unidade.
 */
export async function receitaSnapshotPorCategoria(
  companyId: string,
  competencia: string,
  buId?: string | null,
  regime: DreRegime = "competencia",
): Promise<{ prev: Map<string, number>; real: Map<string, number> }> {
  const admin = createAdminClient();
  // Mesma folga da despesa ([C-2, C+3]): recebível de competência C pode vencer
  // meses depois (parcelamento). Janela estreita perderia essa receita.
  const de = firstDay(ymAddMonths(competencia, -2));
  const ate = lastDay(ymAddMonths(competencia, 3));
  let q = admin
    .from("fin_receita_snapshot")
    .select(
      "valor, recebido, data_competencia, data_vencimento, fin_categorias!inner ( ca_categoria_id )",
    )
    .eq("company_id", companyId)
    .gte("data_vencimento", de)
    .lte("data_vencimento", ate);
  // null = Todas (sem filtro); "sem" = receita sem BU resolvida; uuid = a BU.
  if (buId === "sem") q = q.is("bu_id", null);
  else if (buId) q = q.eq("bu_id", buId);
  const { data, error } = await q;
  if (error) throw new Error(`receitaSnapshotPorCategoria: ${error.message}`);
  // `prev` = tudo que foi emitido na competência; `real` = só o já RECEBIDO.
  const prev = new Map<string, number>();
  const real = new Map<string, number>();
  for (const r of data ?? []) {
    // Recorte: por competência (mês a que se refere) ou por vencimento (o mês
    // em que a conta cai). A janela de busca acima é ampla; o mês exato é aqui.
    const ym =
      regime === "previsto-realizado"
        ? ((r.data_vencimento as string | null) ?? "").slice(0, 7)
        : (((r.data_competencia as string | null) ??
            (r.data_vencimento as string | null) ??
            "") as string).slice(0, 7);
    if (ym !== competencia) continue;
    const cat = r.fin_categorias as unknown as { ca_categoria_id?: string | null } | null;
    const caId = cat?.ca_categoria_id ?? null;
    if (!caId) continue;
    const v = num(r.valor);
    prev.set(caId, (prev.get(caId) ?? 0) + v);
    if (r.recebido) real.set(caId, (real.get(caId) ?? 0) + v);
  }
  return { prev, real };
}

/**
 * ORÇADO por categoria financeira do CA na competência (DRE Orçamentário).
 *
 * Cadeia: `fin_orcamentos.categoria_id` → `fin_categorias.ca_categoria_id`, que é
 * a MESMA chave que o DRE usa nas folhas. Metas de BUs diferentes para a mesma
 * categoria são SOMADAS (o DRE não é quebrado por BU).
 *
 * Sinal: `valor_orcado` é sempre positivo no cadastro; aqui aplicamos a convenção
 * do DRE (receita +, despesa −) via `fin_categorias.tipo`. Assim o orçado fica
 * comparável com o realizado linha a linha — e o desvio (realizado − orçado) tem
 * a MESMA leitura nos dois lados: **positivo = melhor que o planejado**.
 */
export async function orcadoPorCategoriaCa(
  companyId: string,
  competencia: string,
  buId?: string | null,
): Promise<Map<string, number>> {
  // "Sem BU" não tem meta atribuível → coluna Orçado vazia nessa visão.
  if (buId === "sem") return new Map<string, number>();
  const admin = createAdminClient();
  let q = admin
    .from("fin_orcamentos")
    .select("valor_orcado, fin_categorias!inner ( ca_categoria_id, tipo )")
    .eq("company_id", companyId)
    .eq("competencia", competencia);
  // DRE por BU: só as metas daquela BU (metas "todas as BUs" ficam de fora da visão por BU).
  if (buId) q = q.eq("bu_id", buId);
  const { data, error } = await q;
  if (error) throw new Error(`orcadoPorCategoriaCa: ${error.message}`);

  const mapa = new Map<string, number>();
  for (const r of data ?? []) {
    const cat = r.fin_categorias as unknown as {
      ca_categoria_id?: string | null;
      tipo?: string | null;
    } | null;
    const caId = cat?.ca_categoria_id ?? null;
    if (!caId) continue; // categoria própria (sem par no CA) não casa com o DRE
    const sinal = cat?.tipo === "despesa" ? -1 : 1;
    mapa.set(caId, (mapa.get(caId) ?? 0) + sinal * num(r.valor_orcado));
  }
  return mapa;
}

/**
 * Despesa do CA agrupada por COMPETÊNCIA (AAAA-MM), numa faixa de vencimento —
 * UMA leitura paginada só (barato) p/ conferir vários meses de uma vez. Soma
 * crua (o consumidor compara com o Jarvis). Usada pela reconciliação de período.
 */
export async function despesaCaPorMes(
  companyId: string,
  deVenc: string,
  ateVenc: string,
): Promise<Map<string, number>> {
  const pagar = await fetchEventos(
    companyId,
    CONTA_AZUL_RESOURCES.contasAPagar.path!,
    deVenc,
    ateVenc,
  );
  const mapa = new Map<string, number>();
  for (const e of pagar) {
    const ym = (e.data_competencia ?? e.data_vencimento ?? "").slice(0, 7);
    if (!ym) continue;
    mapa.set(ym, (mapa.get(ym) ?? 0) + num(e.total));
  }
  return mapa;
}

/**
 * Lista os lançamentos que caem no mês pelo VENCIMENTO mas se referem a OUTRA
 * competência — o "veio de outro mês" do recorte `previsto-realizado`.
 *
 * Só faz sentido no modo Jarvis (nossas parcelas): os eventos do CA não trazem
 * descrição no endpoint do DRE, e pré-cutover a lista seria incompleta.
 */
async function lancamentosForaDaCompetencia(
  companyId: string,
  competencia: string,
): Promise<NonNullable<DreResult["foraDaCompetencia"]>> {
  const admin = createAdminClient();
  const vazio = { total: 0, totalProprio: 0, totalImportado: 0, itens: [] };
  const { data, error } = await admin
    .from("fin_parcelas")
    .select(
      "valor_previsto, data_competencia, data_vencimento, fin_despesas!inner ( descricao, fonte, cancelada, fin_categorias!inner ( nome ) )",
    )
    .eq("company_id", companyId)
    .gte("data_vencimento", firstDay(competencia))
    .lte("data_vencimento", lastDay(competencia))
    .neq("status", "cancelada")
    .eq("fin_despesas.cancelada", false);
  if (error) return vazio;

  const itens = (data ?? [])
    .filter((r) => String(r.data_competencia).slice(0, 7) !== competencia)
    .map((r) => {
      const d = r.fin_despesas as unknown as {
        descricao: string;
        fonte?: string | null;
        fin_categorias?: { nome?: string } | null;
      };
      return {
        descricao: d.descricao,
        categoria: d.fin_categorias?.nome ?? "—",
        competencia: String(r.data_competencia),
        vencimento: String(r.data_vencimento),
        valor: num(r.valor_previsto),
        importado: d.fonte === "ca_import",
      };
    })
    // Importados primeiro (é o que pede conferência), depois por valor.
    .sort((a, b) => Number(b.importado) - Number(a.importado) || b.valor - a.valor);

  const soma = (f: (i: (typeof itens)[number]) => boolean) =>
    itens.filter(f).reduce((s, i) => s + i.valor, 0);
  return {
    total: soma(() => true),
    totalProprio: soma((i) => !i.importado),
    totalImportado: soma((i) => i.importado),
    itens,
  };
}

/**
 * Resolve a árvore do DRE com resiliência (Opção A). Injeta as 3 dependências
 * (buscar do CA, ler cache, gravar cache) para ser testável sem CA/DB:
 *   - CA responde → usa E regrava o cache (best-effort; falha ao gravar não
 *     derruba o DRE). Fonte 'ca'.
 *   - CA falha → usa a última árvore guardada. Fonte 'cache'.
 *   - CA falha e nunca sincronizou → propaga o erro (DRE fica indisponível, como
 *     era antes de existir cache).
 */
export async function resolveEstrutura(
  fetchCa: () => Promise<DreItemApi[]>,
  loadCache: () => Promise<{ json: unknown | null; syncAt: string | null }>,
  saveCache: (itens: DreItemApi[]) => Promise<void>,
  nowISO: string,
): Promise<{ itens: DreItemApi[]; fonte: "ca" | "cache"; syncAt: string | null }> {
  try {
    const itens = await fetchCa();
    try {
      await saveCache(itens);
    } catch {
      /* persistir é best-effort — nunca derruba o DRE */
    }
    return { itens, fonte: "ca", syncAt: nowISO };
  } catch (e) {
    const cached = await loadCache();
    if (cached.json)
      return { itens: cached.json as DreItemApi[], fonte: "cache", syncAt: cached.syncAt };
    throw e; // nunca sincronizou → sem árvore pra desenhar
  }
}

/**
 * `ca_categoria_id` → `bu_id` da nossa categoria. Só é lido quando o DRE está
 * filtrado por BU — é o que permite sumir com as LINHAS de outra unidade, e não
 * apenas zerá-las.
 */
async function buPorCategoriaCa(companyId: string): Promise<Map<string, string | null>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_categorias")
    .select("ca_categoria_id, bu_id")
    .eq("company_id", companyId)
    .not("ca_categoria_id", "is", null);
  if (error) throw new Error(`buPorCategoriaCa: ${error.message}`);
  return new Map(
    (data ?? []).map((r) => [r.ca_categoria_id as string, (r.bu_id as string | null) ?? null]),
  );
}

// ------------------------------- Cálculo -----------------------------------

async function computeDre(
  companyId: string,
  competencia: string,
  buId?: string | null,
  regime: DreRegime = "competencia",
): Promise<DreResult> {
  const bu = buId ?? null;
  const vazio: DreResult = {
    connected: false,
    competencia,
    receitaBruta: 0,
    receitaBrutaPrev: 0,
    temPrevReal: false,
    rows: [],
    semMapeamento: 0,
    atualizadoAte: null,
    temOrcamento: false,
    liquidacao: { despesa: null, receita: null },
    despesaFonte: "contaazul",
    cutover: null,
  };
  try {
    // A API de eventos só filtra por `data_vencimento`, mas o DRE é por
    // COMPETÊNCIA; filtramos a competência exata em memória (`acumular`).
    // Janela de vencimento -2…+3 meses: cobre parcelas de vencimento próximo sem
    // inchar o fetch. (Testado: alargar NÃO recupera lançamentos do dia — a
    // diferença vem do atraso de propagação da API, não da janela. Ver docs.)
    const de = firstDay(ymAddMonths(competencia, -2));
    const ate = lastDay(ymAddMonths(competencia, 3));

    // Estrutura + receita SEMPRE do CA ao vivo (a receita reconcilia 100%, ver
    // Passo 10). A DESPESA vem do CA (< cutover) ou das nossas parcelas (≥ cutover):
    // o cutover isola o risco na despesa — que estamos migrando — sem big-bang. Sem
    // cutover, ou tabela ainda não migrada, `getCutoverCompetencia` devolve null →
    // tudo do CA (fallback = comportamento de hoje).
    const cutover = await getCutoverCompetencia(companyId);
    const usaJarvis = cutover != null && competencia >= cutover;
    // MODO 100% JARVIS quando: pediram uma BU (ou "Sem BU"), OU a competência já
    // passou do cutover. Nesse modo, TANTO a despesa (parcelas + rateio) QUANTO a
    // receita (espelho `fin_receita_snapshot`, que resolve a BU) vêm das NOSSAS
    // tabelas → o Total (Todas) = Σ BUs + "Sem BU", e o custo por BU FECHA.
    // Só o consolidado ANTERIOR ao cutover segue no CA ao vivo (histórico).
    const jarvisMode = bu != null || usaJarvis;
    const [estrutura, receber, despesa, receitaJarvis, orcadoPorCat, catBu] =
      await Promise.all([
      // Estrutura resiliente (Opção A): CA vivo regrava o cache; CA fora usa a cópia.
      resolveEstrutura(
        async () =>
          (await caGet<DreStructResp>(companyId, CONTA_AZUL_RESOURCES.categoriasDre.path!))
            .itens,
        () => getDreEstruturaCache(companyId),
        (itens) => saveDreEstruturaCache(companyId, itens),
        new Date().toISOString(),
      ),
      jarvisMode
        ? Promise.resolve<EventoDre[]>([])
        : fetchEventos(companyId, CONTA_AZUL_RESOURCES.contasAReceber.path!, de, ate),
      jarvisMode
        ? despesaJarvisPorCategoria(companyId, competencia, bu, regime)
        : despesaCaPorCategoria(companyId, competencia, regime),
      jarvisMode
        ? receitaSnapshotPorCategoria(companyId, competencia, bu, regime)
        : Promise.resolve<{ prev: Map<string, number>; real: Map<string, number> } | null>(null),
      // Metas do mês. Falha aqui não derruba o DRE — só zera a coluna Orçado.
      orcadoPorCategoriaCa(companyId, competencia, bu).catch(() => new Map<string, number>()),
      // De-para categoria → BU, só quando há filtro (ver `daBu` abaixo).
      bu ? buPorCategoriaCa(companyId) : Promise.resolve(null),
    ]);
    const struct = { itens: estrutura.itens };
    const temOrcamento = orcadoPorCat.size > 0;
    // No recorte por vencimento, quais linhas vieram de outra competência.
    const foraDaComp =
      regime === "previsto-realizado" && jarvisMode
        ? await lancamentosForaDaCompetencia(companyId, competencia)
        : { total: 0, totalProprio: 0, totalImportado: 0, itens: [] };

    // PREVISTO × REALIZADO (com sinal) por categoria, só na competência pedida.
    // Jarvis: previsto = comprometido/emitido; realizado = PAGO (parcelas paga)
    // e RECEBIDO (snapshot recebido). Modo CA: valor único (prev = real), a UI
    // mantém o layout antigo.
    const prevPorCat = new Map<string, number>();
    const realPorCat = new Map<string, number>();
    const soma = (m: Map<string, number>, id: string, v: number) =>
      m.set(id, (m.get(id) ?? 0) + v);
    /**
     * Acumuladores da liquidação, em MAGNITUDE (sem o sinal do DRE) e separados
     * por lado — não dá para deduzir do `prevPorCat`, onde receita e despesa já
     * se cancelaram.
     */
    const liq = { despPrev: 0, despReal: 0, recPrev: 0, recReal: 0 };
    if (jarvisMode) {
      for (const [id, v] of receitaJarvis!.prev) {
        soma(prevPorCat, id, v);
        liq.recPrev += v;
      }
      for (const [id, v] of receitaJarvis!.real) {
        soma(realPorCat, id, v);
        liq.recReal += v;
      }
      for (const [id, mag] of despesa.mapa) {
        soma(prevPorCat, id, -mag);
        liq.despPrev += mag;
      }
      const despReal =
        (despesa as { realizado?: Map<string, number> }).realizado ??
        new Map<string, number>();
      for (const [id, mag] of despReal) {
        soma(realPorCat, id, -mag);
        liq.despReal += mag;
      }
    } else {
      for (const e of receber) {
        const ym =
          regime === "previsto-realizado"
            ? (e.data_vencimento ?? "").slice(0, 7)
            : (e.data_competencia ?? e.data_vencimento ?? "").slice(0, 7);
        if (ym !== competencia) continue;
        const id = e.categorias?.[0]?.id;
        if (!id) continue;
        soma(prevPorCat, id, num(e.total));
        soma(realPorCat, id, num(e.total));
      }
      for (const [id, mag] of despesa.mapa) {
        soma(prevPorCat, id, -mag);
        soma(realPorCat, id, -mag);
      }
    }

    // Carimbo de frescor: o lançamento mais recente que a API expôs neste fetch.
    // A API da CA é eventualmente consistente (ver docs/financas-modulo.md, seção
    // "Atraso da API"). Pós-cutover a despesa é nossa e não carrega carimbo do CA.
    const carimbos = [
      ...receber.map((e) => e.data_alteracao ?? e.data_emissao ?? e.data_vencimento ?? ""),
      ...despesa.carimbos,
    ].filter((d) => d);
    const atualizadoAte = carimbos.length
      ? carimbos.reduce((a, b) => (a > b ? a : b))
      : null;

    const usados = new Set<string>();
    /**
     * A categoria deve APARECER na visão de BU atual?
     *
     * Filtrar o valor não basta: as categorias de receita são exclusivas de uma
     * unidade ("1.8 - MENSALIDADE COLÉGIO"), então no DRE do CPPEM elas ficavam
     * listadas zeradas, poluindo o Faturamento com linhas de outra empresa.
     *
     * Regra, por ordem:
     * - sem filtro de BU ("Todas") → mostra tudo;
     * - categoria SEM `bu_id` → mostra sempre. É o caso das 96 categorias de
     *   despesa: elas não são de nenhuma unidade, e o valor delas já vem
     *   filtrado pela BU da PARCELA (com rateio). Escondê-las esvaziaria o DRE;
     * - categoria COM `bu_id` → só na visão daquela BU. Na visão "sem BU" some,
     *   porque ali por definição não há unidade atribuída.
     */
    const daBu = (c: DreCategoriaFin): boolean => {
      if (!catBu) return true;
      const b = catBu.get(c.id);
      if (b == null) return true;
      return bu === "sem" ? false : b === bu;
    };

    const folha = (c: DreCategoriaFin): DreChild => {
      usados.add(c.id);
      return {
        label: c.nome,
        valor: realPorCat.get(c.id) ?? 0,
        // av/avPrev/avOrc nascem 0: o AV depende da Receita Bruta, que só é
        // conhecida depois de somar tudo. Preenchidos no passe 2.
        av: 0,
        avOrc: 0,
        previsto: prevPorCat.get(c.id) ?? 0,
        avPrev: 0,
        orcado: orcadoPorCat.get(c.id) ?? 0,
        // `has`, não `get`: o Map só recebe categorias que TÊM linha em
        // fin_orcamentos, então a presença é a resposta — inclusive quando o
        // valor cadastrado é 0.
        temMeta: orcadoPorCat.has(c.id),
        caId: c.id,
      };
    };

    // Passe 1: valor de cada grupo (com filhos), preservando a ordem da API.
    type Calc =
      | { tot: DreItemApi }
      | {
          item: DreItemApi;
          valor: number;
          previsto: number;
          orcado: number;
          children: DreChild[];
        };
    const calc: Calc[] = struct.itens.map((item) => {
      if (item.indica_totalizador) return { tot: item };
      const children: DreChild[] = [];
      let valor = 0;
      let previsto = 0;
      let orcado = 0;
      for (const c of item.categorias_financeiras.filter(daBu)) {
        const ch = folha(c);
        valor += ch.valor;
        previsto += ch.previsto;
        orcado += ch.orcado;
        children.push(ch);
      }
      for (const sub of item.subitens) {
        let subVal = 0;
        let subPrev = 0;
        let subOrc = 0;
        const subLeaves: DreChild[] = [];
        for (const c of sub.categorias_financeiras.filter(daBu)) {
          const ch = folha(c);
          subVal += ch.valor;
          subPrev += ch.previsto;
          subOrc += ch.orcado;
          subLeaves.push(ch);
        }
        valor += subVal;
        previsto += subPrev;
        orcado += subOrc;
        children.push({
          label: `${sub.codigo ?? ""} ${sub.descricao}`.trim(),
          valor: subVal,
          av: 0,
          avOrc: 0,
          previsto: subPrev,
          avPrev: 0,
          orcado: subOrc,
          temMeta: subLeaves.some((l) => l.temMeta),
          sub: true,
        });
        children.push(...subLeaves);
      }
      return { item, valor, previsto, orcado, children };
    });

    const g01 = calc.find(
      (c): c is Extract<Calc, { item: DreItemApi }> =>
        "item" in c && c.item.codigo === "01",
    );
    const receitaBruta = g01?.valor ?? 0;
    const receitaBrutaPrev = g01?.previsto ?? 0;
    // Base do AV da meta: a receita bruta PLANEJADA. Ver a nota em `avOrc`.
    const receitaBrutaOrc = g01?.orcado ?? 0;

    // Passe 2: linhas com AV (realizado sobre RB realizada; previsto sobre RB
    // prevista) e totalizadores (soma corrente dos dois lados).
    const rows: DreRow[] = [];
    let acc = 0;
    let accPrev = 0;
    let accOrc = 0;
    let accTemMeta = false;
    for (const c of calc) {
      if ("tot" in c) {
        rows.push({
          kind: "subtotal",
          label: c.tot.descricao,
          valor: acc,
          av: av(acc, receitaBruta),
          previsto: accPrev,
          avPrev: av(accPrev, receitaBrutaPrev),
          orcado: accOrc,
          avOrc: av(accOrc, receitaBrutaOrc),
          temMeta: accTemMeta,
        });
      } else {
        acc += c.valor;
        accPrev += c.previsto;
        accOrc += c.orcado;
        const grupoTemMeta = c.children.some((ch) => ch.temMeta);
        accTemMeta = accTemMeta || grupoTemMeta;
        rows.push({
          kind: "group",
          codigo: c.item.codigo ?? "",
          label: c.item.descricao,
          valor: c.valor,
          av: av(c.valor, receitaBruta),
          previsto: c.previsto,
          avPrev: av(c.previsto, receitaBrutaPrev),
          orcado: c.orcado,
          avOrc: av(c.orcado, receitaBrutaOrc),
          temMeta: grupoTemMeta,
          children: c.children.map((ch) => ({
            ...ch,
            av: av(ch.valor, receitaBruta),
            avPrev: av(ch.previsto, receitaBrutaPrev),
            avOrc: av(ch.orcado, receitaBrutaOrc),
          })),
        });
      }
    }

    let semMapeamento = 0;
    for (const [id, v] of prevPorCat) if (!usados.has(id)) semMapeamento += v;

    return {
      connected: true,
      competencia,
      receitaBruta,
      receitaBrutaPrev,
      temPrevReal: jarvisMode,
      // Pré-cutover o CA devolve valor único (previsto = realizado): não existe
      // liquidação a medir, então `null` em vez de um 100% enganoso.
      liquidacao: jarvisMode
        ? {
            despesa: liq.despPrev > 0 ? liq.despReal / liq.despPrev : null,
            receita: liq.recPrev > 0 ? liq.recReal / liq.recPrev : null,
          }
        : { despesa: null, receita: null },
      rows,
      semMapeamento,
      atualizadoAte,
      temOrcamento,
      despesaFonte: jarvisMode ? "jarvis" : "contaazul",
      cutover,
      estruturaFonte: estrutura.fonte,
      estruturaSyncAt: estrutura.syncAt,
      regime,
      foraDaCompetencia:
        regime === "previsto-realizado" && jarvisMode ? foraDaComp : undefined,
      aviso:
        [
          Math.abs(semMapeamento) > 0.005
            ? "Há lançamentos sem categoria mapeada no DRE (não somados às linhas)."
            : "",
          jarvisMode
            ? "Fonte 100% Jarvis: receita do espelho + despesa das parcelas (rateio). Total = Σ BUs + Sem BU."
            : "",
          // Guarda contra a leitura errada mais provável pós-cutover: DRE com
          // despesa e receita ZERO parece "prejuízo total", mas quase sempre é
          // só espelho sem recebível daquela competência (o CA ainda não emitiu,
          // ou ninguém sincronizou — não há sync automático).
          jarvisMode && receitaBrutaPrev === 0 && Math.abs(accPrev) > 0.005
            ? "⚠ Receita ZERADA nesta competência: o espelho não tem recebíveis dela. Se o Conta Azul já emitiu, vá em Receita → “Sincronizar do Conta Azul”. O resultado abaixo NÃO é prejuízo real enquanto a receita não entrar."
            : "",
        ]
          .filter(Boolean)
          .join(" ") || undefined,
    };
  } catch {
    return vazio;
  }
}

// -------------------------------- Cache ------------------------------------

const TTL_MS = (Number(process.env.CONTA_AZUL_CACHE_TTL_SECONDS) || 600) * 1000;
const cache = new Map<string, { at: number; data: DreResult }>();

/** DRE cacheado por empresa+competência+BU+regime (TTL simples). Só cacheia conectado. */
export async function getDre(
  companyId: string,
  competencia: string,
  buId?: string | null,
  regime: DreRegime = "competencia",
): Promise<DreResult> {
  const key = `${companyId}:${competencia}:${buId ?? ""}:${regime}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const data = await computeDre(companyId, competencia, buId ?? null, regime);
  if (data.connected) cache.set(key, { at: Date.now(), data });
  return data;
}

/**
 * Limpa o cache do DRE. Chamar após mudar o cutover ou importar despesa, pra que
 * a virada apareça na hora (sem esperar o TTL). Sem `companyId` limpa tudo.
 */
export function invalidateDre(companyId?: string): void {
  if (!companyId) return cache.clear();
  for (const key of [...cache.keys()])
    if (key.startsWith(`${companyId}:`)) cache.delete(key);
}
