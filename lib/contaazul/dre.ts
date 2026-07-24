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
import { getCutoverCompetencia } from "@/lib/financeiro/dre-config";
import { createAdminClient } from "@/lib/supabase/admin";

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

// --------------------------- Tipos do resultado ----------------------------

export type DreChild = {
  label: string;
  valor: number;
  av: number;
  /**
   * Meta do mês (`fin_orcamentos`), já COM SINAL do DRE (receita +, despesa −).
   * 0 quando não há orçamento lançado para a categoria.
   */
  orcado: number;
  /** Cabeçalho de subgrupo (03.1/03.2) — renderiza um pouco mais forte. */
  sub?: boolean;
};
export type DreRow =
  | {
      kind: "group";
      codigo: string;
      label: string;
      valor: number;
      av: number;
      orcado: number;
      children: DreChild[];
    }
  | { kind: "subtotal"; label: string; valor: number; av: number; orcado: number };
export interface DreResult {
  connected: boolean;
  competencia: string;
  receitaBruta: number;
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
  /** Fonte da DESPESA nesta competência: 'jarvis' (≥ cutover) ou 'contaazul'. */
  despesaFonte: "contaazul" | "jarvis";
  /** Competência de cutover configurada (AAAA-MM), ou null se tudo vem do CA. */
  cutover: string | null;
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
    const ym = (e.data_competencia ?? e.data_vencimento ?? "").slice(0, 7);
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
 */
export async function despesaJarvisPorCategoria(
  companyId: string,
  competencia: string,
): Promise<{ mapa: Map<string, number>; carimbos: string[] }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_parcelas")
    .select(
      "valor_previsto, fin_despesas!inner ( cancelada, fin_categorias!inner ( ca_categoria_id ) )",
    )
    .eq("company_id", companyId)
    .gte("data_competencia", firstDay(competencia))
    .lte("data_competencia", lastDay(competencia))
    .neq("status", "cancelada")
    .eq("fin_despesas.cancelada", false);
  if (error) throw new Error(`despesaJarvisPorCategoria: ${error.message}`);
  const mapa = new Map<string, number>();
  for (const r of data ?? []) {
    const desp = r.fin_despesas as unknown as {
      fin_categorias?: { ca_categoria_id?: string | null } | null;
    };
    const caId = desp?.fin_categorias?.ca_categoria_id ?? null;
    if (!caId) continue;
    mapa.set(caId, (mapa.get(caId) ?? 0) + num(r.valor_previsto));
  }
  return { mapa, carimbos: [] };
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
): Promise<Map<string, number>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_orcamentos")
    .select("valor_orcado, fin_categorias!inner ( ca_categoria_id, tipo )")
    .eq("company_id", companyId)
    .eq("competencia", competencia);
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

// ------------------------------- Cálculo -----------------------------------

