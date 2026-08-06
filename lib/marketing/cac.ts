/**
 * CAC — Custo de Aquisição por Cliente. Ver `docs/cac-fontes.md`.
 *
 *   CAC = (custo de Marketing + custo de Comercial) ÷ nº de vendas do período
 *
 * ## A fonte do custo MUDA no meio do caminho (2026-08-05)
 *
 * Até **julho/2026** as despesas viviam no Conta Azul. De **agosto** em diante
 * elas foram importadas para o banco próprio e canceladas no CA, então cada mês
 * tem exatamente uma fonte válida — somar as duas contaria o mesmo dinheiro
 * duas vezes, e ler só o CA perdia quase tudo.
 *
 * O sintoma que revelou isso: o CAC mostrava **R$ 3.707,76** de custo em agosto
 * quando o real era **R$ 65.363,45**. Um CAC calculado sobre 6% do custo, que
 * ainda por cima *melhorava* a cada mês, porque o denominador (vendas) continuava
 * cheio enquanto o numerador esvaziava.
 *
 * ## Três regimes, como no DRE
 *
 *  - **Meta** — o alvo cadastrado na aba Metas do Marketing.
 *  - **Previsto** — o que o financeiro planejou (`valor_previsto` / `total` no CA).
 *  - **Realizado** — o que foi efetivamente pago (exige `data_pagamento`).
 *
 * Os três são calculados SEMPRE; o regime só escolhe qual vira o número de
 * destaque. Assim a comparação fica à mão sem recarregar a página.
 *
 * ## BU
 *
 * No banco próprio a BU vem de `fin_parcelas.bu_id` — chave estrangeira, exata.
 * Na parte histórica do CA não existe esse campo, e a unidade é adivinhada pelo
 * NOME do centro ("Unicive marketing" → Unicive); centro sem unidade no nome
 * conta como compartilhado e é rateado pelo driver.
 *
 * ⚠️ Ainda NÃO há nº de vendas por BU (o CA não informa a BU da venda), então o
 * CAC por BU não sai em R$ — a ponte é `pctSobreReceita`.
 *
 * Server-only, por empresa. Gate no chamador: `marketing` E `financeiro`.
 */
import "server-only";

import { cachedSwr } from "@/lib/cache/kv";
import { resumoCentrosCusto } from "@/lib/financeiro/centros-custo";
import { resumoVendas } from "@/lib/financeiro/vendas";
import { getMetaMetrics } from "@/lib/marketing/metrics";
import { createAdminClient } from "@/lib/supabase/admin";

import { custoBancoProprio } from "./cac-banco-proprio";

/**
 * Primeira competência lida no BANCO PRÓPRIO. Antes disso, Conta Azul.
 *
 * É a virada combinada com o financeiro: as recorrências importadas foram
 * canceladas no CA a partir de agosto/2026. Mover esta constante sem conferir o
 * que existe em cada lado gera buraco (mês sem fonte) ou dupla contagem.
 */
export const CORTE_BANCO_PROPRIO = "2026-08";

/** Como distribuir o custo COMPARTILHADO entre as BUs. */
export type CacDriver = "receita" | "midia";

/** Qual base de custo vira o número de destaque. Espelha o DRE. */
export type CacRegime = "meta" | "previsto" | "realizado";

/** Janela de análise, em competências 'AAAA-MM' (inclusiva nas duas pontas). */
export interface CacPeriodo {
  de: string;
  ate: string;
}

/** Tipo de custo que entra no CAC. */
export type CacTipo = "marketing" | "comercial";

/** Marca do Meta Ads → BU. "Everton" é marca pessoal, sem BU própria. */
const MARCA_PARA_BU: Record<string, string> = {
  "CPPEM Concursos": "CPPEM",
  Colégio: "Colégio",
  Unicive: "Unicive",
  Everton: "Geral",
};

