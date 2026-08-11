/**
 * Metas do painel de Marketing (tabela `mkt_metas`, migration 0036).
 *
 * Server-only e GLOBAL — o módulo de marketing não é escopado por empresa (ver
 * `config.ts`); o acesso é pela permissão `marketing`.
 *
 * ESCOPO ATUAL — 11 metas, TODAS de coisas que o Marketing controla:
 *   4 · custo por resultado, por marca do Meta Ads
 *   5 · seguidores do Instagram, por PERFIL (o "Everton" tem dois)
 *   2 · inscritos do YouTube, por canal (via Analytics API — ver abaixo)
 *
 * Os inscritos do YouTube ficaram fora até existir OAuth do dono: a Data API
 * arredonda para 3 dígitos significativos acima de 1.000, INCLUSIVE para o dono,
 * e o CPPEM marcava 387.000 parado havia semanas — "ganho no mês" daria sempre
 * zero. Com a Analytics API o mesmo julho aparece como 382 ganhos e 767 perdidos.
 * Só dá para cadastrar meta sobre um número que se mexe.
 *
 * FORA DE PROPÓSITO: o **CAC** não é meta daqui — é meta de CUSTO, e custo não é
 * alavanca do Marketing. Fica só como leitura na aba própria. A receita do
 * YouTube também está fora (canais não monetizados devolvem `rows: []`).
 * Ver docs/marketing-metas.md.
 */
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { MARKETING_AD_ACCOUNTS } from "./config";
// `today()` do módulo de métricas já resolve o fuso de São Paulo — o servidor é
// UTC, e na virada do mês o fuso errado devolveria a competência anterior.
import { today as hojeSP } from "./metrics";
import { ganhoInscritosPorCanal } from "./youtube-analytics";

/** Métricas que a tabela aceita. Só as duas primeiras estão em uso. */
export type MetricaMeta =
  | "custo_resultado"
  | "seguidores_ig"
  | "seguidores_yt"
  | "cac"
  | "receita_yt";

/** `max` = TETO (menor é melhor). `min` = PISO (maior é melhor). */
export type DirecaoMeta = "max" | "min";

/**
 * Como a métrica se comporta ao longo do mês — e é isso que decide se ela pode
 * ser comparada com a meta no dia 11.
 *
 * | tipo         | exemplo             | comparável no meio do mês? |
 * |--------------|---------------------|----------------------------|
 * | `taxa`       | custo por resultado | **sim** — R$ 7,85/lead é R$ 7,85 no dia 5 ou no 30 |
 * | `acumulado`  | seguidores ganhos   | **não** — 11 dias contra a meta do mês inteiro |
 *
 * Sem essa distinção, TODA meta acumulada nasce vermelha no dia 1º e vai
 * esverdeando — o que ensina o time a ignorar a cor por três semanas, que é o
 * mesmo que não ter meta. Ver `docs/marketing-metas-plano.md` §2.1.
 */
export type TipoMetrica = "taxa" | "acumulado";

/** Um alvo mensurável — a linha da tela, exista meta cadastrada ou não. */
export interface AlvoMeta {
  metrica: MetricaMeta;
  /** Chave estável: label da marca (custo) ou account_id (seguidores). */
  alvo: string;
  /** Como aparece na tela. */
  rotulo: string;
  /** Contexto curto: "por lead", "por conversa", "@handle". */
  detalhe: string;
  direcao: DirecaoMeta;
  /** Ver `TipoMetrica`: decide se cabe comparar antes do mês fechar. */
  tipo: TipoMetrica;
  /** 'brl' formata como dinheiro; 'num' como inteiro. */
  unidade: "brl" | "num";
}

export interface MetaComAtual extends AlvoMeta {
  /** Meta cadastrada. `null` = ninguém cadastrou (diferente de meta zero). */
  valor: number | null;
  /** O que aconteceu na competência. `null` = sem base para calcular. */
  atual: number | null;
  /**
   * Distância da meta, SEMPRE na leitura "positivo = melhor que o planejado",
   * independente de ser teto ou piso — a mesma convenção do DRE, para não exigir
   * que o leitor lembre a direção de cada linha.
   */
  desvio: number | null;
  /** `atual` é negativo? Perder seguidor é diferente de crescer pouco. */
  regressao: boolean;

