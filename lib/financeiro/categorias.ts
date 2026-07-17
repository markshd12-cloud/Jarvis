/**
 * Acesso às categorias financeiras. Server-only, escopado por `companyId`.
 *
 * Hierarquia da UI (decisão do Passo 2): **grupo DRE (01…08) → categoria**, não o
 * `categoria_pai` do CA (o `/categorias` só devolve folhas). O `parent_id` fica
 * disponível mas inerte por padrão; se usado, há guarda anti-ciclo simples.
 */
import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  FIN_TIPOS,
  GRUPOS_DRE,
  fkFriendly,
  type FinCategoria,
  type GrupoDre,
} from "./types";

const tipoSchema = z.enum(FIN_TIPOS as [string, ...string[]]);
const grupoSchema = z.enum(GRUPOS_DRE);
const naturezaSchema = z.enum(["fixa", "variavel"]);

export const categoriaInputSchema = z.object({
  nome: z.string().trim().min(1, "nome obrigatório"),
  codigo: z.string().trim().nullish(),
  tipo: tipoSchema,
  grupo_dre: grupoSchema.nullish(),
  natureza: naturezaSchema.nullish(),
  bu_id: z.string().uuid().nullish(),
  parent_id: z.string().uuid().nullish(),
  ordem: z.number().int().nonnegative().optional(),
});
export type CategoriaInput = z.infer<typeof categoriaInputSchema>;

export async function listCategorias(companyId: string): Promise<FinCategoria[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_categorias")
    .select("*")
    .eq("company_id", companyId)
    .order("codigo", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`listCategorias: ${error.message}`);
  return (data ?? []) as FinCategoria[];
}

export interface GrupoCategorias {
  grupo_dre: GrupoDre | null;
  categorias: FinCategoria[];
}

/** Árvore da aba Cadastros: categorias agrupadas por grupo DRE, ordenadas por código. */
export async function getCategoriaTree(companyId: string): Promise<GrupoCategorias[]> {
  const cats = await listCategorias(companyId);
  const porGrupo = new Map<GrupoDre | "sem", FinCategoria[]>();
  for (const c of cats) {
    const k = c.grupo_dre ?? "sem";
    (porGrupo.get(k) ?? porGrupo.set(k, []).get(k)!).push(c);
  }
  // Ordem: 01…08 primeiro, "sem grupo" por último.
  const ordem: (GrupoDre | "sem")[] = [...GRUPOS_DRE, "sem"];
  return ordem
    .filter((g) => porGrupo.has(g))
    .map((g) => ({
      grupo_dre: g === "sem" ? null : g,
      categorias: porGrupo.get(g)!,
    }));
}

export async function createCategoria(
  companyId: string,
  input: CategoriaInput,
): Promise<FinCategoria> {
  const v = categoriaInputSchema.parse(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_categorias")
    .insert({ company_id: companyId, ...v })
    .select("*")
    .single();
  if (error) throw new Error(`createCategoria: ${error.message}`);
  return data as FinCategoria;
}

export async function updateCategoria(
  companyId: string,
  id: string,
  input: Partial<CategoriaInput>,
): Promise<FinCategoria> {
  const v = categoriaInputSchema.partial().parse(input);
  if (v.parent_id && v.parent_id === id)
    throw new Error("categoria não pode ser pai de si mesma");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("fin_categorias")
    .update(v)
    .eq("company_id", companyId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`updateCategoria: ${error.message}`);
  return data as FinCategoria;
}

export async function setCategoriaAtivo(
  companyId: string,
  id: string,
  ativo: boolean,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("fin_categorias")
    .update({ ativo })
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw new Error(`setCategoriaAtivo: ${error.message}`);
}

/** Exclui. FK `on delete restrict` barra se já referenciada por lançamentos. */
export async function deleteCategoria(companyId: string, id: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("fin_categorias")
    .delete()
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw new Error(fkFriendly(error, "Categoria"));
}
