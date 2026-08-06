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
    unidade: "brl" as const,
  }));

  const seguidores: AlvoMeta[] = MARKETING_AD_ACCOUNTS.flatMap((b) =>
    b.instagram.map((accountId) => ({
      metrica: "seguidores_ig" as const,
      alvo: accountId,
      rotulo: b.label,
      detalhe: handles.get(accountId) ? `@${handles.get(accountId)}` : accountId,
      direcao: "min" as const, // piso: ganhar mais seguidores é melhor
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
 * Mede do ÚLTIMO snapshot ANTERIOR à competência até o último dentro dela — e
 * não do primeiro ao último do mês, que perderia o crescimento ocorrido entre a
 * virada e o primeiro snapshot. Sem snapshot anterior (a série começa em
 * 15/06/2026), cai para o primeiro do mês e o número fica parcial.
 */
async function ganhoSeguidores(competencia: string): Promise<Map<string, number | null>> {
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
export async function getMetasComAtual(competencia: string): Promise<MetaComAtual[]> {
  const [handles, cadastradas, custos, ganhos, inscritos] = await Promise.all([
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
  ]);

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

    return { ...a, valor, atual, desvio, regressao: (atual ?? 0) < 0 };
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
