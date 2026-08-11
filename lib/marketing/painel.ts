/**
 * PAINEL consolidado do Marketing — a tela de abertura do módulo.
 *
 * Responde UMA pergunta: "como está o marketing agora, e o que precisa da minha
 * atenção?". Não é resumo de todas as abas; é o que muda decisão.
 *
 * É **composição, não integração**: todas as fontes já eram lidas e cacheadas
 * pelas abas. Aqui elas se encontram. Ver `docs/marketing-painel.md`.
 *
 * REGRAS QUE ESTE ARQUIVO PRECISA HONRAR:
 *
 * 1. **Nunca somar `marketing_daily_insights` inteiro.** A tabela guarda linhas
 *    POR MARCA e uma linha agregada com `brand = null` para o mesmo dia. Somar
 *    tudo dá o DOBRO do investimento real (medido: R$ 6.069,58 viram R$ 12.139,16
 *    em agosto/2026). `getMetaMetrics` já filtra `brand is not null`; consulta
 *    nova aqui precisa repetir o filtro.
 *
 * 2. **Degradar por bloco, nunca a tela.** Esta é a única tela que depende de
 *    todas as fontes ao mesmo tempo. Uma API fora do ar derruba o próprio bloco
 *    e acende vermelho na faixa de saúde — não leva o Painel junto.
 *
 * 3. **Ausência ≠ zero.** Fonte sem dado vira `null` + aviso, não `0`. Um "0
 *    sessões" ao lado de números saudáveis faz o leitor concluir que o site
 *    morreu, quando o que morreu foi a medição (foi exatamente o caso do GA4,
 *    parado desde 29/07/2026 sem ninguém notar).
 */
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getGa4Overview } from "./ga4";
import { ganhoSeguidores, getMetasComAtual, type MetaComAtual } from "./metas";
import { getMetaMetrics, today, type BrandMetrics } from "./metrics";
import { analyticsPorCompetencia, type AnalyticsCanal } from "./youtube-analytics";

// --------------------------------- tipos ----------------------------------- //

/** Estado de coleta de uma fonte, para a faixa de saúde. */
export interface FonteSaude {
  nome: string;
  estado: "ok" | "atraso" | "parado" | "desconhecido";
  /** Texto curto já pronto: "11/08", "parado desde 29/07", "sem conexão". */
  detalhe: string;
}

/** Um número grande da linha do mês, com a leitura do mês anterior. */
export interface NumeroDoMes {
  valor: number | null;
  anterior: number | null;
  /** Variação relativa (-1 a +∞). `null` quando não há base de comparação. */
  variacao: number | null;
  /** `true` quando SUBIR é ruim (custo). Decide a cor, não o sinal. */
  menorEhMelhor: boolean;
}

export interface Alerta {
  nivel: "critico" | "atencao";
  titulo: string;
  detalhe: string;
  /** Aba do módulo que detalha o problema (vira link). */
  aba?: string;
}

/** Uma marca na distribuição de investimento. */
export interface MarcaLinha {
  brand: string;
  spend: number;
  /** Leads + conversas — o "resultado" que a marca produz. */
  resultados: number;
  custoResultado: number | null;
  /** Fatia do investimento total (0-1), para a barra. */
  fatia: number;
}

/** Um dia da série de tendência (90 dias). */
export interface PontoTendencia {
  date: string;
  spend: number;
  resultados: number;
  /**
   * Custo por resultado em MÉDIA MÓVEL de 7 dias. `null` nos dias sem base.
   *
   * O valor diário puro é inútil aqui: um dia com 1 resultado e R$ 300 gastos
   * marca R$ 300, e o gráfico vira uma serra de picos que esconde a tendência.
   * Sete dias absorvem o fim de semana (que tem volume próprio) e mostram o que
   * interessa — se o custo vem subindo ou caindo.
   */
  custoResultado: number | null;
}

/** Uma etapa de um funil. Comparável pela FORMA, nunca somada entre canais. */
export interface EtapaFunil {
  rotulo: string;
  valor: number;
}

