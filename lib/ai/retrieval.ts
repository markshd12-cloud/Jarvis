import { embedText } from "@/lib/ai/embeddings";
import { createClient } from "@/lib/supabase/server";

export type MemoryHit = { content: string; kind: string; similarity: number };
export type DocHit = { id: string; content: string; title: string | null; url: string | null; score: number };

type RawHit = {
  document_id: string;
  content: string;
  title: string | null;
  url: string | null;
  score: number;
};

// Pega vários candidatos por chunk, mas entrega poucos DOCUMENTOS (agrupados).
const DOC_CANDIDATES = 15; // chunks buscados no híbrido
const DOC_COUNT = 5; // documentos distintos entregues
const FULL_MAX = 9000; // fonte manual até este tamanho entra INTEIRA
const PER_DOC_CHARS = 9000; // teto do texto por documento injetado

/**
 * Busca conhecimento relevante (memórias evolutivas + documentos do Notion/fontes
 * manuais) com UM único embedding da consulta. RLS garante o escopo por empresa.
 *
 * Documentos usam busca HÍBRIDA (lexical em PT + vetorial, fundidos por RRF) e
 * depois são AGRUPADOS por documento: em vez de devolver fragmentos soltos de
 * vários docs (que confundem o modelo entre fontes parecidas), devolvemos poucos
 * DOCUMENTOS — e as fontes manuais curtas entram INTEIRAS, com o texto coerente.
 * Memórias seguem só-vetorial (poucas, fatos destilados).
 */
export async function searchKnowledge(
  query: string,
  {
    count = 8,
    memThreshold = 0.4,
  }: { count?: number; memThreshold?: number } = {},
): Promise<{ memories: MemoryHit[]; documents: DocHit[] }> {
  if (!query.trim()) return { memories: [], documents: [] };

  const embedding = await embedText(query, "RETRIEVAL_QUERY");
  const supabase = await createClient();

  const [mem, doc] = await Promise.all([
    supabase.rpc("match_memories", {
      query_embedding: embedding,
      match_threshold: memThreshold,
      match_count: count,
    }),
    supabase.rpc("hybrid_search_documents", {
      query_text: query,
      query_embedding: embedding,
      match_count: DOC_CANDIDATES,
    }),
  ]);

  const hits = (doc.data ?? []) as RawHit[];

  // Agrupa por documento, preservando a ordem do melhor chunk de cada um.
  const order: string[] = [];
  const best = new Map<string, RawHit>();
  const chunksByDoc = new Map<string, string[]>();
  for (const h of hits) {
    if (!best.has(h.document_id)) {
      best.set(h.document_id, h);
      order.push(h.document_id);
    }
    const arr = chunksByDoc.get(h.document_id) ?? [];
    arr.push(h.content);
    chunksByDoc.set(h.document_id, arr);
  }
  const topDocIds = order.slice(0, DOC_COUNT);

  // Conteúdo bruto completo (fontes manuais têm documents.content preenchido).
  const fullById = new Map<string, string>();
  if (topDocIds.length) {
    const { data: rows } = await supabase
      .from("documents")
      .select("id, content")
      .in("id", topDocIds);
    for (const r of rows ?? []) {
      const c = r.content as string | null;
      if (c) fullById.set(r.id as string, c);
    }
  }

  const documents: DocHit[] = topDocIds.map((id) => {
    const h = best.get(id)!;
    const full = fullById.get(id);
    // Fonte manual curta → texto inteiro (coerente). Senão, junta os chunks achados.
    const text =
      full && full.length <= FULL_MAX
        ? full
        : (chunksByDoc.get(id) ?? []).join("\n…\n");
    return {
      id,
      content: text.slice(0, PER_DOC_CHARS),
      title: h.title,
      url: h.url,
      score: h.score,
    };
  });

  return {
    memories: (mem.data ?? []) as MemoryHit[],
    documents,
  };
}

// Score sentinela: matches por DATA EXATA têm prioridade sobre a busca difusa.
const EXACT_DATE_SCORE = 1000;
const DATE_PER_DOC_CHARS = 2500; // relatórios são curtos; cabe o inteiro
const DATE_MAX_DOCS = 40; // teto do fan-out (ex.: intervalo × várias pessoas)

/** Palavras (Unicode, com acento) de 2+ letras, minúsculas. */
function nameTokens(s: string): string[] {
  return (s.toLowerCase().match(/\p{L}+/gu) ?? []).filter((t) => t.length >= 2);
}

/**
 * O título se refere à pessoa pedida? Compara por CONJUNTO DE PALAVRAS: casa se
 * o nome pedido ⊆ título (ex.: "Maria Clara" em "Maria Clara Maciel...") ou se o
 * título ⊆ nome pedido (ex.: título "Giovana" quando se pede "Giovana Mirela").
 * Como compara palavras inteiras, "Mark" casa "Mark"/"Mark | Tecnologia" mas
 * nunca "Marketing".
 */
function titleMatchesName(title: string, name: string): boolean {
  const t = nameTokens(title);
  const n = nameTokens(name);
  if (!t.length || !n.length) return false;
  const tset = new Set(t);
  const nset = new Set(n);
  return n.every((tok) => tset.has(tok)) || t.every((tok) => nset.has(tok));
}

/**
 * Busca documentos do Notion por DATA EXATA (coluna estruturada report_date),
 * opcionalmente filtrando por nome (palavra inteira no título). É o caminho
 * preciso para pedidos do tipo "relatório do dia 01/07 de Maria Clara" — imune
 * à tokenização de datas e à diluição entre milhares de documentos quase-iguais.
 */
export async function searchDocumentsByDate(
  isoDates: string[],
  nameFilter: string | null,
): Promise<DocHit[]> {
  if (!isoDates.length) return [];

  const supabase = await createClient();

  const { data: allDocs } = await supabase
    .from("documents")
    .select("id, title, url")
    .eq("source", "notion")
    .in("report_date", isoDates)
    .limit(DATE_MAX_DOCS);
  if (!allDocs?.length) return [];

  // Filtro de nome por conjunto de palavras (evita "Mark" casar "Marketing").
  const docs = nameFilter
    ? allDocs.filter((d) => titleMatchesName((d.title as string | null) ?? "", nameFilter))
    : allDocs;
  if (!docs.length) return [];

  const ids = docs.map((d) => d.id as string);
  const { data: chunkRows } = await supabase
    .from("document_chunks")
    .select("document_id, content")
    .in("document_id", ids);

  const chunksByDoc = new Map<string, string[]>();
  for (const r of chunkRows ?? []) {
    const arr = chunksByDoc.get(r.document_id as string) ?? [];
    arr.push(r.content as string);
    chunksByDoc.set(r.document_id as string, arr);
  }

  return docs.map((d) => ({
    id: d.id as string,
    title: (d.title as string | null) ?? null,
    url: (d.url as string | null) ?? null,
    content: (chunksByDoc.get(d.id as string) ?? [])
      .join("\n")
      .slice(0, DATE_PER_DOC_CHARS),
    score: EXACT_DATE_SCORE,
  }));
}
