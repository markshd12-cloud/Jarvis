import crypto from "node:crypto";

import {
  Client,
  collectPaginatedAPI,
  isFullBlock,
  isFullDataSource,
  isFullPage,
  type SearchResponse,
} from "@notionhq/client";

import { chunkText } from "@/lib/ai/chunk";
import { embedTexts } from "@/lib/ai/embeddings";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
type AnyRecord = Record<string, unknown>;
type PageLike = AnyRecord & {
  id: string;
  url?: string;
  last_edited_time?: string;
};

// Orçamento de tempo por execução (o resto fica para a próxima rodada).
// Curto de propósito: o cliente chama em laço e mostra progresso a cada rodada,
// então a rodada precisa RETORNAR rápido para o usuário ver que está vivo.
const SYNC_BUDGET_MS = Number(process.env.NOTION_SYNC_BUDGET_MS ?? "90000");

// Quantas páginas processar em paralelo (embeddings + escrita). I/O-bound:
// paralelizar é o que tira os embeddings do caminho sequencial.
const SYNC_CONCURRENCY = Number(process.env.NOTION_SYNC_CONCURRENCY ?? "8");

export interface SyncResult {
  indexed: number;
  skipped: number;
  done: boolean;
}

function md5(text: string): string {
  return crypto.createHash("md5").update(text).digest("hex");
}

/** Compara duas datas pelo INSTANTE (evita falso-negativo entre ISO do Notion e timestamptz). */
function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && ta === tb;
}

function pageTitle(page: AnyRecord): string {
  const props = (page.properties ?? {}) as Record<
    string,
    { type?: string; title?: { plain_text: string }[] }
  >;
  for (const prop of Object.values(props)) {
    if (prop?.type === "title" && Array.isArray(prop.title)) {
      const text = prop.title.map((t) => t.plain_text).join("").trim();
      if (text) return text;
    }
  }
  return "Sem título";
}

/**
 * Converte data ISO do Notion ("2026-07-01" ou "2026-07-01T00:00:00.000-03:00")
 * para o formato que as pessoas digitam no chat ("01/07/2026"). Sem usar Date
 * (evita deslocamento de fuso) — só reordena os 3 primeiros grupos numéricos.
 */
function formatNotionDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Texto das PROPRIEDADES (essencial para linhas de banco de dados). */
function propertiesText(page: AnyRecord): string {
  const props = (page.properties ?? {}) as Record<string, AnyRecord & { type?: string }>;
  const parts: string[] = [];
  for (const [name, p] of Object.entries(props)) {
    let value = "";
    switch (p.type) {
      case "title":
      case "rich_text":
        value = ((p[p.type] as { plain_text: string }[]) ?? [])
          .map((t) => t.plain_text)
          .join("");
        break;
      case "select":
        value = (p.select as { name?: string })?.name ?? "";
        break;
      case "status":
        value = (p.status as { name?: string })?.name ?? "";
        break;
      case "multi_select":
        value = ((p.multi_select as { name: string }[]) ?? []).map((s) => s.name).join(", ");
        break;
      case "people":
        value = ((p.people as { name?: string }[]) ?? [])
          .map((x) => x.name)
          .filter(Boolean)
          .join(", ");
        break;
      case "date": {
        const d = p.date as { start?: string; end?: string } | null;
        if (d?.start) {
          value = formatNotionDate(d.start);
          if (d.end) value += ` a ${formatNotionDate(d.end)}`;
        }
        break;
      }
      case "url":
        value = (p.url as string) ?? "";
        break;
      case "email":
        value = (p.email as string) ?? "";
        break;
      case "phone_number":
        value = (p.phone_number as string) ?? "";
        break;
      case "number":
        value = p.number != null ? String(p.number) : "";
        break;
      case "checkbox":
        value = p.checkbox ? "sim" : "";
        break;
      default:
        value = "";
    }
    if (value) parts.push(`${name}: ${value}`);
  }
  return parts.join("\n");
}

// Profundidade máxima ao descer em blocos aninhados. Páginas "dashboard" do Notion
// escondem conteúdo em colunas/toggles/sub-blocos; como só ~4% das páginas leem
// blocos (o resto são linhas de banco), podemos descer bem mais fundo sem custo.
const MAX_BLOCK_DEPTH = 6;

function plainText(rich: { plain_text: string }[] | undefined): string {
  return Array.isArray(rich) ? rich.map((t) => t.plain_text).join("").trim() : "";
}

