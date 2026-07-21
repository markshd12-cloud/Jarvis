/**
 * Seed / import do Conta Azul (Passo 2 do sistema financeiro) — popula as
 * DIMENSÕES espelhando o CA, para o DRE bater e resolver a BU da receita.
 *
 * Idempotente: tudo é upsert por chave natural (`slug`, `ca_centro_id`,
 * `ca_categoria_id`). Rodar 2× não duplica. Server-only (service_role) — importa
 * pela app, reusando o token válido em memória (single-flight); nunca curl solto
 * (renovar token fora da app pode rotacionar o refresh_token e derrubar produção).
 *
 * Fontes e o que cada uma resolve:
 * - `/categorias`      → master de categorias (id, nome, categoria_pai, tipo).
 * - `/financeiro/categorias-dre` → grupo_dre (01…08) de cada categoria financeira.
 * - `/centro-de-custo` → centros de custo.
 *
 * O que o CA NÃO tem e fica pra revisão manual (sem chutar):
 * - BU: resolvida por keyword no nome (CPPEM/COLÉGIO/UNICIVE); ambíguos → null.
 * - natureza (fixa/variável): não existe no CA → null (preenchido na aba Cadastros).
 */
import "server-only";

import { caGet } from "@/lib/contaazul/client";
import { CONTA_AZUL_RESOURCES } from "@/lib/contaazul/config";
import { createAdminClient } from "@/lib/supabase/admin";

// ------------------------------ Tipos do CA -------------------------------- //

interface CaCategoria {
  id: string;
  nome: string;
  categoria_pai: string | null;
  tipo: string | null; // "RECEITA" | "DESPESA" | ... (caixa alta)
}
interface CaCentro {
  id: string;
  codigo: string | null;
  nome: string;
  ativo: boolean;
}
interface CaDreLeaf {
  id: string;
}
interface CaDreItem {
  codigo: string | null;
  indica_totalizador: boolean;
  subitens: CaDreItem[];
  categorias_financeiras: CaDreLeaf[];
}
interface Envelope<T> {
  itens?: T[];
}

// ------------------------------- Tipos nossos ------------------------------ //

type FinTipo = "receita" | "deducao" | "custo" | "despesa" | "imposto" | "financeira";
type BuSlug = "cppem" | "colegio" | "unicive" | "geral";

export interface SeedReport {
  bus: number;
  centros: number;
  categorias: number;
  /** Receitas sem unidade no nome → caíram na BU "Geral" (reatribuíveis na UI). */
  receitasGeral: { codigo: string | null; nome: string }[];
  /** Categorias sem grupo DRE (não estão na árvore do DRE). */
  semGrupo: { codigo: string | null; nome: string }[];
  /** Categorias cujo `categoria_pai` não foi encontrado no import. */
  parentNaoResolvido: number;
}

// ------------------------------- Normalizadores ---------------------------- //

/** tipo do CA (caixa alta, conjunto não garantido) → nosso enum fechado. */
function normTipo(raw: string | null): FinTipo {
  const t = (raw ?? "").toUpperCase();
  if (t.includes("RECEIT")) return "receita";
  if (t.includes("DEDU")) return "deducao";
  if (t.includes("CUSTO")) return "custo";
  if (t.includes("IMPOST")) return "imposto";
  if (t.includes("FINANC")) return "financeira";
  return "despesa"; // fallback seguro (nunca viola o check do 0023)
}

/** BU pela keyword no nome. null = sem unidade → cai em "Geral" (não é erro). */
function resolveBuSlug(nome: string): BuSlug | null {
  const n = nome.toUpperCase();
  if (n.includes("COLÉGIO") || n.includes("COLEGIO")) return "colegio";
  if (n.includes("UNICIVE") || n.includes("UNICV")) return "unicive";
  if (n.includes("CPPEM")) return "cppem";
  return null;
}

/** Extrai o código do prefixo do nome: "1.8 - MENSALIDADE …" → "1.8". */
function parseCodigo(nome: string): string | null {
  const m = nome.match(/^\s*([\d.]+)\s*-/);
  return m ? m[1] : null;
}

/** Grupo DRE 01…08 a partir do codigo do item da árvore (valida o enum). */
function grupoOf(codigo: string | null): string | null {
  if (!codigo) return null;
  const g = codigo.trim().slice(0, 2);
  return /^0[1-8]$/.test(g) ? g : null;
}

/** Map ca_categoria_id → grupo_dre, varrendo a árvore do DRE (itens + subitens). */
function buildGrupoMap(itens: CaDreItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of itens ?? []) {
    const g = grupoOf(item.codigo);
    if (!g) continue;
    const leaves = [
      ...(item.categorias_financeiras ?? []),
      ...(item.subitens ?? []).flatMap((s) => s.categorias_financeiras ?? []),
    ];
    for (const leaf of leaves) if (!map.has(leaf.id)) map.set(leaf.id, g);
  }
  return map;
}

/** Busca paginada (100/página) de recursos com envelope `{ itens }`. */
async function fetchPaginated<T>(companyId: string, path: string): Promise<T[]> {
  const out: T[] = [];
  for (let pagina = 1; pagina <= 50; pagina++) {
    const resp = await caGet<Envelope<T>>(companyId, path, { pagina, tamanho_pagina: 100 });
    const itens = resp.itens ?? [];
    out.push(...itens);
    if (itens.length < 100) break;
  }
  return out;
}

