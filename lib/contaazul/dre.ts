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
      children: DreChild[];
    }
  | { kind: "subtotal"; label: string; valor: number; av: number };
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
  };
  try {
    // A API de eventos só filtra por `data_vencimento`, mas o DRE é por
    // COMPETÊNCIA; filtramos a competência exata em memória (`acumular`).
    // Janela de vencimento -2…+3 meses: cobre parcelas de vencimento próximo sem
    // inchar o fetch. (Testado: alargar NÃO recupera lançamentos do dia — a
    // diferença vem do atraso de propagação da API, não da janela. Ver docs.)
    const de = firstDay(ymAddMonths(competencia, -2));
    const ate = lastDay(ymAddMonths(competencia, 3));
    const [struct, receber, pagar] = await Promise.all([
      caGet<DreStructResp>(companyId, CONTA_AZUL_RESOURCES.categoriasDre.path!),
      fetchEventos(companyId, CONTA_AZUL_RESOURCES.contasAReceber.path!, de, ate),
      fetchEventos(companyId, CONTA_AZUL_RESOURCES.contasAPagar.path!, de, ate),
    ]);

    // Valor (com sinal) por categoria financeira, só na competência pedida.
    const valorPorCat = new Map<string, number>();
    const acumular = (evs: EventoDre[], sinal: number) => {
      for (const e of evs) {
        // Recebíveis recentes chegam da API sem `data_competencia`; o relatório
        // do CA (e nosso dashboard) caem para `data_vencimento` nesse caso.
        const ym = (e.data_competencia ?? e.data_vencimento ?? "").slice(0, 7);
        if (ym !== competencia) continue;
        const id = e.categorias?.[0]?.id;
        if (!id) continue;
        valorPorCat.set(id, (valorPorCat.get(id) ?? 0) + num(e.total) * sinal);
      }
    };
    acumular(receber, +1);
    acumular(pagar, -1);

    // Carimbo de frescor: o lançamento mais recente que a API expôs neste fetch.
    // A API da CA é eventualmente consistente (ver docs/financas-modulo.md, seção
    // "Atraso da API"), por isso expomos isto na tela em vez de fingir tempo-real.
    const carimbos = [...receber, ...pagar]
      .map((e) => e.data_alteracao ?? e.data_emissao ?? e.data_vencimento ?? "")
      .filter((d) => d);
    const atualizadoAte = carimbos.length
      ? carimbos.reduce((a, b) => (a > b ? a : b))
      : null;

    const usados = new Set<string>();
    const folha = (c: DreCategoriaFin): DreChild => {
      usados.add(c.id);
      return { label: c.nome, valor: valorPorCat.get(c.id) ?? 0, av: 0 };
    };

    // Passe 1: valor de cada grupo (com filhos), preservando a ordem da API.
    type Calc =
      | { tot: DreItemApi }
      | { item: DreItemApi; valor: number; children: DreChild[] };
    const calc: Calc[] = struct.itens.map((item) => {
      if (item.indica_totalizador) return { tot: item };
      const children: DreChild[] = [];
      let valor = 0;
      for (const c of item.categorias_financeiras) {
        const ch = folha(c);
        valor += ch.valor;
        children.push(ch);
      }
      for (const sub of item.subitens) {
        let subVal = 0;
        const subLeaves: DreChild[] = [];
        for (const c of sub.categorias_financeiras) {
          const ch = folha(c);
          subVal += ch.valor;
          subLeaves.push(ch);
        }
        valor += subVal;
        children.push({
          label: `${sub.codigo ?? ""} ${sub.descricao}`.trim(),
          valor: subVal,
          av: 0,
          sub: true,
        });
        children.push(...subLeaves);
      }
      return { item, valor, children };
    });

    const g01 = calc.find(
      (c): c is Extract<Calc, { item: DreItemApi }> =>
        "item" in c && c.item.codigo === "01",
    );
    const receitaBruta = g01?.valor ?? 0;

    // Passe 2: linhas com AV e totalizadores (soma corrente).
    const rows: DreRow[] = [];
    let acc = 0;
    for (const c of calc) {
      if ("tot" in c) {
        rows.push({
          kind: "subtotal",
          label: c.tot.descricao,
          valor: acc,
          av: av(acc, receitaBruta),
        });
      } else {
        acc += c.valor;
        rows.push({
          kind: "group",
          codigo: c.item.codigo ?? "",
          label: c.item.descricao,
          valor: c.valor,
          av: av(c.valor, receitaBruta),
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