/**
 * Extrai BU e tipo do NOME do centro de custo (ex.: "Unicive marketing").
 * `bu: null` = custo compartilhado (nome sem unidade). `tipo: null` = centro que
 * não entra no CAC (Pedagógico, Tecnologia, ...).
 */
export function classificarCentro(nome: string): { bu: string | null; tipo: CacTipo | null } {
  // Sem normalizacao NFD: os padroes ja aceitam a forma acentuada.
  const n = (nome ?? "").toLowerCase();

  const tipo: CacTipo | null = /marketing|mkt/.test(n)
    ? "marketing"
    : /comercial|vendas/.test(n)
      ? "comercial"
      : null;

  // "unicv" é como aparece em centros antigos do CA (UNICV CARUARU).
  const bu = /unicive|unicv/.test(n)
    ? "Unicive"
    : /col[eé]gio/.test(n)
      ? "Colégio"
      : /cppem|concursos/.test(n)
        ? "CPPEM"
        : null;

  return { bu, tipo };
}

/** De onde veio o custo daquele mês/centro. */
export type CacFonte = "conta-azul" | "banco-proprio";

export interface CacCentro {
  centro: string;
  bu: string | null;
  tipo: CacTipo;
  /** Valor no regime selecionado. */
  valor: number;
  previsto: number;
  realizado: number;
  fonte: CacFonte;
}

export interface CacBu {
  bu: string;
  receita: number;
  /** Participação no driver do rateio (0-1). */
  share: number;
  /** Custo cujo centro já identifica a BU no nome. */
  custoDireto: number;
  /** Parte do custo compartilhado que coube à BU. */
  custoRateado: number;
  custoTotal: number;
  /** Investimento de mídia da marca correspondente (informativo). */
  midia: number;
  /** Ponte enquanto não há vendas por BU: custo ÷ receita (%). */
  pctSobreReceita: number | null;
}

export interface CacMes {
  mes: string; // 'AAAA-MM'
  /** Custo no regime selecionado. */
  custo: number;
  custoPrevisto: number;
  custoRealizado: number;
  vendas: number;
  cac: number | null;
  /** Qual base alimentou o mês — útil para explicar degraus na série. */
  fonte: CacFonte;
}