  /**
   * A RÉGUA — o que o número significa, ao lado de onde ele é digitado.
   *
   * Existe por causa de um erro real: alguém cadastrou meta de **110.000** num
   * perfil de 93.175 seguidores, querendo dizer "chegar a 110 mil". A métrica é
   * *ganho no mês*, então a tela exibiu desvio de −108.960. O cabeçalho do bloco
   * já avisava "ganho no mês (não o total)" e não bastou — texto explicando não
   * compete com um campo vazio pedindo um número.
   *
   * Só existe para `tipo: "acumulado"`; taxa não tem "total" com que confundir.
   */
  baseline?: {
    /** Onde a conta está hoje (93.175 seguidores). */
    atualAbsoluto: number | null;
    /** Ganho médio dos últimos meses fechados — a ordem de grandeza plausível. */
    mediaHistorica: number | null;
  };

  /**
   * O RITMO — comparação justa antes do mês fechar.
   *
   * Métrica acumulada comparada com a meta do mês inteiro no dia 11 é sempre
   * injusta: nasce vermelha no dia 1º e vai esverdeando, o que treina o time a
   * ignorar a cor por três semanas. Aqui a comparação é contra o **esperado até
   * hoje**, e a projeção diz onde o mês termina no ritmo atual.
   *
   * `undefined` em mês fechado (não há o que projetar) e em `tipo: "taxa"`.
   */
  ritmo?: {
    diasDecorridos: number;
    diasNoMes: number;
    /** Meta × (dias decorridos ÷ dias do mês). */
    esperadoAteHoje: number;
    /** Atual ÷ dias decorridos × dias do mês. `null` sem base. */
    projecao: number | null;
    /** Último dia REALMENTE coletado — o denominador honesto. */
    ultimaColeta: string;
  };
}

/** Só a marca sabe se conta lead ou conversa — ver `resultado` em config.ts. */
function rotuloResultado(r: "lead" | "conversa"): string {
  return r === "conversa" ? "por conversa" : "por lead";
}

/**
 * Os alvos que a tela oferece, na ordem de exibição. Derivados do config das
 * marcas — acrescentar uma marca lá faz a meta aparecer aqui sozinha.
 *
 * `handles` mapeia account_id → @perfil, para distinguir os DOIS Instagrams do
 * "Everton" (103 mil e 5 mil seguidores). Sem isso a tela mostraria duas linhas
 * "Everton" idênticas.
 */
export function alvosDeMeta(handles: Map<string, string> = new Map()): AlvoMeta[] {
  const custo: AlvoMeta[] = MARKETING_AD_ACCOUNTS.map((b) => ({
    metrica: "custo_resultado" as const,
    alvo: b.label,
    rotulo: b.label,
    detalhe: rotuloResultado(b.resultado),
    direcao: "max" as const, // teto: gastar menos por resultado é melhor
    tipo: "taxa" as const, // razão gasto/resultado — não acumula com os dias
    unidade: "brl" as const,
  }));

  const seguidores: AlvoMeta[] = MARKETING_AD_ACCOUNTS.flatMap((b) =>
    b.instagram.map((accountId) => ({
      metrica: "seguidores_ig" as const,
      alvo: accountId,
      rotulo: b.label,
      detalhe: handles.get(accountId) ? `@${handles.get(accountId)}` : accountId,
      direcao: "min" as const, // piso: ganhar mais seguidores é melhor
      tipo: "acumulado" as const, // soma ao longo do mês
      unidade: "num" as const,
    })),
  );

  /**
   * Inscritos do YouTube, por canal. Chave é o `channelId` — estável mesmo se a
   * marca for renomeada, ao contrário do label.
   *
   * Só marcas COM canal no config entram (Unicive não tem). O alvo é o ganho
   * LÍQUIDO do mês, a mesma leitura do Instagram: perder 767 e ganhar 382 não é
   * crescimento, e uma meta sobre o bruto premiaria um canal que sangra.
   */
  const inscritos: AlvoMeta[] = MARKETING_AD_ACCOUNTS.filter((b) => b.youtube).map(
    (b) => ({
      metrica: "seguidores_yt" as const,
      alvo: b.youtube as string,
      rotulo: b.label,
      detalhe: "inscritos no mês",
      direcao: "min" as const, // piso: crescer mais é melhor
      tipo: "acumulado" as const, // soma ao longo do mês
      unidade: "num" as const,
    }),
  );

  /**
   * CAC NÃO é meta do Marketing (decisão de 2026-08-05).
   *
   * Meta de CAC é meta de CUSTO, e custo não é alavanca deste setor — quem
   * decide quanto se gasta em Comercial não é quem faz campanha. Cobrar meta de
   * algo que o time não controla produz número decorativo.
   *
   * O Marketing tem metas do que controla (custo por lead, por conversa,
   * seguidores, inscritos); o CAC é consequência delas e fica só como leitura,
   * na aba própria.
   */
  return [...custo, ...seguidores, ...inscritos];
}