/**
 * Texto dos blocos. Ignora child_page/child_database (já vêm como páginas no search),
 * mas desce em colunas/toggles/callouts e extrai também CÉLULAS DE TABELA.
 */
async function readBlocks(notion: Client, blockId: string, depth = 0): Promise<string> {
  let blocks;
  try {
    blocks = await collectPaginatedAPI(notion.blocks.children.list, { block_id: blockId });
  } catch {
    return "";
  }

  const parts: string[] = [];
  for (const block of blocks) {
    if (!isFullBlock(block)) continue;
    const b = block as unknown as { type: string } & Record<
      string,
      { rich_text?: { plain_text: string }[]; cells?: { plain_text: string }[][] }
    >;
    if (b.type === "child_page" || b.type === "child_database") continue;

    // Blocos de texto (paragraph, headings, listas, toggle, quote, callout, to_do, code…).
    const text = plainText(b[b.type]?.rich_text);
    if (text) parts.push(text);

    // Linhas de tabela: o conteúdo está em `cells` (array de arrays de rich_text).
    const cells = b[b.type]?.cells;
    if (Array.isArray(cells)) {
      const row = cells.map((cell) => plainText(cell)).filter(Boolean).join(" | ");
      if (row) parts.push(row);
    }

    if (block.has_children && depth < MAX_BLOCK_DEPTH) {
      const nested = await readBlocks(notion, block.id, depth + 1);
      if (nested) parts.push(nested);
    }
  }
  return parts.join("\n");
}

/**
 * Linha de banco de dados? O conteúdo útil está nas PROPRIEDADES (já vêm no search).
 * Medição real: 100% das páginas eram linhas, 80% sem corpo, média de 33 chars no corpo.
 * Ler blocos delas é ~desperdício e é o que estoura o rate limit do Notion (~3 req/s).
 * Então só lemos blocos de páginas LIVRES (parent = page/workspace).
 */
function isDatabaseRow(page: AnyRecord): boolean {
  const t = (page.parent as { type?: string } | undefined)?.type;
  return t === "data_source_id" || t === "database_id";
}

/**
 * Muitos formulários do Notion guardam a data como TEXTO LIVRE digitado pela
 * pessoa (não como propriedade "date" estruturada) — ex.: um campo "Data"
 * comum, já em ISO ("2026-07-01"). Reformatar só o tipo "date" (ver
 * `formatNotionDate`) não pega esse caso. Aqui anotamos QUALQUER data em ISO
 * solta no texto com o equivalente BR ao lado, pra bater com o jeito que as
 * pessoas digitam no chat ("01/07").
 */
function annotateIsoDates(text: string): string {
  return text.replace(
    /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    (iso, y: string, mo: string, d: string) => `${iso} (${d}/${mo}/${y})`,
  );
}

/**
 * Extrai a data do relatório (campo "Data:") como 'AAAA-MM-DD' para a coluna
 * estruturada `documents.report_date`, permitindo filtro EXATO por data no
 * chat. Aceita o formato BR ("Data: 01/07/2026") e o ISO ("Data: 2026-07-01").
 */
function extractReportDate(text: string): string | null {
  const br = /Data:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (br) {
    const [, d, mo, y] = br;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const iso = /Data:\s*(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

async function buildPageText(notion: Client, page: PageLike): Promise<string> {
  const props = propertiesText(page);
  if (isDatabaseRow(page)) return annotateIsoDates(props); // sem nenhuma chamada extra ao Notion
  const body = await readBlocks(notion, page.id);
  return annotateIsoDates([props, body].filter(Boolean).join("\n"));
}

/** Executa `worker` sobre os itens com no máximo `limit` rodando em paralelo. */
async function mapPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      await worker(items[i++]);
    }
  });
  await Promise.all(runners);
}