// --------------------------------- Seed ------------------------------------ //

export async function runSeed(companyId: string): Promise<SeedReport> {
  const admin = createAdminClient();

  // 1) BUs — CPPEM / Colégio / Unicive (upsert por slug) --------------------
  const bus = [
    { company_id: companyId, slug: "cppem", nome: "CPPEM", cor: "#00FF01", ordem: 1 },
    { company_id: companyId, slug: "colegio", nome: "Colégio", cor: "#f5a623", ordem: 2 },
    { company_id: companyId, slug: "unicive", nome: "Unicive", cor: "#3aa0ff", ordem: 3 },
    // "Geral" = receitas corporativas/financeiras e genéricas sem unidade (empréstimos,
    // rendimentos, sublocação, cobrança avulsa, fretes, multas, "a identificar"…).
    { company_id: companyId, slug: "geral", nome: "Geral", cor: "#8a8a8a", ordem: 4 },
  ];
  const { data: buData, error: buErr } = await admin
    .from("business_units")
    .upsert(bus, { onConflict: "company_id,slug" })
    .select("id, slug");
  if (buErr) throw new Error(`business_units: ${buErr.message}`);
  const buBySlug = new Map(
    ((buData ?? []) as { id: string; slug: string }[]).map((b) => [b.slug, b.id]),
  );

  // 2) Centros de custo (upsert por ca_centro_id) ---------------------------
  // PAGINADO: sem isto, a 1ª página vinha só com os centros INATIVOS/legados
  // (CPPEM CONCURSOS, Pix, ASAAS…) e os reais ativos (Administrativo, Pedagógico,
  // Marketing…) ficavam na 2ª página, de fora — quebrando o % por centro de custo.
  const centros = await fetchPaginated<CaCentro>(
    companyId,
    CONTA_AZUL_RESOURCES.centrosDeCusto.path!,
  );
  if (centros.length) {
    const { error } = await admin.from("fin_centros_custo").upsert(
      centros.map((c) => ({
        company_id: companyId,
        ca_centro_id: c.id,
        codigo: c.codigo,
        nome: c.nome,
        ativo: c.ativo,
      })),
      { onConflict: "company_id,ca_centro_id" },
    );
    if (error) throw new Error(`fin_centros_custo: ${error.message}`);
  }

  // 3) Categorias — master + grupo_dre + de-para BU -------------------------
  const [cats, dreResp] = await Promise.all([
    fetchPaginated<CaCategoria>(companyId, CONTA_AZUL_RESOURCES.categorias.path!),
    caGet<Envelope<CaDreItem>>(companyId, CONTA_AZUL_RESOURCES.categoriasDre.path!),
  ]);
  const grupoMap = buildGrupoMap(dreResp.itens ?? []);

  const receitasGeral: SeedReport["receitasGeral"] = [];
  const semGrupo: SeedReport["semGrupo"] = [];

  // Passe A: upsert de todas as categorias (parent_id ainda null).
  const catRows = cats.map((c) => {
    const tipo = normTipo(c.tipo);
    const codigo = parseCodigo(c.nome);
    const grupo_dre = grupoMap.get(c.id) ?? null;
    let bu_id: string | null = null;
    if (tipo === "receita") {
      const slug = resolveBuSlug(c.nome);
      bu_id = buBySlug.get(slug ?? "geral") ?? null;
      if (!slug) receitasGeral.push({ codigo, nome: c.nome });
    }
    if (!grupo_dre) semGrupo.push({ codigo, nome: c.nome });
    return {
      company_id: companyId,
      ca_categoria_id: c.id,
      nome: c.nome,
      codigo,
      tipo,
      grupo_dre,
      bu_id,
    };
  });

  const { error: catErr } = await admin
    .from("fin_categorias")
    .upsert(catRows, { onConflict: "company_id,ca_categoria_id" });
  if (catErr) throw new Error(`fin_categorias (passe A): ${catErr.message}`);

  // Passe B: resolve parent_id (ca_categoria_id → nosso uuid) e re-upserta.
  const { data: idData, error: idErr } = await admin
    .from("fin_categorias")
    .select("id, ca_categoria_id")
    .eq("company_id", companyId);
  if (idErr) throw new Error(`fin_categorias (map ids): ${idErr.message}`);
  const idByCaId = new Map(
    ((idData ?? []) as { id: string; ca_categoria_id: string }[]).map((r) => [
      r.ca_categoria_id,
      r.id,
    ]),
  );

  let parentNaoResolvido = 0;
  const comPai = cats
    .filter((c) => c.categoria_pai)
    .map((c) => {
      const parent_id = idByCaId.get(c.categoria_pai as string) ?? null;
      if (!parent_id) parentNaoResolvido++;
      return { company_id: companyId, ca_categoria_id: c.id, parent_id };
    })
    .filter((r) => r.parent_id); // só re-upserta quem tem pai resolvido

  if (comPai.length) {
    const { error } = await admin
      .from("fin_categorias")
      .upsert(comPai, { onConflict: "company_id,ca_categoria_id" });
    if (error) throw new Error(`fin_categorias (passe B): ${error.message}`);
  }

  return {
    bus: buBySlug.size,
    centros: centros.length,
    categorias: catRows.length,
    receitasGeral,
    semGrupo,
    parentNaoResolvido,
  };
}
