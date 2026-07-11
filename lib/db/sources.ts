import crypto from "node:crypto";

import { chunkText } from "@/lib/ai/chunk";
import { embedTexts } from "@/lib/ai/embeddings";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

// Fontes manuais vivem em documents/document_chunks com esta origem — assim entram
// no mesmo RAG híbrido (searchKnowledge) junto do Notion, sem código novo de busca.
const SOURCE = "manual";

export interface SourceCompany {
  id: string;
  name: string;
}

export interface ManualSource {
  id: string; // external_id (uuid gerado por nós)
  title: string;
  content: string;
  updatedAt: string | null;
  /** Fonte pessoal ("única") — só o autor vê. */
  personal: boolean;
  ownerId: string | null;
  /** Empresas vinculadas (vazio quando pessoal). */
  companyIds: string[];
  companies: SourceCompany[]; // com nomes, para exibir
}

/** Destino de gravação — pessoal (owner) OU um conjunto de empresas. */
export interface SourceTarget {
  ownerId: string | null; // preenchido => pessoal
  companyIds: string[]; // vazio quando pessoal
}

function md5(text: string): string {
  return crypto.createHash("md5").update(text).digest("hex");
}

/** Quem está lendo a lista — decide o recorte por escopo. */
export interface SourceViewer {
  userId: string;
  companyId: string | null;
  isSuperadmin: boolean;
}

/**
 * Lista as fontes manuais que o usuário PODE gerenciar (mais recentes primeiro).
 * - Comum: as das empresas dele (via vínculo) + as suas pessoais.
 * - Superadmin: todas as de empresa (de qualquer empresa) + as suas pessoais
 *   (não as pessoais de outros — "única" é privada).
 * Usa service_role, então o recorte é feito aqui (não pela RLS).
 */
export async function listManualSources(viewer: SourceViewer): Promise<ManualSource[]> {
  const admin = createAdminClient();
  const { data: docs } = await admin
    .from("documents")
    .select("id, external_id, title, content, synced_at, owner_id")
    .eq("source", SOURCE)
    .order("synced_at", { ascending: false });
  const rows = docs ?? [];
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id as string);
  const { data: links } = await admin
    .from("document_companies")
    .select("document_id, company_id")
    .in("document_id", ids);

  const companyIdsByDoc = new Map<string, string[]>();
  for (const l of links ?? []) {
    const arr = companyIdsByDoc.get(l.document_id as string) ?? [];
    arr.push(l.company_id as string);
    companyIdsByDoc.set(l.document_id as string, arr);
  }

  // Nomes das empresas vinculadas (para exibir).
  const allCompanyIds = [
    ...new Set((links ?? []).map((l) => l.company_id as string)),
  ];
  const names = new Map<string, string>();
  if (allCompanyIds.length) {
    const { data: comps } = await admin
      .from("companies")
      .select("id, name")
      .in("id", allCompanyIds);
    for (const c of comps ?? []) names.set(c.id as string, c.name as string);
  }

  const out: ManualSource[] = [];
  for (const r of rows) {
    const ownerId = (r.owner_id as string | null) ?? null;
    const companyIds = companyIdsByDoc.get(r.id as string) ?? [];
    const personal = ownerId !== null;

    // Recorte de gestão.
    if (personal) {
      if (ownerId !== viewer.userId) continue; // pessoal de outro: oculto
    } else if (!viewer.isSuperadmin) {
      if (!viewer.companyId || !companyIds.includes(viewer.companyId)) continue;
    }

    out.push({
      id: r.external_id as string,
      title: (r.title as string | null) ?? "",
      content: (r.content as string | null) ?? "",
      updatedAt: r.synced_at as string | null,
      personal,
      ownerId,
      companyIds,
      companies: companyIds.map((id) => ({ id, name: names.get(id) ?? "—" })),
    });
  }
  return out;
}

/** Escopo atual de uma fonte (para autorizar edição/exclusão). Null se não existe. */
export async function getManualSourceTarget(
  externalId: string,
): Promise<SourceTarget | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("documents")
    .select("id, owner_id")
    .eq("source", SOURCE)
    .eq("external_id", externalId)
    .maybeSingle();
  if (!data) return null;

  const { data: links } = await admin
    .from("document_companies")
    .select("company_id")
    .eq("document_id", data.id as string);

  return {
    ownerId: (data.owner_id as string | null) ?? null,
    companyIds: (links ?? []).map((l) => l.company_id as string),
  };
}

/** Re-grava os vínculos de empresa de um documento (apaga os antigos, insere os novos). */
async function setCompanyLinks(
  admin: AdminClient,
  documentId: string,
  companyIds: string[],
): Promise<void> {
  await admin.from("document_companies").delete().eq("document_id", documentId);
  if (companyIds.length === 0) return;
  await admin.from("document_companies").insert(
    companyIds.map((company_id) => ({ document_id: documentId, company_id })),
  );
}

/** Re-gera os chunks/embeddings de um documento (apaga os antigos e insere os novos). */
async function reindexChunks(
  admin: AdminClient,
  ownerId: string | null,
  documentId: string,
  title: string,
  content: string,
): Promise<void> {
  await admin.from("document_chunks").delete().eq("document_id", documentId);

  const chunks = chunkText(content);
  if (chunks.length === 0) return;

  // Prefixa o título no embedding (buscas pelo NOME da fonte casam melhor).
  const prefix = title ? `${title}\n\n` : "";
  const embeddings = await embedTexts(chunks.map((c) => prefix + c.content));
  // company_id fica NULL nas fontes manuais — a visibilidade vem do vínculo
  // (document_companies) ou do owner_id (pessoal).
  const rows = chunks.map((c, i) => ({
    document_id: documentId,
    company_id: null,
    owner_id: ownerId,
    content: c.content,
    embedding: embeddings[i],
  }));
  await admin.from("document_chunks").insert(rows);
}

/** Cria uma nova fonte manual no escopo pedido e a indexa. */
export async function createManualSource(
  target: SourceTarget,
  title: string,
  content: string,
): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: doc, error } = await admin
    .from("documents")
    .insert({
      company_id: null,
      owner_id: target.ownerId,
      source: SOURCE,
      external_id: crypto.randomUUID(),
      title,
      content,
      content_hash: md5(content),
      last_edited_at: now,
      synced_at: now,
    })
    .select("id")
    .single();
  if (error || !doc) throw new Error(error?.message ?? "Falha ao criar fonte.");

  await setCompanyLinks(admin, doc.id, target.ownerId ? [] : target.companyIds);
  await reindexChunks(admin, target.ownerId, doc.id, title, content);
}

/** Atualiza conteúdo E escopo de uma fonte manual existente e re-indexa. */
export async function updateManualSource(
  externalId: string,
  target: SourceTarget,
  title: string,
  content: string,
): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: doc, error } = await admin
    .from("documents")
    .update({
      company_id: null,
      owner_id: target.ownerId,
      title,
      content,
      content_hash: md5(content),
      last_edited_at: now,
      synced_at: now,
    })
    .eq("source", SOURCE)
    .eq("external_id", externalId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!doc) throw new Error("Fonte não encontrada.");

  await setCompanyLinks(admin, doc.id, target.ownerId ? [] : target.companyIds);
  await reindexChunks(admin, target.ownerId, doc.id, title, content);
}

/** Exclui uma fonte manual (chunks e vínculos somem em cascata pela FK). */
export async function deleteManualSource(externalId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("documents")
    .delete()
    .eq("source", SOURCE)
    .eq("external_id", externalId);
}