async function indexPage(
  admin: AdminClient,
  companyId: string,
  page: { id: string; title: string; url?: string; lastEdited?: string; hash: string },
  text: string,
): Promise<number> {
  const nowIso = new Date().toISOString();
  const base = {
    company_id: companyId,
    source: "notion",
    external_id: page.id,
    title: page.title,
    url: page.url,
    last_edited_at: page.lastEdited,
    content_hash: page.hash,
    synced_at: nowIso,
    report_date: extractReportDate(text),
  };

  const chunks = chunkText(text);

  // Mesmo páginas vazias são registradas (com hash) para não reprocessar toda vez.
  const { data: doc } = await admin
    .from("documents")
    .upsert(base, { onConflict: "company_id,source,external_id" })
    .select("id")
    .single();
  if (!doc) return 0;

  await admin.from("document_chunks").delete().eq("document_id", doc.id);
  if (chunks.length === 0) return 0;

  // Prefixa o título em cada chunk antes do embedding: buscas pelo NOME da fonte
  // (ex.: "ICP CPPEM Concursos") casam mesmo quando o corpo não repete o termo.
  const titlePrefix = page.title ? `${page.title}\n\n` : "";
  const embeddings = await embedTexts(chunks.map((c) => titlePrefix + c.content));
  const rows = chunks.map((c, i) => ({
    document_id: doc.id,
    company_id: companyId,
    content: c.content,
    embedding: embeddings[i],
  }));
  await admin.from("document_chunks").insert(rows);

  return chunks.length;
}

type KnownEntry = { lastEdited: string | null; hash: string | null };
type KnownMap = Map<string, KnownEntry>;
type Candidate = { page: PageLike; prev: KnownEntry | undefined };

/** Estourou o orçamento de tempo desta rodada? */
function overBudget(start: number): boolean {
  return Date.now() - start > SYNC_BUDGET_MS;
}

/**
 * Descobre TODOS os data sources (bancos) acessíveis pela integração via search.
 * Search é confiável para descobrir BANCOS (são poucos); o que ele NÃO garante é
 * retornar todas as LINHAS de cada banco — por isso as linhas vêm depois, via
 * dataSources.query (exaustivo). Era exatamente essa lacuna que fazia relatórios
 * inteiros (ex.: de uma pessoa) sumirem do índice.
 */
async function discoverDataSourceIds(notion: Client): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.search({
      filter: { property: "object", value: "data_source" },
      page_size: 100,
      start_cursor: cursor,
    });
    for (const obj of res.results) {
      if (isFullDataSource(obj)) ids.push(obj.id);
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return ids;
}

/** Uma página de linhas de um data source (mais novo → mais antigo). */
function queryDataSourcePage(
  notion: Client,
  dataSourceId: string,
  cursor?: string,
) {
  return notion.dataSources.query({
    data_source_id: dataSourceId,
    sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    page_size: 100,
    start_cursor: cursor,
  });
}

/**
 * Triagem barata de uma leva de resultados: separa o que precisa (re)indexar,
 * conta os inalterados, respeita o marco (watermark) e devolve o last_edited
 * mais novo em escopo. Ordenado desc → ao cruzar o marco, o resto já está coberto.
 */
function triage(
  results: SearchResponse["results"],
  opts: { watermark: number | null; skipDatabaseRows: boolean; known: KnownMap },
): {
  candidates: Candidate[];
  skipped: number;
  reachedCovered: boolean;
  newest: string | null;
} {
  const candidates: Candidate[] = [];
  let skipped = 0;
  let reachedCovered = false;
  let newest: string | null = null;

  for (const obj of results) {
    if (!isFullPage(obj)) continue;
    const page = obj as unknown as PageLike;
    // Linhas de banco já são cobertas pela fase de data sources.
    if (opts.skipDatabaseRows && isDatabaseRow(page)) continue;

    // Incremental: cruzou o marco → tudo daqui pra baixo (mais antigo) já foi sincronizado.
    if (
      opts.watermark !== null &&
      page.last_edited_time &&
      new Date(page.last_edited_time).getTime() <= opts.watermark
    ) {
      reachedCovered = true;
      break;
    }

    if (
      page.last_edited_time &&
      (!newest || new Date(page.last_edited_time) > new Date(newest))
    ) {
      newest = page.last_edited_time;
    }

    const prev = opts.known.get(page.id);
    // Inalterado (mesmo instante) → pula sem nenhuma chamada extra.
    if (prev && sameInstant(prev.lastEdited, page.last_edited_time)) {
      skipped++;
      continue;
    }
    candidates.push({ page, prev });
  }

  return { candidates, skipped, reachedCovered, newest };
}

/**
 * Trabalho pesado da leva (texto + embeddings + escrita), em paralelo. Cada
 * worker devolve seu próprio resultado e a soma é feita ao final — sem corrida
 * de contadores compartilhados entre tarefas concorrentes.
 */
