import { Client } from "@notionhq/client";

import { createAdminClient } from "@/lib/supabase/admin";

type AnyRecord = Record<string, unknown>;
type NotionProp = AnyRecord & { type: string };
type NotionPage = {
  id: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, NotionProp>;
  parent?: { data_source_id?: string; database_id?: string };
};

export interface TaskRow {
  notion_page_id: string;
  title: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  due_date: string | null;
  assignees: string[];
  attribution: string[];
  okr: string | null;
  objetivo: string | null;
  url: string | null;
  last_edited_at: string | null;
}

export interface TaskSyncResult {
  dataSourceId: string | null;
  total: number;
  upserted: number;
  done: boolean;
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// --- extração de valores de propriedades -----------------------------------
function plain(rt: { plain_text: string }[] | undefined): string {
  return (rt ?? []).map((t) => t.plain_text).join("");
}

function propByType(
  props: Record<string, NotionProp>,
  type: string,
): NotionProp | undefined {
  return Object.values(props).find((p) => p.type === type);
}

/** Acha uma propriedade cujo NOME (normalizado) casa um dos apelidos. */
function propByName(
  props: Record<string, NotionProp>,
  aliases: string[],
): NotionProp | undefined {
  for (const [name, p] of Object.entries(props)) {
    const n = norm(name);
    if (aliases.some((a) => n.includes(a))) return p;
  }
  return undefined;
}

/**
 * Impressão digital do board de Tarefas: STATUS "Em andamento", PRIORIDADE
 * Eisenhower ("Importante e Urgente") e ATRIBUIÇÃO com 70/20/10. Evita confundir
 * com bancos parecidos (Plano de Ação, OKR's) que têm status/priorização próprios.
 */
function looksLikeTaskBoard(props: Record<string, NotionProp>): boolean {
  let hasAndamento = false;
  let hasEisenhower = false;
  let hasAtribuicao = false;
  for (const p of Object.values(props)) {
    const opts = ((p as AnyRecord)[p.type] as { options?: { name: string }[] })
      ?.options?.map((o) => norm(o.name)) ?? [];
    if (opts.some((o) => o.includes("em andamento"))) hasAndamento = true;
    if (opts.some((o) => o === "importante e urgente")) hasEisenhower = true;
    if (opts.some((o) => ["70%", "20%", "10%", "70", "20", "10"].includes(o)))
      hasAtribuicao = true;
  }
  return hasAndamento && hasEisenhower && hasAtribuicao;
}

/** Descobre o data_source_id do board de Tarefas (por impressão digital). */
async function discoverTaskDataSource(notion: Client): Promise<string | null> {
  let cursor: string | undefined;
  do {
    const res = await notion.search({
      filter: { property: "object", value: "data_source" },
      page_size: 100,
      start_cursor: cursor,
    });
    for (const ds of res.results) {
      const props = (ds as AnyRecord).properties as
        | Record<string, NotionProp>
        | undefined;
      if (props && looksLikeTaskBoard(props)) return (ds as { id: string }).id;
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return null;
}

/**
 * Carrega id→título de um data source inteiro (bancos de OKR/Objetivo são
 * pequenos). Usado para resolver as relations das tarefas sem uma chamada por
 * tarefa. Silencioso: se o banco não é acessível, devolve mapa vazio.
 */
async function loadTitleMap(
  notion: Client,
  dataSourceId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let cursor: string | undefined;
  try {
    do {
      const res = await notion.dataSources.query({
        data_source_id: dataSourceId,
        page_size: 100,
        start_cursor: cursor,
      });
      for (const page of res.results as NotionPage[]) {
        const titleProp = propByType(page.properties ?? {}, "title");
        map.set(page.id, plain((titleProp as AnyRecord)?.title as never));
      }
      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
    } while (cursor);
  } catch {
    /* banco inacessível — segue sem resolver aqueles nomes */
  }
  return map;
}

/** data_source_id alvo de uma relation (do schema do banco de tarefas). */
function relationTargets(taskSchema: Record<string, NotionProp>): {
  okrDs?: string;
  objetivoDs?: string;
} {
  const okr = propByName(taskSchema, ["okr"]);
  const objetivo = propByName(taskSchema, ["objetivo", "estrateg"]);
  const dsOf = (p?: NotionProp) =>
    ((p as AnyRecord)?.relation as { data_source_id?: string })?.data_source_id;
  return { okrDs: dsOf(okr), objetivoDs: dsOf(objetivo) };
}

/** Converte uma página (row) do board em TaskRow, resolvendo relations por mapa. */
function toTaskRow(
  page: NotionPage,
  titleMaps: { okr: Map<string, string>; objetivo: Map<string, string> },
): TaskRow {
  const props = page.properties ?? {};
  const titleProp = propByType(props, "title");
  const statusProp = propByType(props, "status");
  const peopleProp = propByType(props, "people");
  const dateProp = propByName(props, ["prazo"]) ?? propByType(props, "date");
  const descProp = propByName(props, ["descri"]);
  const priorityProp = propByName(props, ["prioridade"]);
  const attribProp = propByName(props, ["atribui"]);
  const okrProp = propByName(props, ["okr"]);
  const objetivoProp = propByName(props, ["objetivo", "estrateg"]);

  const resolveRelation = (p: NotionProp | undefined, map: Map<string, string>) =>
    (((p as AnyRecord)?.relation as { id: string }[]) ?? [])
      .map((r) => map.get(r.id))
      .filter((v): v is string => !!v);

  return {
    notion_page_id: page.id,
    title: plain((titleProp as AnyRecord)?.title as never),
    description: descProp
      ? plain((descProp as AnyRecord).rich_text as never) || null
      : null,
    status: (statusProp as AnyRecord)?.status
      ? ((statusProp as AnyRecord).status as { name?: string }).name ?? null
      : null,
    priority: (priorityProp as AnyRecord)?.select
      ? ((priorityProp as AnyRecord).select as { name?: string }).name ?? null
      : null,
    // Notion pode devolver data com hora ("...T13:00:00-03:00"); a coluna é date.
    due_date:
      ((((dateProp as AnyRecord)?.date as { start?: string })?.start ?? null)
        ?.slice(0, 10)) ?? null,
    assignees: (((peopleProp as AnyRecord)?.people as { name?: string }[]) ?? [])
      .map((u) => u.name?.trim())
      .filter((v): v is string => !!v),
    attribution: (
      ((attribProp as AnyRecord)?.multi_select as { name: string }[]) ?? []
    ).map((s) => s.name),
    okr: resolveRelation(okrProp, titleMaps.okr).join(", ") || null,
    objetivo: resolveRelation(objetivoProp, titleMaps.objetivo).join(", ") || null,
    url: page.url ?? null,
    last_edited_at: page.last_edited_time ?? null,
  };
}

/**
 * Sincroniza as tarefas do Notion para a tabela-espelho `tasks` (por empresa).
 * Incremental por `last_edited_time` (watermark): para na primeira row já coberta,
 * já que a query vem ordenada do mais novo para o mais antigo. As relations
 * (OKR/Objetivo) são resolvidas por mapas id→título carregados uma vez.
 */
export async function syncTasks(companyId: string): Promise<TaskSyncResult> {
  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("notion_connections")
    .select("access_token, tasks_data_source_id, tasks_watermark")
    .eq("company_id", companyId)
    .maybeSingle();
  if (!conn?.access_token)
    throw new Error("Notion não conectado para esta empresa.");

  const notion = new Client({ auth: conn.access_token });

  // Descobre (e memoriza) o banco de tarefas.
  let dataSourceId = conn.tasks_data_source_id as string | null;
  if (!dataSourceId) {
    dataSourceId = await discoverTaskDataSource(notion);
    if (!dataSourceId)
      return { dataSourceId: null, total: 0, upserted: 0, done: true };
    await admin
      .from("notion_connections")
      .update({ tasks_data_source_id: dataSourceId })
      .eq("company_id", companyId);
  }

  // Schema do banco (para achar os alvos das relations) e mapas id→título.
  const schema = await notion.dataSources.retrieve({
    data_source_id: dataSourceId,
  });
  const taskSchema =
    ((schema as AnyRecord).properties as Record<string, NotionProp>) ?? {};
  const { okrDs, objetivoDs } = relationTargets(taskSchema);
  const [okrMap, objetivoMap] = await Promise.all([
    okrDs ? loadTitleMap(notion, okrDs) : Promise.resolve(new Map<string, string>()),
    objetivoDs
      ? loadTitleMap(notion, objetivoDs)
      : Promise.resolve(new Map<string, string>()),
  ]);

  const watermark = conn.tasks_watermark
    ? new Date(conn.tasks_watermark as string).getTime()
    : null;

  // Varre as rows (mais novo → mais antigo), em lotes, parando no watermark.
  let cursor: string | undefined;
  let total = 0;
  let upserted = 0;
  let newestEdited: string | null = null;

  outer: do {
    const res = await notion.dataSources.query({
      data_source_id: dataSourceId,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      page_size: 100,
      start_cursor: cursor,
    });

    const batch: TaskRow[] = [];
    for (const page of res.results as NotionPage[]) {
      total++;
      const edited = page.last_edited_time ?? null;
      if (!newestEdited && edited) newestEdited = edited;
      // Incremental: cruzou o marco → o resto (mais antigo) já está sincronizado.
      if (watermark !== null && edited && new Date(edited).getTime() <= watermark)
        break outer;
      batch.push(toTaskRow(page, { okr: okrMap, objetivo: objetivoMap }));
    }

    if (batch.length) {
      const { error } = await admin
        .from("tasks")
        .upsert(
          batch.map((t) => ({ ...t, company_id: companyId, synced_at: new Date().toISOString() })),
          { onConflict: "company_id,notion_page_id" },
        );
      if (error) throw new Error(`upsert tasks: ${error.message}`);
      upserted += batch.length;
    }

    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);

  // Avança o watermark para o instante mais novo visto.
  await admin
    .from("notion_connections")
    .update({
      tasks_watermark: newestEdited ?? new Date().toISOString(),
      tasks_synced_at: new Date().toISOString(),
    })
    .eq("company_id", companyId);

  return { dataSourceId, total, upserted, done: true };
}

// Idade máxima do espelho antes de ressincronizar sozinho (15 min por padrão).
const TASKS_MAX_AGE_MS = Number(process.env.TASKS_MAX_AGE_MS ?? 15 * 60_000);

/**
 * Ressincroniza as tarefas SÓ se o espelho estiver velho (ou nunca sincronizado).
 * Feito para rodar em segundo plano (after()) num turno de chat — mantém as
 * tarefas frescas sem sync manual e sem bloquear a resposta. Silencioso em erro.
 */
export async function syncTasksIfStale(companyId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("notion_connections")
      .select("tasks_synced_at")
      .eq("company_id", companyId)
      .maybeSingle();
    const last = data?.tasks_synced_at
      ? new Date(data.tasks_synced_at as string).getTime()
      : 0;
    if (Date.now() - last < TASKS_MAX_AGE_MS) return; // ainda fresco
    await syncTasks(companyId);
  } catch (error) {
    console.error("[tasks] auto-sync falhou", error);
  }
}