async function computeDre(
  companyId: string,
  competencia: string,
): Promise<DreResult> {
  const vazio: DreResult = {
    connected: false,
    competencia,
    receitaBruta: 0,
    rows: [],
    semMapeamento: 0,
    atualizadoAte: null,
    temOrcamento: false,
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
    const [struct, receber, despesa, orcadoPorCat] = await Promise.all([
      caGet<DreStructResp>(companyId, CONTA_AZUL_RESOURCES.categoriasDre.path!),
      fetchEventos(companyId, CONTA_AZUL_RESOURCES.contasAReceber.path!, de, ate),
      usaJarvis
        ? despesaJarvisPorCategoria(companyId, competencia)
        : despesaCaPorCategoria(companyId, competencia),
      // Metas do mês. Falha aqui não derruba o DRE — só zera a coluna Orçado.
      orcadoPorCategoriaCa(companyId, competencia).catch(() => new Map<string, number>()),
    ]);
    const temOrcamento = orcadoPorCat.size > 0;

    // Valor (com sinal) por categoria financeira, só na competência pedida.
    // Receita: +total (recebíveis recentes vêm sem `data_competencia` → caímos p/
    // `data_vencimento`, igual ao relatório do CA). Despesa: −magnitude da fonte.
    const valorPorCat = new Map<string, number>();
    for (const e of receber) {
      const ym = (e.data_competencia ?? e.data_vencimento ?? "").slice(0, 7);
      if (ym !== competencia) continue;
      const id = e.categorias?.[0]?.id;
      if (!id) continue;
      valorPorCat.set(id, (valorPorCat.get(id) ?? 0) + num(e.total));
    }
    for (const [id, mag] of despesa.mapa) {
      valorPorCat.set(id, (valorPorCat.get(id) ?? 0) - mag);
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
    const folha = (c: DreCategoriaFin): DreChild => {
      usados.add(c.id);
      return {
        label: c.nome,
        valor: valorPorCat.get(c.id) ?? 0,
        av: 0,
        orcado: orcadoPorCat.get(c.id) ?? 0,
      };
    };

    // Passe 1: valor de cada grupo (com filhos), preservando a ordem da API.
    type Calc =
      | { tot: DreItemApi }
      | { item: DreItemApi; valor: number; orcado: number; children: DreChild[] };
    const calc: Calc[] = struct.itens.map((item) => {
      if (item.indica_totalizador) return { tot: item };
      const children: DreChild[] = [];
      let valor = 0;
      let orcado = 0;
      for (const c of item.categorias_financeiras) {
        const ch = folha(c);
        valor += ch.valor;
        orcado += ch.orcado;
        children.push(ch);
      }
      for (const sub of item.subitens) {
        let subVal = 0;
        let subOrc = 0;
        const subLeaves: DreChild[] = [];
        for (const c of sub.categorias_financeiras) {
          const ch = folha(c);
          subVal += ch.valor;
          subOrc += ch.orcado;
          subLeaves.push(ch);
        }
        valor += subVal;
        orcado += subOrc;
        children.push({
          label: `${sub.codigo ?? ""} ${sub.descricao}`.trim(),
          valor: subVal,
          av: 0,
          orcado: subOrc,
          sub: true,
        });
        children.push(...subLeaves);
      }
      return { item, valor, orcado, children };
    });

    const g01 = calc.find(
      (c): c is Extract<Calc, { item: DreItemApi }> =>
        "item" in c && c.item.codigo === "01",
    );
    const receitaBruta = g01?.valor ?? 0;

    // Passe 2: linhas com AV e totalizadores (soma corrente).
    const rows: DreRow[] = [];
    let acc = 0;
    let accOrc = 0;
    for (const c of calc) {
      if ("tot" in c) {
        rows.push({
          kind: "subtotal",
          label: c.tot.descricao,
          valor: acc,
          av: av(acc, receitaBruta),
          orcado: accOrc,
        });
      } else {
        acc += c.valor;
        accOrc += c.orcado;
        rows.push({
          kind: "group",
          codigo: c.item.codigo ?? "",
          label: c.item.descricao,
          valor: c.valor,
          av: av(c.valor, receitaBruta),
          orcado: c.orcado,
          children: c.children.map((ch) => ({
            ...ch,
            av: av(ch.valor, receitaBruta),
          })),
        });
      }
    }

    let semMapeamento = 0;
    for (const [id, v] of valorPorCat) if (!usados.has(id)) semMapeamento += v;

    return {
      connected: true,
      competencia,
      receitaBruta,
      rows,
      semMapeamento,
      atualizadoAte,
      temOrcamento,
      despesaFonte: usaJarvis ? "jarvis" : "contaazul",
      cutover,
      aviso:
        Math.abs(semMapeamento) > 0.005
          ? "Há lançamentos sem categoria mapeada no DRE (não somados às linhas)."
          : undefined,
    };
  } catch {
    return vazio;
  }
}

// -------------------------------- Cache ------------------------------------

const TTL_MS = (Number(process.env.CONTA_AZUL_CACHE_TTL_SECONDS) || 600) * 1000;
const cache = new Map<string, { at: number; data: DreResult }>();

/** DRE cacheado por empresa+competência (TTL simples). Só cacheia conectado. */
export async function getDre(
  companyId: string,
  competencia: string,
): Promise<DreResult> {
  const key = `${companyId}:${competencia}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const data = await computeDre(companyId, competencia);
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