export interface CacResumo {
  connected: boolean;
  ano: number;
  periodo: CacPeriodo;
  regime: CacRegime;
  driver: CacDriver;
  /** Quanto do custo veio de cada base — deixa o corte visível na tela. */
  fontes: { contaAzul: number; bancoProprio: number };
  // ---- Custo no REGIME selecionado ----
  custoMarketing: number;
  custoComercial: number;
  custoTotal: number;
  /** As duas bases, sempre calculadas, para comparação sem recarregar. */
  custoPrevisto: number;
  custoRealizado: number;
  cacPrevisto: number | null;
  cacRealizado: number | null;
  /** Alvo cadastrado na aba Metas. `null` = ninguém cadastrou. */
  cacMeta: number | null;
  /** Centros que entraram na conta (com BU quando o nome identifica). */
  centros: CacCentro[];
  centrosEncontrados: boolean;
  /** Quanto do custo já tem BU no nome vs. quanto é compartilhado. */
  custoDiretoTotal: number;
  custoCompartilhado: number;
  // ---- Mídia (composição; NÃO soma ao custo) ----
  midiaPorMarca: { marca: string; bu: string; valor: number }[];
  midiaTotal: number;
  // ---- Vendas (fonte: Conta Azul) ----
  vendas: number;
  vendasFaturadas: number;
  vendasAFaturar: number;
  // ---- Resultado ----
  cac: number | null;
  serie: CacMes[];
  // ---- Por BU ----
  receitaTotal: number;
  porBu: CacBu[];
  temCustoDireto: boolean;
  atualizadoEm: string;
  erro?: string;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Meses 'AAAA-MM' do período, inclusivo. */
function mesesDoPeriodo(p: CacPeriodo): string[] {
  const [a1, m1] = p.de.split("-").map(Number);
  const [a2, m2] = p.ate.split("-").map(Number);
  const out: string[] = [];
  for (let a = a1, m = m1; a < a2 || (a === a2 && m <= m2); m === 12 ? (a++, (m = 1)) : m++) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Custo normalizado: uma linha por (mês, centro), venha do CA ou do banco
 * próprio, já com as DUAS bases (previsto e realizado).
 *
 * Reduzir as duas fontes a um formato só é o que mantém o resto do arquivo
 * simples — agregações por mês, por tipo e por BU passam a ignorar de onde o
 * número veio, e o corte fica isolado num único ponto.
 */
interface CustoNormalizado {
  mes: string;
  centro: string;
  /** `null` = compartilhado (só ocorre no histórico do CA). */
  bu: string | null;
  tipo: CacTipo;
  previsto: number;
  realizado: number;
  fonte: CacFonte;
}

/**
 * Junta as duas fontes aplicando o corte: CA nos meses ANTERIORES a
 * `CORTE_BANCO_PROPRIO`, banco próprio de lá em diante. Nenhum mês recebe as
 * duas — é o que impede a dupla contagem.
 */
async function custoNormalizado(
  companyId: string,
  periodo: CacPeriodo,
): Promise<CustoNormalizado[]> {
  const meses = mesesDoPeriodo(periodo);
  const mesesCa = meses.filter((m) => m < CORTE_BANCO_PROPRIO);
  const mesesProprio = meses.filter((m) => m >= CORTE_BANCO_PROPRIO);

  const out: CustoNormalizado[] = [];

  // ---- Conta Azul (histórico) ----
  if (mesesCa.length) {
    const anos = [...new Set(mesesCa.map((m) => Number(m.slice(0, 4))))];
    const resumos = await Promise.all(
      anos.map((ano) => resumoCentrosCusto(companyId, { ano }).catch(() => null)),
    );
    const dentro = new Set(mesesCa);
    for (const r of resumos) {
      for (const l of r?.porMes ?? []) {
        if (!dentro.has(l.mes)) continue;
        const { bu, tipo } = classificarCentro(l.centro);
        if (!tipo) continue; // Pedagógico, Tecnologia... não entram no CAC
        out.push({
          mes: l.mes,
          centro: l.centro,
          bu,
          tipo,
          previsto: num(l.previsto),
          realizado: num(l.realizado),
          fonte: "conta-azul",
        });
      }
    }
  }

  // ---- Banco próprio (agosto/2026 em diante) ----
  if (mesesProprio.length) {
    const linhas = await custoBancoProprio(
      companyId,
      mesesProprio[0],
      mesesProprio[mesesProprio.length - 1],
    ).catch(() => []);
    for (const l of linhas) {
      out.push({
        mes: l.mes,
        centro: l.centro,
        // Aqui a BU é `bu_id`, não palpite sobre o nome do centro.
        bu: l.bu === "Sem BU" ? null : l.bu,
        tipo: l.tipo,
        previsto: l.previsto,
        realizado: l.realizado,
        fonte: "banco-proprio",
      });
    }
  }

  return out;
}

/**
 * Meta de CAC cadastrada, para o período.
 *
 * CAC é uma TAXA (R$ por venda), não um valor acumulável: somar as metas de
 * agosto e setembro daria um número sem significado. Para um período com várias
 * competências, a meta é a MÉDIA das cadastradas — e meses sem meta ficam de
 * fora da média, em vez de entrarem como zero e puxarem o alvo para baixo.
 */
async function metaDeCac(periodo: CacPeriodo): Promise<number | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mkt_metas")
    .select("valor")
    .eq("metrica", "cac")
    .eq("ativo", true)
    .gte("competencia", periodo.de)
    .lte("competencia", periodo.ate);
  if (error || !data?.length) return null;
  const vals = data.map((r) => num(r.valor)).filter((v) => v > 0);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

/** Receita do ano por BU (nossas tabelas — bem mapeadas por categoria→BU). */
async function receitaPorBu(companyId: string, ano: number): Promise<Map<string, number>> {
  const admin = createAdminClient();
  const { data: bus } = await admin
    .from("business_units")
    .select("id, nome")
    .eq("company_id", companyId);
  const nomeById = new Map((bus ?? []).map((b) => [b.id as string, b.nome as string]));

  const PAGE = 1000;
  const agg = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("fin_receita_snapshot")
      .select("valor, bu_id")
      .eq("company_id", companyId)
      .gte("data_vencimento", `${ano}-01-01`)
      .lte("data_vencimento", `${ano}-12-31`)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) {
      const nome = nomeById.get(r.bu_id as string) ?? "Sem BU";
      agg.set(nome, (agg.get(nome) ?? 0) + num(r.valor));
    }
    if (rows.length < PAGE) break;
  }
  return agg;
}