/** Competência deslocada por `n` meses. `-1` = mês anterior. */
function competenciaShift(competencia: string, n: number): string {
  const [a, m] = competencia.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Atraso de consolidação da YouTube Analytics API.
 *
 * A API entrega os últimos dias incompletos ou vazios. Usar "hoje" como
 * denominador do ritmo faria o cálculo dividir o ganho de 9 dias por 11, e um
 * mês saudável apareceria atrasado. Constante em vez de detecção porque a
 * resposta da API não diz qual foi o último dia com dado.
 */
const ATRASO_YT_DIAS = 2;

/** Último dia da competência ('AAAA-MM' → 'AAAA-MM-DD'). */
function ultimoDia(competencia: string): string {
  const [a, m] = competencia.split("-").map(Number);
  const d = new Date(Date.UTC(a, m, 0));
  return `${competencia}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * @handle de cada conta do Instagram, extraído dos permalinks de STORIES
 * (`instagram.com/stories/<handle>/...`). Posts comuns usam `/p/` ou `/reel/`,
 * que não trazem o nome — por isso só os stories servem. Conta sem story fica
 * sem handle e a tela cai no account_id.
 */
async function handlesInstagram(): Promise<Map<string, string>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("social_media_insights")
    .select("account_id, permalink")
    .eq("provider", "instagram")
    .like("permalink", "%/stories/%")
    .limit(1000);
  const mapa = new Map<string, string>();
  for (const r of data ?? []) {
    const m = /instagram\.com\/stories\/([^/]+)\//.exec(String(r.permalink ?? ""));
    if (m && !mapa.has(r.account_id as string)) mapa.set(r.account_id as string, m[1]);
  }
  return mapa;
}

/** Custo por resultado de cada marca na competência. null sem base. */
async function custoPorResultado(competencia: string): Promise<Map<string, number | null>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("marketing_daily_insights")
    .select("brand, spend, leads, conversations")
    .gte("date", `${competencia}-01`)
    .lte("date", ultimoDia(competencia));

  const acc = new Map<string, { spend: number; lead: number; conversa: number }>();
  for (const r of data ?? []) {
    const brand = r.brand as string | null;
    if (!brand) continue; // null = agregado da conta; as marcas vêm separadas
    const c = acc.get(brand) ?? { spend: 0, lead: 0, conversa: 0 };
    c.spend += Number(r.spend ?? 0);
    c.lead += Number(r.leads ?? 0);
    c.conversa += Number(r.conversations ?? 0);
    acc.set(brand, c);
  }

  const out = new Map<string, number | null>();
  for (const b of MARKETING_AD_ACCOUNTS) {
    const c = acc.get(b.label);
    if (!c) {
      out.set(b.label, null);
      continue;
    }
    const base = b.resultado === "conversa" ? c.conversa : c.lead;
    // Sem resultado no mês não existe custo POR resultado — dividir daria ∞.
    out.set(b.label, base > 0 ? c.spend / base : null);
  }
  return out;
}

/**
 * Ganho de seguidores no mês, por conta.
 *
 * EXPORTADO para o Painel (`painel.ts`) somar a audiência do mês. A sutileza do
 * "último snapshot ANTERIOR ao mês" (abaixo) é fácil de errar refazendo — por
 * isso reuso em vez de duplicar.
 *
 * Mede do ÚLTIMO snapshot ANTERIOR à competência até o último dentro dela — e
 * não do primeiro ao último do mês, que perderia o crescimento ocorrido entre a
 * virada e o primeiro snapshot. Sem snapshot anterior (a série começa em
 * 15/06/2026), cai para o primeiro do mês e o número fica parcial.
 */
export async function ganhoSeguidores(competencia: string): Promise<Map<string, number | null>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("social_daily_insights")
    .select("account_id, date, followers")
    .eq("provider", "instagram")
    .lte("date", ultimoDia(competencia))
    .order("date", { ascending: true });

  const porConta = new Map<string, { date: string; followers: number }[]>();
  for (const r of data ?? []) {
    if (r.followers == null) continue;
    const a = porConta.get(r.account_id as string) ?? [];
    a.push({ date: r.date as string, followers: Number(r.followers) });
    porConta.set(r.account_id as string, a);
  }

  const inicio = `${competencia}-01`;
  const out = new Map<string, number | null>();
  for (const [conta, serie] of porConta) {
    const noMes = serie.filter((s) => s.date >= inicio);
    if (noMes.length === 0) {
      out.set(conta, null);
      continue;
    }
    const anteriores = serie.filter((s) => s.date < inicio);
    const partida = anteriores.length
      ? anteriores[anteriores.length - 1].followers
      : noMes[0].followers;
    out.set(conta, noMes[noMes.length - 1].followers - partida);
  }
  return out;
}

/** Metas cadastradas na competência, indexadas por `metrica|alvo`. */
async function metasCadastradas(competencia: string): Promise<Map<string, number>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mkt_metas")
    .select("metrica, alvo, valor")
    .eq("competencia", competencia)
    .eq("ativo", true);
  if (error) throw new Error(`metasCadastradas: ${error.message}`);
  return new Map((data ?? []).map((r) => [`${r.metrica}|${r.alvo}`, Number(r.valor)]));
}

/**
 * A tela inteira: um item por alvo, com a meta (se houver) e o que aconteceu.
 *
 * Alvo sem meta cadastrada APARECE, com `valor: null` — é o estado que convida a
 * cadastrar, e some-lo esconderia justamente o que falta preencher.
 */
/** Total de seguidores hoje, por conta — o "onde estamos" da régua. */
async function totalSeguidores(): Promise<Map<string, number>> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("social_daily_insights")
    .select("account_id, date, followers")
    .eq("provider", "instagram")
    .order("date", { ascending: false })
    .limit(500);
  const out = new Map<string, number>();
  for (const r of data ?? []) {
    // A consulta vem do mais recente para o mais antigo: o PRIMEIRO de cada
    // conta já é o snapshot atual.
    if (r.followers != null && !out.has(r.account_id as string))
      out.set(r.account_id as string, Number(r.followers));
  }
  return out;
}

/**
 * Ganho médio mensal dos últimos `n` meses FECHADOS.
 *
 * Fechados de propósito: incluir o mês corrente (que está pela metade) puxaria a
 * média para baixo e faria a régua sugerir uma meta menor do que o time entrega.
 */
async function mediaHistorica(
  competencia: string,
  n: number,
): Promise<{ ig: Map<string, number>; yt: Map<string, number> }> {
  const meses = Array.from({ length: n }, (_, i) => competenciaShift(competencia, -(i + 1)));

  const [igs, yts] = await Promise.all([
    Promise.all(meses.map((m) => ganhoSeguidores(m).catch(() => new Map<string, number | null>()))),
    Promise.all(
      // Mês fechado tem TTL de 30 dias (ver `cache-ttl.ts`) — na prática isto
      // custa uma consulta por mês a cada 30 dias, não a cada abertura da aba.
      meses.map((m) => ganhoInscritosPorCanal(m).catch(() => new Map<string, number>())),
    ),
  ]);

  const media = <T extends Map<string, number | null> | Map<string, number>>(
    mapas: T[],
  ): Map<string, number> => {
    const soma = new Map<string, { total: number; n: number }>();
    for (const mapa of mapas)
      for (const [k, v] of mapa) {
        if (v == null) continue;
        const c = soma.get(k) ?? { total: 0, n: 0 };
        c.total += v;
        c.n += 1;
        soma.set(k, c);
      }
    return new Map([...soma].map(([k, c]) => [k, c.total / c.n]));
  };

  return { ig: media(igs), yt: media(yts) };
}

export async function getMetasComAtual(competencia: string): Promise<MetaComAtual[]> {
  const [handles, cadastradas, custos, ganhos, inscritos, totais, medias] = await Promise.all([
    handlesInstagram(),
    metasCadastradas(competencia),
    custoPorResultado(competencia),
    ganhoSeguidores(competencia),
    /**
     * Única fonte EXTERNA desta tela — as outras leem o nosso banco. Se o
     * YouTube estiver desconectado ou fora do ar, as linhas de inscritos ficam
     * sem `atual`, e as outras 9 metas seguem intactas. Deixar propagar levaria
     * a tela inteira junto por causa de um canal.
     */
    ganhoInscritosPorCanal(competencia).catch((e) => {
      console.error("[metas] Analytics do YouTube falhou — inscritos sem atual.", e);
      return new Map<string, number>();
    }),
    // A régua degrada em silêncio: sem ela a tela volta a ser o que era, e isso
    // é melhor do que a tela inteira falhar por causa de um número auxiliar.
    totalSeguidores().catch(() => new Map<string, number>()),
    mediaHistorica(competencia, 3).catch(() => ({
      ig: new Map<string, number>(),
      yt: new Map<string, number>(),
    })),
  ]);

  // --- ritmo: só faz sentido no mês CORRENTE ------------------------------- //
  const hoje = hojeSP();
  const mesCorrente = competencia === hoje.slice(0, 7);
  const diasNoMes = Number(ultimoDia(competencia).slice(8, 10));
  const diaHoje = Number(hoje.slice(8, 10));

  /**
   * Dias decorridos POR FONTE, não um número só.
   *
   * O Instagram é snapshot diário e chega até ontem/hoje; o YouTube Analytics
   * consolida com ~2 dias de atraso. Usar o mesmo denominador para os dois faria
   * o YouTube parecer atrasado todo mês, por um motivo que não é de desempenho.
   */
  const diasIg = Math.max(1, Math.min(diaHoje, diasNoMes));
  const diasYt = Math.max(1, Math.min(diaHoje - ATRASO_YT_DIAS, diasNoMes));

  return alvosDeMeta(handles).map((a) => {
    const valor = cadastradas.get(`${a.metrica}|${a.alvo}`) ?? null;
    const atual =
      a.metrica === "custo_resultado"
        ? (custos.get(a.alvo) ?? null)
        : a.metrica === "seguidores_yt"
          ? (inscritos.get(a.alvo) ?? null)
          : (ganhos.get(a.alvo) ?? null);

    // TETO: bom é ficar ABAIXO → desvio = meta − atual.
    // PISO: bom é ficar ACIMA  → desvio = atual − meta.
    // Nos dois casos, positivo = melhor que o planejado.
    const desvio =
      valor == null || atual == null
        ? null
        : a.direcao === "max"
          ? valor - atual
          : atual - valor;

    // --- régua (só acumulado: taxa não tem "total" com que confundir) ------ //
    const ehYt = a.metrica === "seguidores_yt";
    const baseline =
      a.tipo === "acumulado"
        ? {
            // O YouTube não entra em `atualAbsoluto`: o total público é
            // arredondado (o CPPEM marca "387.000" há semanas) e uma régua
            // arredondada convida ao mesmo erro que ela deveria evitar.
            atualAbsoluto: ehYt ? null : (totais.get(a.alvo) ?? null),
            mediaHistorica: (ehYt ? medias.yt : medias.ig).get(a.alvo) ?? null,
          }
        : undefined;

    // --- ritmo -------------------------------------------------------------- //
    const dias = ehYt ? diasYt : diasIg;
    const ritmo =
      a.tipo === "acumulado" && mesCorrente && valor != null
        ? {
            diasDecorridos: dias,
            diasNoMes,
            esperadoAteHoje: (valor * dias) / diasNoMes,
            projecao: atual != null ? (atual / dias) * diasNoMes : null,
            ultimaColeta: ehYt
              ? `${competencia}-${String(Math.min(diaHoje - ATRASO_YT_DIAS, diasNoMes)).padStart(2, "0")}`
              : hoje,
          }
        : undefined;

    return { ...a, valor, atual, desvio, regressao: (atual ?? 0) < 0, baseline, ritmo };
  });
}

export interface SalvarMetaInput {
  metrica: MetricaMeta;
  alvo: string;
  competencia: string;
  valor: number;
  direcao: DirecaoMeta;
}

/**
 * Cria ou atualiza a meta. Chave: (metrica, alvo, competencia) — a mesma do
 * índice único da 0036, para o upsert ser idempotente.
 *
 * A `direcao` vem de `alvosDeMeta()`, não do usuário: ela é propriedade da
 * métrica (custo é teto, seguidor é piso), e deixá-la editável só criaria linhas
 * com a cor invertida.
 */
export async function salvarMeta(input: SalvarMetaInput): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("mkt_metas").upsert(
    {
      metrica: input.metrica,
      alvo: input.alvo,
      competencia: input.competencia,
      valor: input.valor,
      direcao: input.direcao,
      ativo: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "metrica,alvo,competencia" },
  );
  if (error) throw new Error(`salvarMeta: ${error.message}`);
}

/** Remove a meta (volta ao estado "sem meta"). */
export async function removerMeta(
  metrica: MetricaMeta,
  alvo: string,
  competencia: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("mkt_metas")
    .delete()
    .eq("metrica", metrica)
    .eq("alvo", alvo)
    .eq("competencia", competencia);
  if (error) throw new Error(`removerMeta: ${error.message}`);
}
