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
 * ## Previsto × Realizado — os DOIS lados andam juntos (2026-08-05)
 *
 *   Previsto    custo lançado  ÷  vendas totais (faturadas + a faturar)
 *   Realizado   custo PAGO     ÷  vendas FATURADAS
 *
 * Antes o denominador era o mesmo nos dois e só o numerador mudava. Ficava
 * incoerente: "realizado" misturava dinheiro que saiu com venda que ainda não
 * virou nota. Agora cada regime é internamente consistente — realizado é o que
 * de fato aconteceu dos dois lados.
 *
 * Efeito colateral desejado: no dia 5 do mês o realizado é baixo em cima E
 * embaixo, o que é a resposta certa para um mês que mal começou. Antes o custo
 * do mês inteiro caía sobre as vendas de cinco dias e produzia um CAC seis vezes
 * maior, que precisava de um aviso na tela para não assustar.
 *
 * Em troca, os dois deixam de ser diretamente comparáveis (denominadores
 * diferentes). É um preço justo: cada número passa a significar a mesma coisa
 * dos dois lados da divisão.
 *
 * ## Escopo: isto é uma tela de MARKETING
 *
 * Não há meta de CAC. Meta de CAC é meta de CUSTO, e custo não é alavanca do
 * Marketing — quem decide quanto se gasta em Comercial não é quem faz campanha.
 * O Marketing tem metas do que controla (custo por lead, por conversa,
 * seguidores, inscritos); o CAC é consequência delas.
 *
 * Também não há receita por BU, rateio nem "% sobre receita". Isso é
 * controladoria, e vazava faturamento da empresa para dentro do módulo de
 * Marketing. O cálculo por BU continua aqui, atrás de `incluirBu`, para quando
 * alguém quiser a visão no Financeiro — só não é o padrão.
 *
 * Server-only, por empresa. Gate no chamador: `marketing`.
 */
import "server-only";

import { cachedSwr } from "@/lib/cache/kv";
import { resumoCentrosCusto } from "@/lib/financeiro/centros-custo";
import { resumoVendas } from "@/lib/financeiro/vendas";
import { getMetaMetrics } from "@/lib/marketing/metrics";
import { createAdminClient } from "@/lib/supabase/admin";

import { custoBancoProprio } from "./cac-banco-proprio";
import {
  CAC_MESES_SERIE,
  CAC_MES_MIN,
  cacDeslocaMes,
  cacMesCorrente,
} from "./cac-opcoes";

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
  custoPrevisto: number;
  custoRealizado: number;
  /** Faturadas + a faturar. Denominador do PREVISTO. */
  vendas: number;
  /** Só as faturadas. Denominador do REALIZADO. */
  vendasFaturadas: number;
  cacPrevisto: number | null;
  cacRealizado: number | null;
  /** Qual base alimentou o mês — útil para explicar degraus na série. */
  fonte: CacFonte;
}