async function computeCac(
  companyId: string,
  periodo: CacPeriodo,
  regime: CacRegime,
  driver: CacDriver,
): Promise<CacResumo> {
  const atualizadoEm = new Date().toISOString();
  const ano = Number(periodo.ate.slice(0, 4));

  const [linhas, vendas, receitaBu, meta, cacMeta] = await Promise.all([
    custoNormalizado(companyId, periodo),
    resumoVendas(companyId, { ano }).catch(() => null),
    receitaPorBu(companyId, ano).catch(() => new Map<string, number>()),
    getMetaMetrics({ since: `${periodo.de}-01`, until: `${periodo.ate}-31` }).catch(() => null),
    metaDeCac(periodo).catch(() => null),
  ]);

  /**
   * `meta` aqui é o REGIME de comparação, não uma base de custo própria — não
   * existe "custo meta" por centro. Para o número de destaque nesse regime
   * usamos o realizado, que é com o que a meta se compara.
   */
  const base = regime === "previsto" ? "previsto" : "realizado";

  // ---- Custo por centro, nas duas bases ----
  const porCentro = new Map<string, CacCentro>();
  for (const l of linhas) {
    const chave = `${l.centro}|${l.fonte}`;
    const c =
      porCentro.get(chave) ??
      ({
        centro: l.centro,
        bu: l.bu,
        tipo: l.tipo,
        valor: 0,
        previsto: 0,
        realizado: 0,
        fonte: l.fonte,
      } as CacCentro);
    c.previsto += l.previsto;
    c.realizado += l.realizado;
    c.valor = c[base];
    porCentro.set(chave, c);
  }
  const centros = [...porCentro.values()]
    .filter((c) => c.previsto !== 0 || c.realizado !== 0)
    .sort((a, b) => b.valor - a.valor);

  const soma = (f: (c: CacCentro) => number, tipo?: CacTipo) =>
    centros.filter((c) => !tipo || c.tipo === tipo).reduce((s, c) => s + f(c), 0);

  const custoMarketing = soma((c) => c.valor, "marketing");
  const custoComercial = soma((c) => c.valor, "comercial");
  const custoTotal = custoMarketing + custoComercial;
  const custoPrevisto = soma((c) => c.previsto);
  const custoRealizado = soma((c) => c.realizado);

  const fontes = {
    contaAzul: soma((c) => (c.fonte === "conta-azul" ? c.valor : 0)),
    bancoProprio: soma((c) => (c.fonte === "banco-proprio" ? c.valor : 0)),
  };

  const diretoPorBu = new Map<string, number>();
  let custoCompartilhado = 0;
  for (const c of centros) {
    if (c.bu) diretoPorBu.set(c.bu, (diretoPorBu.get(c.bu) ?? 0) + c.valor);
    else custoCompartilhado += c.valor;
  }
  const custoDiretoTotal = custoTotal - custoCompartilhado;

  // ---- Mídia por marca (composição + driver alternativo) ----
  const midiaPorMarca = (meta?.brands ?? [])
    .map((b) => ({
      marca: b.brand ?? "?",
      bu: MARCA_PARA_BU[b.brand ?? ""] ?? "Geral",
      valor: num(b.spend),
    }))
    .filter((m) => m.valor > 0)
    .sort((a, b) => b.valor - a.valor);
  const midiaTotal = midiaPorMarca.reduce((s, m) => s + m.valor, 0);

  /**
   * Vendas: faturadas + a faturar, DENTRO DO PERÍODO.
   *
   * `resumoVendas` traz o ano inteiro, então o recorte é feito aqui. Antes o
   * total do ano era usado direto — o que só funcionava porque o período também
   * era o ano inteiro; com seletor de período isso viraria um CAC absurdamente
   * baixo (custo de um mês ÷ vendas de doze).
   */
  const dentroDoPeriodo = (data: string | null | undefined) => {
    const m = (data ?? "").slice(0, 7);
    return m >= periodo.de && m <= periodo.ate;
  };
  const vendasNoPeriodo = (vendas?.vendas ?? []).filter((v) => dentroDoPeriodo(v.data));
  const vendasFaturadas = vendasNoPeriodo.filter((v) => v.faturado).length;
  const vendasAFaturar = vendasNoPeriodo.length - vendasFaturadas;
  const totalVendas = vendasNoPeriodo.length;

  // ---- Série mensal ----
  const custoMes = new Map<string, { previsto: number; realizado: number; fonte: CacFonte }>();
  for (const l of linhas) {
    const c = custoMes.get(l.mes) ?? { previsto: 0, realizado: 0, fonte: l.fonte };
    c.previsto += l.previsto;
    c.realizado += l.realizado;
    custoMes.set(l.mes, c);
  }
  const vendasMes = new Map<string, number>();
  for (const v of vendasNoPeriodo) {
    const mes = (v.data ?? "").slice(0, 7);
    if (mes) vendasMes.set(mes, (vendasMes.get(mes) ?? 0) + 1);
  }
  /**
   * Todos os meses do período aparecem, mesmo zerados. Montar a série só a partir
   * dos meses COM dado abria buracos silenciosos — um mês sem custo lançado
   * simplesmente sumia do gráfico, em vez de aparecer como o zero que é.
   */
  const serie: CacMes[] = mesesDoPeriodo(periodo).map((mes) => {
    const c = custoMes.get(mes);
    const custoP = c?.previsto ?? 0;
    const custoR = c?.realizado ?? 0;
    const custo = base === "previsto" ? custoP : custoR;
    const qtd = vendasMes.get(mes) ?? 0;
    return {
      mes,
      custo,
      custoPrevisto: custoP,
      custoRealizado: custoR,
      vendas: qtd,
      cac: qtd > 0 && custo > 0 ? custo / qtd : null,
      fonte: c?.fonte ?? (mes >= CORTE_BANCO_PROPRIO ? "banco-proprio" : "conta-azul"),
    };
  });

  // ---- Por BU: direto (do nome do centro) + rateio do compartilhado ----
  const midiaPorBu = new Map<string, number>();
  for (const m of midiaPorMarca) midiaPorBu.set(m.bu, (midiaPorBu.get(m.bu) ?? 0) + m.valor);

  const nomes = new Set<string>([
    ...receitaBu.keys(),
    ...midiaPorBu.keys(),
    ...diretoPorBu.keys(),
  ]);
  const receitaTotal = [...receitaBu.values()].reduce((s, v) => s + v, 0);
  const baseDriver = driver === "midia" ? midiaTotal : receitaTotal;

  const porBu: CacBu[] = [...nomes]
    .map((bu) => {
      const receita = receitaBu.get(bu) ?? 0;
      const midia = midiaPorBu.get(bu) ?? 0;
      const peso = driver === "midia" ? midia : receita;
      const share = baseDriver > 0 ? peso / baseDriver : 0;
      const custoDireto = diretoPorBu.get(bu) ?? 0;
      const custoRateado = custoCompartilhado * share;
      const total = custoDireto + custoRateado;
      return {
        bu,
        receita,
        share,
        custoDireto,
        custoRateado,
        custoTotal: total,
        midia,
        pctSobreReceita: receita > 0 ? (total / receita) * 100 : null,
      };
    })
    .sort((a, b) => b.custoTotal - a.custoTotal);

  return {
    // O banco próprio é nosso: se ele respondeu, o painel tem dado válido mesmo
    // com o Conta Azul fora do ar. Amarrar `connected` só ao CA escondia o
    // período novo inteiro quando a integração legada falhava.
    connected: linhas.length > 0 || !!vendas?.connected,
    ano,
    periodo,
    regime,
    driver,
    fontes,
    custoMarketing,
    custoComercial,
    custoTotal,
    custoPrevisto,
    custoRealizado,
    cacPrevisto: totalVendas > 0 ? custoPrevisto / totalVendas : null,
    cacRealizado: totalVendas > 0 ? custoRealizado / totalVendas : null,
    cacMeta,
    centros,
    centrosEncontrados: centros.length > 0,
    custoDiretoTotal,
    custoCompartilhado,
    midiaPorMarca,
    midiaTotal,
    vendas: totalVendas,
    vendasFaturadas,
    vendasAFaturar,
    // No regime Meta o destaque é o próprio alvo; sem alvo cadastrado cai no
    // realizado, para a tela não ficar vazia por falta de cadastro.
    cac:
      regime === "meta"
        ? (cacMeta ?? (totalVendas > 0 ? custoRealizado / totalVendas : null))
        : totalVendas > 0
          ? custoTotal / totalVendas
          : null,
    serie,
    receitaTotal,
    porBu,
    temCustoDireto: custoDiretoTotal > 0,
    atualizadoEm,
  };
}