export interface FunilCanal {
  canal: string;
  etapas: EtapaFunil[];
  /**
   * O período que ESTE funil cobre, escrito.
   *
   * Os três não são idênticos e fingir que são seria mentir: o GA4 tem janela
   * fixa de 28 dias no leitor dele (`ga4:overview:28d`), e o YouTube Analytics
   * atrasa ~2 dias. Cada card diz o que conta.
   */
  periodo: string;
  /** Preenchido quando o canal não tem dado confiável no período. */
  aviso?: string;
}

export interface PainelResumo {
  /** Competência exibida ('AAAA-MM') e o recorte real dentro dela. */
  competencia: string;
  desde: string;
  ate: string;
  /** Mesmos dias do mês anterior — a base dos deltas. */
  anteriorDesde: string;
  anteriorAte: string;

  fontes: FonteSaude[];

  investimento: NumeroDoMes;
  resultados: NumeroDoMes;
  custoResultado: NumeroDoMes;
  /** 4º número: ganho de seguidores (IG) + inscritos líquidos (YouTube). */
  audiencia: NumeroDoMes;

  alertas: Alerta[];

  metas: {
    total: number;
    definidas: number;
    dentro: number;
    fora: number;
    /** As piores primeiro (só as que têm meta E atual). */
    piores: MetaComAtual[];
  };

  marcas: MarcaLinha[];
  tendencia: PontoTendencia[];
  funis: FunilCanal[];

  atualizadoEm: string;
}

// ------------------------------- datas ------------------------------------- //

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** Desloca uma data ISO por dias. Meio-dia UTC evita borda de fuso. */
function shift(isoDate: string, dias: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return iso(d);
}

/**
 * Mesmo intervalo de dias no mês anterior.
 *
 * "1 a 11 de agosto" vira "1 a 11 de julho", NÃO "21 a 31 de julho". Comparar
 * mês-a-mês pelo mesmo dia respeita sazonalidade (início de mês tem
 * comportamento diferente de fim) e é o que a diretoria lê como "vs mês
 * passado".
 *
 * Dia inexistente é grampeado no último do mês: 31/03 → 28/02.
 */
function mesmoIntervaloMesAnterior(desde: string, ate: string): {
  desde: string;
  ate: string;
} {
  const [a, m] = desde.split("-").map(Number);
  const diaFim = Number(ate.slice(8, 10));
  const anoAnt = m === 1 ? a - 1 : a;
  const mesAnt = m === 1 ? 12 : m - 1;
  const ultimoDia = new Date(Date.UTC(anoAnt, mesAnt, 0)).getUTCDate();
  const fim = Math.min(diaFim, ultimoDia);
  const mm = String(mesAnt).padStart(2, "0");
  return {
    desde: `${anoAnt}-${mm}-01`,
    ate: `${anoAnt}-${mm}-${String(fim).padStart(2, "0")}`,
  };
}