async function processCandidates(
  admin: AdminClient,
  companyId: string,
  notion: Client,
  candidates: Candidate[],
): Promise<{ indexed: number; skipped: number }> {
  const outcomes: { indexedChunks: number; unchanged: boolean }[] = [];

  await mapPool(candidates, SYNC_CONCURRENCY, async ({ page, prev }) => {
    try {
      const text = await buildPageText(notion, page);
      const hash = md5(text);

      // Conteúdo idêntico (só metadados mudaram) → atualiza data, não re-embeda.
      if (prev && prev.hash === hash) {
        await admin
          .from("documents")
          .update({
            last_edited_at: page.last_edited_time,
            synced_at: new Date().toISOString(),
          })
          .eq("company_id", companyId)
          .eq("source", "notion")
          .eq("external_id", page.id);
        outcomes.push({ indexedChunks: 0, unchanged: true });
        return;
      }

      const chunks = await indexPage(
        admin,
        companyId,
        {
          id: page.id,
          title: pageTitle(page),
          url: page.url,
          lastEdited: page.last_edited_time,
          hash,
        },
        text,
      );
      outcomes.push({ indexedChunks: chunks, unchanged: false });
    } catch (error) {
      console.error("[notion] falha ao indexar página", page.id, error);
      outcomes.push({ indexedChunks: 0, unchanged: false });
    }
  });

  let indexed = 0;
  let skipped = 0;
  for (const o of outcomes) {
    indexed += o.indexedChunks;
    if (o.unchanged) skipped++;
  }
  return { indexed, skipped };
}

/**
 * Estado resumível de uma rodada (guardado em notion_connections.sync_cursor).
 * Compartilhado pela carga inicial (`runBackfill`) e pelo incremental
 * (`runIncremental`): ambos têm DUAS fases — primeiro varre as linhas dos bancos
 * (`datasources`), depois as páginas livres (`pages`). Como o watermark só fica
 * não-nulo DEPOIS que o backfill completa e zera o cursor, um cursor presente com
 * watermark não-nulo é, sem ambiguidade, estado do incremental.
 */
interface BackfillState {
  stage: "datasources" | "pages";
  dsQueue?: string[]; // data sources ainda por processar (fase datasources)
  dsCursor?: string; // cursor dentro do data source atual (dsQueue[0])
  pagesCursor?: string; // cursor da busca de páginas livres (fase pages)
  pendingWatermark?: string; // last_edited mais novo já visto
}

function parseBackfill(raw: string | null): BackfillState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as BackfillState;
    // Formato antigo (sem `stage`) → null: recomeça a carga (idempotente).
    if (v && typeof v === "object" && (v.stage === "datasources" || v.stage === "pages")) {
      return v;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * CARGA INICIAL, resumível em duas fases:
 * 1) `datasources`: enumera TODAS as linhas de TODOS os bancos (dataSources.query
 *    é exaustivo — resolve a lacuna do search, que perdia linhas).
 * 2) `pages`: páginas LIVRES (não-linhas de banco), descobertas por search.
 * A cada rodada respeita o orçamento e salva a posição para retomar sem redo.
 */