/**
 * CAC do ano. Cache SWR de 2 CAMADAS (memória + Supabase `cache_kv`): a leitura
 * ao vivo do Conta Azul (ano inteiro de contas a pagar + vendas, paginado) é
 * pesada — persistir evita re-varrer a cada deploy/réplica. TTL 10 min; SWR serve
 * instantâneo e revalida em background. Só cacheia quando o CA respondeu.
 */
export async function getCac(
  companyId: string,
  opts: {
    periodo?: CacPeriodo;
    regime?: CacRegime;
    driver?: CacDriver;
    force?: boolean;
  } = {},
): Promise<CacResumo> {
  const periodo = opts.periodo ?? periodoPadrao();
  const regime = opts.regime ?? "realizado";
  const driver = opts.driver ?? "receita";
  return cachedSwr(
    `cac:${companyId}:${periodo.de}:${periodo.ate}:${regime}:${driver}`,
    10 * 60_000,
    () => computeCac(companyId, periodo, regime, driver),
    { force: opts.force, cacheIf: (d) => d.connected },
  );
}

/** Mês corrente em São Paulo — o servidor é UTC e viraria o mês antes da hora. */
export function mesCorrente(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

/** Período terminando no mês corrente e cobrindo `n` meses (n=1 → só o mês). */
export function periodoDeMeses(n: number): CacPeriodo {
  const ate = mesCorrente();
  const [a, m] = ate.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 - (n - 1), 1));
  return {
    de: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    ate,
  };
}

/** Ano corrente inteiro, de janeiro ao mês atual. */
export function periodoAnoCorrente(): CacPeriodo {
  const ate = mesCorrente();
  return { de: `${ate.slice(0, 4)}-01`, ate };
}

/**
 * Padrão: **ano corrente**. Mantém o número que a diretoria já conhece como
 * primeira leitura; janelas curtas ficam a um clique.
 */
export function periodoPadrao(): CacPeriodo {
  return periodoAnoCorrente();
}