const ddmm = (isoDate: string): string =>
  `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;

/** Variação relativa. `null` quando a base é zero — "subiu ∞%" não informa. */
function variacao(atual: number | null, anterior: number | null): number | null {
  if (atual == null || anterior == null || anterior === 0) return null;
  return (atual - anterior) / anterior;
}

function numero(
  valor: number | null,
  anterior: number | null,
  menorEhMelhor = false,
): NumeroDoMes {
  return { valor, anterior, variacao: variacao(valor, anterior), menorEhMelhor };
}

// ------------------------------- fontes ------------------------------------ //

/** Último dia com dado numa tabela diária. `null` = tabela vazia. */
async function ultimoDia(
  tabela: "marketing_daily_insights" | "social_daily_insights",
  filtro?: { coluna: string; valor: string },
): Promise<string | null> {
  const admin = createAdminClient();
  let q = admin.from(tabela).select("date").order("date", { ascending: false }).limit(1);
  if (filtro) q = q.eq(filtro.coluna, filtro.valor);
  const { data, error } = await q;
  if (error || !data?.length) return null;
  return data[0].date as string;
}

/**
 * Traduz "último dia com dado" em estado.
 *
 * A régua é frouxa de propósito: sync diário e fuso fazem "ontem" ser normal.
 * Só acima de 3 dias vira vermelho — alarme que dispara à toa é alarme que
 * ninguém olha.
 */
function estadoPorData(nome: string, ultimo: string | null, hoje: string): FonteSaude {
  if (!ultimo) return { nome, estado: "desconhecido", detalhe: "sem dado" };
  const dias = Math.round(
    (new Date(`${hoje}T12:00:00Z`).getTime() -
      new Date(`${ultimo}T12:00:00Z`).getTime()) /
      86_400_000,
  );
  if (dias <= 1) return { nome, estado: "ok", detalhe: ddmm(ultimo) };
  if (dias <= 3) return { nome, estado: "atraso", detalhe: `${ddmm(ultimo)} · ${dias}d` };
  return { nome, estado: "parado", detalhe: `parado desde ${ddmm(ultimo)}` };
}

// ------------------------------ montagem ----------------------------------- //

/** Leads + conversas. É o "resultado" que uma campanha produz, seja qual for. */
const resultadosDe = (m: BrandMetrics): number => m.leads + m.conversations;

/** Série diária de gasto e resultados, 90 dias. Filtra o agregado (regra 1). */
async function serieTendencia(desde: string, ate: string): Promise<PontoTendencia[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("marketing_daily_insights")
    .select("date, spend, leads, conversations")
    .eq("provider", "meta_ads")
    .not("brand", "is", null) // ⚠️ sem isto, o gasto sai dobrado
    .gte("date", desde)
    .lte("date", ate)
    .order("date", { ascending: true });
  if (error || !data) return [];

  const porDia = new Map<string, PontoTendencia>();
  for (const r of data) {
    const d = r.date as string;
    const p = porDia.get(d) ?? { date: d, spend: 0, resultados: 0, custoResultado: null };
    p.spend += Number(r.spend ?? 0);
    p.resultados += Number(r.leads ?? 0) + Number(r.conversations ?? 0);
    porDia.set(d, p);
  }
  const serie = [...porDia.values()].sort((a, b) => a.date.localeCompare(b.date));

  /**
   * Média móvel de 7 dias do custo por resultado.
   *
   * Calculada sobre as SOMAS da janela (Σgasto ÷ Σresultados), não sobre a média
   * dos custos diários. A diferença importa: a média das razões dá peso igual a
   * um domingo de 2 resultados e a uma segunda de 80, e distorce para cima.
   */
  const JANELA = 7;
  for (let i = 0; i < serie.length; i++) {
    if (i < JANELA - 1) continue;
    let gasto = 0;
    let res = 0;
    for (let j = i - JANELA + 1; j <= i; j++) {
      gasto += serie[j].spend;
      res += serie[j].resultados;
    }
    serie[i].custoResultado = res > 0 ? gasto / res : null;
  }
  return serie;
}

/**
 * Alertas — regras simples sobre o que já foi carregado.
 *
 * Sem alerta, o bloco SOME na tela. Um "tudo certo ✅" toda vez treina as
 * pessoas a pular a região, e aí o alerta de verdade passa despercebido.
 */
function montarAlertas(input: {
  marcasAtual: BrandMetrics[];
  marcasAnterior: BrandMetrics[];
  metas: MetaComAtual[];
  canaisYt: AnalyticsCanal[];
  fontes: FonteSaude[];
}): Alerta[] {
  const out: Alerta[] = [];
  const anteriorPor = new Map(input.marcasAnterior.map((m) => [m.brand, m]));

  for (const m of input.marcasAtual) {
    if (!m.brand) continue;
    const res = resultadosDe(m);

    // Dinheiro saindo sem nada voltando: o mais grave, e o mais fácil de não ver.
    if (m.spend > 0 && res === 0) {
      out.push({
        nivel: "critico",
        titulo: `${m.brand} sem resultado`,
        detalhe: `R$ ${m.spend.toFixed(2)} investidos e nenhum lead ou conversa no período.`,
        aba: "meta",
      });
      continue; // sem resultado não há custo/resultado a comparar
    }

    const ant = anteriorPor.get(m.brand);
    const resAnt = ant ? resultadosDe(ant) : 0;
    if (!ant || res === 0 || resAnt === 0 || ant.spend === 0) continue;

    const custo = m.spend / res;
    const custoAnt = ant.spend / resAnt;
    const alta = (custo - custoAnt) / custoAnt;
    if (alta > 0.3) {
      out.push({
        nivel: alta > 0.5 ? "critico" : "atencao",
        titulo: `Custo por resultado subiu em ${m.brand}`,
        detalhe: `R$ ${custoAnt.toFixed(2)} → R$ ${custo.toFixed(2)} (+${Math.round(alta * 100)}% vs mês anterior).`,
        aba: "meta",
      });
    }
  }

  for (const meta of input.metas) {
    if (meta.valor == null || meta.desvio == null || meta.valor === 0) continue;
    const relativo = meta.desvio / Math.abs(meta.valor);
    if (relativo < -0.2) {
      out.push({
        nivel: relativo < -0.5 ? "critico" : "atencao",
        titulo: `Meta fora: ${meta.rotulo}`,
        detalhe: `${meta.detalhe} · ${Math.round(relativo * 100)}% em relação à meta.`,
        aba: "metas",
      });
    }
  }

  for (const c of input.canaisYt) {
    if (c.liquido < 0) {
      out.push({
        nivel: "atencao",
        titulo: `${c.marca} perdendo inscritos`,
        detalhe: `${c.ganhos} ganhos e ${c.perdidos} perdidos — saldo ${c.liquido} no mês.`,
        aba: "youtube",
      });
    }
  }

  for (const f of input.fontes) {
    if (f.estado === "parado") {
      out.push({
        nivel: "critico",
        titulo: `${f.nome} sem coletar`,
        detalhe: `${f.detalhe}. Os números desta fonte no Painel estão congelados.`,
      });
    }
  }

  // Crítico primeiro; dentro do nível, a ordem de detecção (que já é temática).
  return out.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === "critico" ? -1 : 1));
}

/**
 * O Painel inteiro.
 *
 * Período: **mês corrente até hoje**, contra os mesmos dias do mês anterior. É a
 * unidade de gestão (a mesma das metas), e não o range das outras abas — o
 * Painel responde "como está o mês", não "como está a janela que eu escolhi".
 */
export async function getPainelMarketing(
  competenciaPedida?: string,
): Promise<PainelResumo> {
  const hoje = today();
  const mesCorrente = hoje.slice(0, 7);
  const competencia = /^\d{4}-\d{2}$/.test(competenciaPedida ?? "")
    ? (competenciaPedida as string)
    : mesCorrente;

  const desde = `${competencia}-01`;
  /**
   * Mês CORRENTE para até hoje; mês fechado vai até o último dia.
   *
   * Sem isso, escolher julho compararia "1 a 11 de julho" com "1 a 11 de junho"
   * — um mês fechado exibido pela metade, o que ninguém espera ao navegar para
   * trás. E a comparação segue coerente nos dois casos, porque
   * `mesmoIntervaloMesAnterior` usa o dia final real.
   */
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimoDoMes = `${competencia}-${String(new Date(Date.UTC(ano, mes, 0)).getUTCDate()).padStart(2, "0")}`;
  const ate = competencia === mesCorrente ? hoje : ultimoDoMes;
  const ant = mesmoIntervaloMesAnterior(desde, ate);

  /** Nunca deixa uma fonte derrubar a tela (regra 2). */
  const seguro = async <T>(rotulo: string, fn: () => Promise<T>, vazio: T): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      console.error(`[painel] ${rotulo} falhou:`, (e as Error).message);
      return vazio;
    }
  };

  const [
    atual,
    anterior,
    tendencia,
    ganhosIg,
    ganhosIgAnt,
    canaisYt,
    canaisYtAnt,
    metas,
    ga4,
    ultimoMeta,
    ultimoSocial,
  ] = await Promise.all([
    seguro("meta-mes", () => getMetaMetrics({ since: desde, until: ate }), null),
    seguro("meta-anterior", () => getMetaMetrics({ since: ant.desde, until: ant.ate }), null),
    // Janela ancorada no FIM do período exibido: navegando para julho, a
    // tendência é a que levava a julho, não a que leva a hoje.
    seguro("tendencia", () => serieTendencia(shift(ate, -89), ate), [] as PontoTendencia[]),
    seguro("ig-mes", () => ganhoSeguidores(competencia), new Map<string, number | null>()),
    seguro(
      "ig-anterior",
      () => ganhoSeguidores(ant.desde.slice(0, 7)),
      new Map<string, number | null>(),
    ),
    seguro("yt-mes", () => analyticsPorCompetencia(competencia), [] as AnalyticsCanal[]),
    seguro(
      "yt-anterior",
      () => analyticsPorCompetencia(ant.desde.slice(0, 7)),
      [] as AnalyticsCanal[],
    ),
    seguro("metas", () => getMetasComAtual(competencia), [] as MetaComAtual[]),
    seguro("ga4", () => getGa4Overview(), null),
    seguro("saude-meta", () => ultimoDia("marketing_daily_insights"), null),
    seguro(
      "saude-social",
      () => ultimoDia("social_daily_insights", { coluna: "provider", valor: "instagram" }),
      null,
    ),
  ]);

  // --- os 4 números -------------------------------------------------------- //
  const invAtual = atual?.total.spend ?? null;
  const invAnt = anterior?.total.spend ?? null;
  const resAtual = atual ? resultadosDe(atual.total) : null;
  const resAnt = anterior ? resultadosDe(anterior.total) : null;

  // Custo por resultado só existe com resultado — dividir por zero daria ∞.
  const custoAtual = invAtual != null && resAtual ? invAtual / resAtual : null;
  const custoAnt = invAnt != null && resAnt ? invAnt / resAnt : null;

  const somaMapa = (m: Map<string, number | null>): number =>
    [...m.values()].reduce((s: number, v) => s + (v ?? 0), 0);
  const somaYt = (c: AnalyticsCanal[]): number =>
    c.reduce((s, x) => s + x.liquido, 0);

  /**
   * Audiência = seguidores ganhos (IG) + inscritos LÍQUIDOS (YouTube).
   *
   * Escolhido no lugar do CAC como 4º número: é 100% do Marketing e sempre tem
   * dado, enquanto o CAC realizado depende de baixas lançadas e apareceria
   * zerado. Coerente com a decisão de que CAC não é meta deste setor — ele fica
   * como leitura na aba própria.
   *
   * Líquido, não bruto: ganhar 382 e perder 767 não é crescimento.
   */
  const audAtual = somaMapa(ganhosIg) + somaYt(canaisYt);
  const audAnt = somaMapa(ganhosIgAnt) + somaYt(canaisYtAnt);

  // --- saúde das fontes ---------------------------------------------------- //
  const fontes: FonteSaude[] = [
    estadoPorData("Meta Ads", ultimoMeta, hoje),
    estadoPorData("Instagram", ultimoSocial, hoje),
    {
      nome: "YouTube",
      // Leitura ao vivo: lista vazia = desconectado ou API fora, não "zero".
      estado: canaisYt.length ? "ok" : "desconhecido",
      detalhe: canaisYt.length ? `${canaisYt.length} canais` : "sem conexão",
    },
    {
      nome: "GA4 / Site",
      estado: ga4?.hasData && ga4.totals.sessions > 0 ? "ok" : "parado",
      detalhe:
        ga4?.hasData && ga4.totals.sessions > 0
          ? `${ga4.totals.sessions} sessões`
          : "sem coleta",
    },
  ];

  // --- metas --------------------------------------------------------------- //
  const comMeta = metas.filter((m) => m.valor != null);
  const comDesvio = comMeta.filter((m) => m.desvio != null);
  const piores = [...comDesvio].sort((a, b) => {
    // Ordena pelo desvio RELATIVO: -R$ 2 numa meta de R$ 8 é pior que -500
    // numa de 100.000, e o absoluto colocaria a segunda na frente.
    const ra = (a.desvio as number) / Math.abs(a.valor || 1);
    const rb = (b.desvio as number) / Math.abs(b.valor || 1);
    return ra - rb;
  });

  // --- marcas -------------------------------------------------------------- //
  const totalSpend = atual?.total.spend ?? 0;
  const marcas: MarcaLinha[] = (atual?.brands ?? [])
    .filter((b): b is BrandMetrics & { brand: string } => !!b.brand)
    .map((b) => {
      const res = resultadosDe(b);
      return {
        brand: b.brand,
        spend: b.spend,
        resultados: res,
        custoResultado: res ? b.spend / res : null,
        fatia: totalSpend > 0 ? b.spend / totalSpend : 0,
      };
    })
    .sort((a, b) => b.spend - a.spend);

  // --- funis --------------------------------------------------------------- //
  /**
   * Quatro funis em PARALELO. As etapas nunca são somadas entre canais:
   * "alcance" do Instagram e "impressões" do Meta não são a mesma unidade, e
   * empilhá-las produziria um número que não existe.
   */
  const ytViews = canaisYt.reduce((s, c) => s + c.views, 0);
  const ytInscritos = somaYt(canaisYt);
  const periodoTexto = `${ddmm(desde)} a ${ddmm(ate)}`;
  const funis: FunilCanal[] = [
    {
      canal: "Meta Ads",
      periodo: periodoTexto,
      etapas: [
        { rotulo: "Impressões", valor: atual?.total.impressions ?? 0 },
        { rotulo: "Cliques", valor: atual?.total.clicks ?? 0 },
        { rotulo: "Resultados", valor: resAtual ?? 0 },
      ],
    },
    {
      canal: "YouTube",
      // Mesma janela do Meta, mas a Analytics API consolida com ~2 dias de
      // atraso — os últimos dias vêm zerados e isso não é queda de audiência.
      periodo: `${periodoTexto} · ~2d de atraso`,
      etapas: [
        { rotulo: "Views", valor: ytViews },
        { rotulo: "Inscritos (líq.)", valor: ytInscritos },
      ],
      aviso: canaisYt.length ? undefined : "Sem conexão com o YouTube.",
    },
    {
      canal: "GA4 / Site",
      /**
       * ⚠️ O ÚNICO que não segue o filtro. `getGa4Overview()` tem janela fixa de
       * 28 dias no próprio leitor (chave de cache `ga4:overview:28d`) e não
       * aceita período. Escrito no card em vez de silenciado — três funis lado a
       * lado com períodos diferentes, sem dizer, é o tipo de coisa que faz
       * alguém comparar o que não é comparável.
       */
      periodo: "últimos 28 dias (fixo)",
      etapas: [
        { rotulo: "Sessões", valor: ga4?.totals.sessions ?? 0 },
        { rotulo: "Conversões", valor: ga4?.totals.conversions ?? 0 },
      ],
      // Aviso explícito em vez de esconder o bloco: funil ausente sugere que não
      // existe site; funil marcado como parado convida a consertar a medição.
      aviso:
        ga4?.hasData && ga4.totals.sessions > 0
          ? ga4.totals.conversions === 0
            ? "Sem eventos-chave configurados no GA4 — conversão fica em zero."
            : undefined
          : "Sem coleta. Ver docs/ga4-sgtm-diagnostico.md.",
    },
  ];

  const fontesProntas = fontes;

  return {
    competencia,
    desde,
    ate,
    anteriorDesde: ant.desde,
    anteriorAte: ant.ate,
    fontes: fontesProntas,
    investimento: numero(invAtual, invAnt),
    resultados: numero(resAtual, resAnt),
    custoResultado: numero(custoAtual, custoAnt, true), // teto: subir é ruim
    audiencia: numero(audAtual, audAnt),
    alertas: montarAlertas({
      marcasAtual: atual?.brands ?? [],
      marcasAnterior: anterior?.brands ?? [],
      metas,
      canaisYt,
      fontes: fontesProntas,
    }),
    metas: {
      total: metas.length,
      definidas: comMeta.length,
      dentro: comDesvio.filter((m) => (m.desvio as number) >= 0).length,
      fora: comDesvio.filter((m) => (m.desvio as number) < 0).length,
      piores: piores.slice(0, 5),
    },
    marcas,
    tendencia,
    funis,
    atualizadoEm: new Date().toISOString(),
  };
}

/** Reexport para o componente não precisar importar de dois módulos. */
export type { MetaComAtual };