async function runBackfill(
  admin: AdminClient,
  companyId: string,
  notion: Client,
  known: KnownMap,
  start: number,
  state: BackfillState | null,
): Promise<SyncResult> {
  let indexed = 0;
  let skipped = 0;
  let timedOut = false;
  let newest: string | null = state?.pendingWatermark ?? null;
  const track = (n: string | null) => {
    if (n && (!newest || new Date(n) > new Date(newest))) newest = n;
  };
  const fold = (r: { indexed: number; skipped: number }) => {
    indexed += r.indexed;
    skipped += r.skipped;
  };

  let stage: "datasources" | "pages" = state?.stage ?? "datasources";
  let dsQueue = state?.dsQueue ?? [];
  let dsCursor = state?.dsCursor;
  let pagesCursor = state?.pagesCursor;

  // Carga nova: descobre todos os bancos uma vez (a lista fica fixa até o fim).
  if (!state) {
    dsQueue = await discoverDataSourceIds(notion);
    stage = "datasources";
    dsCursor = undefined;
  }

  // Fase 1 — linhas de bancos (exaustivo).
  if (stage === "datasources") {
    while (dsQueue.length > 0) {
      if (overBudget(start)) {
        timedOut = true;
        break;
      }
      const dsId = dsQueue[0];
      try {
        const res = await queryDataSourcePage(notion, dsId, dsCursor);
        const t = triage(res.results, {
          watermark: null,
          skipDatabaseRows: false,
          known,
        });
        track(t.newest);
        skipped += t.skipped;
        fold(await processCandidates(admin, companyId, notion, t.candidates));
        if (res.has_more && res.next_cursor) {
          dsCursor = res.next_cursor;
        } else {
          dsQueue = dsQueue.slice(1); // este banco terminou
          dsCursor = undefined;
        }
      } catch (error) {
        // Um banco problemático não pode travar a carga inteira.
        console.error("[notion] falha ao consultar data source", dsId, error);
        dsQueue = dsQueue.slice(1);
        dsCursor = undefined;
      }
    }
    if (!timedOut && dsQueue.length === 0) {
      stage = "pages";
      pagesCursor = undefined;
    }
  }

  // Fase 2 — páginas livres (não-linhas de banco).
  if (!timedOut && stage === "pages") {
    for (;;) {
      if (overBudget(start)) {
        timedOut = true;
        break;
      }
      const res = await notion.search({
        sort: { timestamp: "last_edited_time", direction: "descending" },
        filter: { property: "object", value: "page" },
        page_size: 100,
        start_cursor: pagesCursor,
      });
      const t = triage(res.results, {
        watermark: null,
        skipDatabaseRows: true,
        known,
      });
      track(t.newest);
      skipped += t.skipped;
      fold(await processCandidates(admin, companyId, notion, t.candidates));
      pagesCursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
      if (!pagesCursor) break;
    }
  }

  const done = !timedOut && stage === "pages" && !pagesCursor;

  const update: Record<string, string | null> = {
    last_synced_at: new Date().toISOString(),
  };
  if (done) {
    if (newest) update.last_edited_watermark = newest;
    update.sync_cursor = null; // vira incremental
  } else {
    update.sync_cursor = JSON.stringify({
      stage,
      dsQueue: stage === "datasources" ? dsQueue : undefined,
      dsCursor: stage === "datasources" ? dsCursor : undefined,
      pagesCursor: stage === "pages" ? pagesCursor : undefined,
      pendingWatermark: newest ?? undefined,
    } satisfies BackfillState);
  }
  await admin
    .from("notion_connections")
    .update(update)
    .eq("company_id", companyId);

  return { indexed, skipped, done };
}

/**
 * INCREMENTAL (com watermark): varre os bancos do mais novo até cruzar o marco;
 * depois as páginas livres. Só toca no que mudou — rápido e idempotente.
 *
 * RESUMÍVEL: um ciclo pode não caber num orçamento (ex.: muitos dias de atraso).
 * Antes, ao estourar o tempo a rodada DESCARTAVA o progresso e recomeçava do topo
 * — os primeiros bancos eram reprocessados e os últimos (ex.: "Atividades
 * Diárias") passavam fome e nunca eram alcançados, congelando o watermark. Agora,
 * ao estourar, salva a fila de bancos restantes + cursores em `sync_cursor`
 * (mesmo mecanismo do backfill) e a próxima rodada CONTINUA de onde parou. O marco
 * só avança quando o ciclo inteiro termina — então a leitura fica consistente.
 */