export interface CacResumo {
  connected: boolean;
  ano: number;
  periodo: CacPeriodo;
  driver: CacDriver;
  /** Quanto do custo veio de cada base — deixa o corte visível na tela. */
  fontes: { contaAzul: number; bancoProprio: number };
  // ---- Custo ----
  custoMarketing: number;
  custoComercial: number;
  /** Alias de `custoPrevisto`; mantido porque é o total que a tela chama de "custo". */
  custoTotal: number;
  custoPrevisto: number;
  custoRealizado: number;
  // ---- Resultado: cada regime com o SEU denominador ----
  cacPrevisto: number | null;
  cacRealizado: number | null;
  /** Centros que entraram na conta. Não vai à tela de Marketing. */
  centros: CacCentro[];
  centrosEncontrados: boolean;
  custoDiretoTotal: number;
  custoCompartilhado: number;
  // ---- Mídia (composição; NÃO soma ao custo) ----
  midiaPorMarca: { marca: string; bu: string; valor: number }[];
  midiaTotal: number;
  // ---- Vendas (fonte: Conta Azul) ----
  vendas: number;
  vendasFaturadas: number;
  vendasAFaturar: number;
  serie: CacMes[];
  /** Só preenchidos com `incluirBu` — visão de controladoria, não de Marketing. */
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
  mes: string,
  driver: CacDriver,
  incluirBu: boolean,
): Promise<CacResumo> {
  const atualizadoEm = new Date().toISOString();
  const ano = Number(mes.slice(0, 4));

  /** O mês escolhido — é dele que saem os números do topo. */
  const periodo: CacPeriodo = { de: mes, ate: mes };

  /**
   * A janela do GRÁFICO: 12 meses terminando no mês escolhido.
   *
   * Buscamos o custo da janela inteira e filtramos o mês nos agregados. Custa
   * praticamente o mesmo que buscar um mês — o leitor do Conta Azul já varre o
   * ano todo de qualquer forma, e o do banco próprio é uma consulta só — e
   * evita uma segunda ida ao banco só para desenhar a série.
   */
  const janelaSerie: CacPeriodo = {
    // Trava em `CAC_MES_MIN`: antes disso não há histórico de custo, e as barras
    // vazias sugeririam meses de gasto zero em vez de "não sabemos".
    de: (() => {
      const inicio = cacDeslocaMes(mes, -(CAC_MESES_SERIE - 1));
      return inicio < CAC_MES_MIN ? CAC_MES_MIN : inicio;
    })(),
    ate: mes,
  };

  // A janela de 12 meses pode cruzar o ano; `resumoVendas` é por ano.
  const anosDaJanela = [
    ...new Set([Number(janelaSerie.de.slice(0, 4)), Number(janelaSerie.ate.slice(0, 4))]),
  ];

  const [todasLinhas, vendasPorAno, receitaBu, meta] = await Promise.all([
    custoNormalizado(companyId, janelaSerie),
    Promise.all(anosDaJanela.map((a) => resumoVendas(companyId, { ano: a }).catch(() => null))),
    // Varredura paginada de `fin_receita_snapshot`, só usada pela visão de BU.
    // Fora dela seria custo puro: a tela de Marketing não mostra receita.
    incluirBu
      ? receitaPorBu(companyId, ano).catch(() => new Map<string, number>())
      : Promise.resolve(new Map<string, number>()),
    getMetaMetrics({ since: `${mes}-01`, until: `${mes}-31` }).catch(() => null),
  ]);

  const vendas = vendasPorAno.find((v) => v?.connected) ?? null;
  const todasVendas = vendasPorAno.flatMap((v) => v?.vendas ?? []);

  /** Só o mês escolhido alimenta os KPIs; o resto é contexto do gráfico. */
  const linhas = todasLinhas.filter((l) => l.mes === mes);

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
    // "Valor" do centro = o previsto. É o que existe em todo mês, inclusive nos
    // que ainda não tiveram baixa — usar realizado zeraria a composição inteira
    // de agosto em diante.
    c.valor = c.previsto;
    porCentro.set(chave, c);
  }
  const centros = [...porCentro.values()]
    .filter((c) => c.previsto !== 0 || c.realizado !== 0)
    .sort((a, b) => b.valor - a.valor);

  const soma = (f: (c: CacCentro) => number, tipo?: CacTipo) =>
    centros.filter((c) => !tipo || c.tipo === tipo).reduce((s, c) => s + f(c), 0);

  const custoMarketing = soma((c) => c.previsto, "marketing");
  const custoComercial = soma((c) => c.previsto, "comercial");
  const custoPrevisto = soma((c) => c.previsto);
  const custoRealizado = soma((c) => c.realizado);
  const custoTotal = custoPrevisto;

  const fontes = {
    contaAzul: soma((c) => (c.fonte === "conta-azul" ? c.previsto : 0)),
    bancoProprio: soma((c) => (c.fonte === "banco-proprio" ? c.previsto : 0)),
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
   * Vendas: faturadas + a faturar, DO MÊS ESCOLHIDO.
   *
   * `resumoVendas` traz o ano inteiro, então o recorte é feito aqui. Antes o
   * total do ano era usado direto — o que só funcionava porque o período também
   * era o ano inteiro; com seletor de mês isso viraria um CAC absurdamente
   * baixo (custo de um mês ÷ vendas de doze).
   */
  const vendasNoPeriodo = todasVendas.filter((v) => (v.data ?? "").slice(0, 7) === mes);
  const vendasFaturadas = vendasNoPeriodo.filter((v) => v.faturado).length;
  const vendasAFaturar = vendasNoPeriodo.length - vendasFaturadas;
  const totalVendas = vendasNoPeriodo.length;

  // ---- Série mensal: os 12 meses da janela, não só o escolhido ----
  const custoMes = new Map<string, { previsto: number; realizado: number; fonte: CacFonte }>();
  for (const l of todasLinhas) {
    const c = custoMes.get(l.mes) ?? { previsto: 0, realizado: 0, fonte: l.fonte };
    c.previsto += l.previsto;
    c.realizado += l.realizado;
    custoMes.set(l.mes, c);
  }
  // Dois contadores por mês: o total alimenta o previsto, o faturado alimenta o
  // realizado. É a mesma regra do agregado — cada regime com o seu denominador.
  const vendasMes = new Map<string, { total: number; faturadas: number }>();
  for (const v of todasVendas) {
    const m = (v.data ?? "").slice(0, 7);
    if (!m || m < janelaSerie.de || m > janelaSerie.ate) continue;
    const c = vendasMes.get(m) ?? { total: 0, faturadas: 0 };
    c.total += 1;
    if (v.faturado) c.faturadas += 1;
    vendasMes.set(m, c);
  }
  /**
   * Todos os meses da janela aparecem, mesmo zerados. Montar a série só a partir
   * dos meses COM dado abria buracos silenciosos — um mês sem custo lançado
   * simplesmente sumia do gráfico, em vez de aparecer como o zero que é.
   */
  const serie: CacMes[] = mesesDoPeriodo(janelaSerie).map((mes) => {
    const c = custoMes.get(mes);
    const custoP = c?.previsto ?? 0;
    const custoR = c?.realizado ?? 0;
    const v = vendasMes.get(mes) ?? { total: 0, faturadas: 0 };
    return {
      mes,
      custoPrevisto: custoP,
      custoRealizado: custoR,
      vendas: v.total,
      vendasFaturadas: v.faturadas,
      cacPrevisto: v.total > 0 && custoP > 0 ? custoP / v.total : null,
      cacRealizado: v.faturadas > 0 && custoR > 0 ? custoR / v.faturadas : null,
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
    driver,
    fontes,
    custoMarketing,
    custoComercial,
    custoTotal,
    custoPrevisto,
    custoRealizado,
    // Cada regime com o SEU denominador — ver a nota no topo do arquivo.
    cacPrevisto: totalVendas > 0 ? custoPrevisto / totalVendas : null,
    cacRealizado: vendasFaturadas > 0 ? custoRealizado / vendasFaturadas : null,
    centros,
    centrosEncontrados: centros.length > 0,
    custoDiretoTotal,
    custoCompartilhado,
    midiaPorMarca,
    midiaTotal,
    vendas: totalVendas,
    vendasFaturadas,
    vendasAFaturar,
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
    /** Competência 'AAAA-MM'. Padrão: mês corrente. */
    mes?: string;
    driver?: CacDriver;
    /**
     * Liga a visão por BU (receita, rateio, % sobre receita). **Fora do padrão**:
     * é controladoria, não Marketing, e custa uma varredura paginada de
     * `fin_receita_snapshot`. Existe para um futuro painel no Financeiro.
     */
    incluirBu?: boolean;
    force?: boolean;
  } = {},
): Promise<CacResumo> {
  const mes = opts.mes ?? cacMesCorrente();
  const driver = opts.driver ?? "receita";
  const incluirBu = opts.incluirBu ?? false;
  return cachedSwr(
    `cac:${companyId}:${mes}:${driver}:${incluirBu ? "bu" : "nobu"}`,
    10 * 60_000,
    () => computeCac(companyId, mes, driver, incluirBu),
    { force: opts.force, cacheIf: (d) => d.connected },
  );
}