async function runIncremental(
  admin: AdminClient,
  companyId: string,
  notion: Client,
  known: KnownMap,
  start: number,
  watermark: number,
  state: BackfillState | null,
): Promise<SyncResult> {
  let indexed = 0;
  let skipped = 0;
  let timedOut = false;
  let newest: string | null = state?.pendingWatermark ?? null;
  const track = (n: string | null) => {
    if (n && (!newest || new Date(n) > new Date(newest))) newest = n;
  };
  const fold = (r: { indexed: number; skipped: number }) => {
    indexed += r.indexed;
    skipped += r.skipped;
  };

  let stage: "datasources" | "pages" = state?.stage ?? "datasources";
  let dsQueue = state?.dsQueue ?? [];
  let dsCursor = state?.dsCursor;
  let pagesCursor = state?.pagesCursor;

  // Ciclo novo (sem cursor pendente): lista os bancos uma vez. Enquanto o ciclo
  // não terminar, a fila é retomada do `sync_cursor` (não redescobre do zero).
  if (!state) {
    dsQueue = await discoverDataSourceIds(notion);
    stage = "datasources";
    dsCursor = undefined;
  }

  // Fase 1 — bancos: cada um varrido do topo até cruzar o marco.
  if (stage === "datasources") {
    while (dsQueue.length > 0) {
      if (overBudget(start)) {
        timedOut = true;
        break;
      }
      const dsId = dsQueue[0];
      try {
        const res = await queryDataSourcePage(notion, dsId, dsCursor);
        const t = triage(res.results, {
          watermark,
          skipDatabaseRows: false,
          known,
        });
        track(t.newest);
        skipped += t.skipped;
        fold(await processCandidates(admin, companyId, notion, t.candidates));
        // Cruzou o marco OU acabou o banco → resto já coberto, vai pro próximo.
        if (t.reachedCovered || !res.has_more || !res.next_cursor) {
          dsQueue = dsQueue.slice(1);
          dsCursor = undefined;
        } else {
          dsCursor = res.next_cursor;
        }
      } catch (error) {
        console.error("[notion] falha ao consultar data source", dsId, error);
        dsQueue = dsQueue.slice(1); // pula este banco nesta rodada
        dsCursor = undefined;
      }
    }
    if (!timedOut && dsQueue.length === 0) {
      stage = "pages";
      pagesCursor = undefined;
    }
  }

  // Fase 2 — páginas livres.
  if (!timedOut && stage === "pages") {
    for (;;) {
      if (overBudget(start)) {
        timedOut = true;
        break;
      }
      const res = await notion.search({
        sort: { timestamp: "last_edited_time", direction: "descending" },
        filter: { property: "object", value: "page" },
        page_size: 100,
        start_cursor: pagesCursor,
      });
      const t = triage(res.results, {
        watermark,
        skipDatabaseRows: true,
        known,
      });
      track(t.newest);
      skipped += t.skipped;
      fold(await processCandidates(admin, companyId, notion, t.candidates));
      if (t.reachedCovered) {
        pagesCursor = undefined; // cruzou o marco → páginas livres cobertas
        break;
      }
      pagesCursor = res.has_more ? (res.next_cursor ?? undefined) : undefined;
      if (!pagesCursor) break;
    }
  }

  const done = !timedOut && stage === "pages" && !pagesCursor;
  const update: Record<string, string | null> = {
    last_synced_at: new Date().toISOString(),
  };
  if (done) {
    if (newest) update.last_edited_watermark = newest;
    update.sync_cursor = null; // ciclo completo → limpa a retomada
  } else {
    update.sync_cursor = JSON.stringify({
      stage,
      dsQueue: stage === "datasources" ? dsQueue : undefined,
      dsCursor: stage === "datasources" ? dsCursor : undefined,
      pagesCursor: stage === "pages" ? pagesCursor : undefined,
      pendingWatermark: newest ?? undefined,
    } satisfies BackfillState);
  }
  await admin
    .from("notion_connections")
    .update(update)
    .eq("company_id", companyId);

  return { indexed, skipped, done };
}

/**
 * Sincroniza o Notion — CARGA INICIAL resumível ou INCREMENTAL, escolhido pelo
 * watermark. As linhas de banco vêm de dataSources.query (exaustivo, ao contrário
 * do search); páginas livres vêm do search. Em ambos: pula inalterados pelo
 * instante e evita re-embedding quando o conteúdo é idêntico (content_hash).
 */
export async function syncNotion(companyId: string): Promise<SyncResult> {
  const start = Date.now();
  const admin = createAdminClient();

  const { data: conn } = await admin
    .from("notion_connections")
    .select("access_token, last_edited_watermark, sync_cursor")
    .eq("company_id", companyId)
    .maybeSingle();
  if (!conn?.access_token) {
    throw new Error("Notion não conectado para esta empresa.");
  }
  const notion = new Client({ auth: conn.access_token });

  // Marco: após a carga inicial completa, tudo com last_edited <= watermark já está coberto.
  const watermark = conn.last_edited_watermark
    ? new Date(conn.last_edited_watermark).getTime()
    : null;

  // Estado conhecido (uma query): external_id -> { last_edited_at, content_hash }.
  const { data: existing } = await admin
    .from("documents")
    .select("external_id, last_edited_at, content_hash")
    .eq("company_id", companyId)
    .eq("source", "notion");
  const known: KnownMap = new Map(
    (existing ?? []).map((d) => [
      d.external_id as string,
      {
        lastEdited: d.last_edited_at as string | null,
        hash: d.content_hash as string | null,
      },
    ]),
  );

  const resume = parseBackfill(conn.sync_cursor);
  return watermark === null
    ? runBackfill(admin, companyId, notion, known, start, resume)
    : runIncremental(admin, companyId, notion, known, start, watermark, resume);
}
