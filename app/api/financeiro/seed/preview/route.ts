import { NextResponse } from "next/server";

import { caGet } from "@/lib/contaazul/client";
import { CONTA_AZUL_RESOURCES } from "@/lib/contaazul/config";
import { getCompanyId } from "@/lib/db/company";
import { getSessionContext } from "@/lib/db/permissions";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sonda de SHAPE (Passo 2 do sistema financeiro) — descobre o formato real das
 * respostas do Conta Azul de que o seed precisa, SEM chutar campos. Gateada por
 * `financeiro` (admin). Lê pela app (token válido em memória, single-flight);
 * nunca um curl solto — renovar o token fora da app pode rotacionar o
 * refresh_token do Cognito e derrubar produção.
 *
 * Descartável: some quando o `POST /api/financeiro/seed` estiver escrito contra
 * os shapes confirmados. Retorna só a estrutura (chaves + 2 amostras), não a
 * base inteira.
 */

/** Resume a resposta de um endpoint: tipo do topo, chaves e 2 amostras. */
function resumir(raw: unknown) {
  // Muitos recursos v2 vêm como { itens: [...] }; outros como array direto.
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { itens?: unknown }).itens)
      ? (raw as { itens: unknown[] }).itens
      : null;

  if (arr) {
    return {
      kind: "array" as const,
      envelope: Array.isArray(raw) ? "array-direto" : "{ itens: [...] }",
      total: arr.length,
      chavesPrimeiroItem: arr[0] && typeof arr[0] === "object" ? Object.keys(arr[0] as object) : [],
      amostra: arr.slice(0, 2),
    };
  }
  return {
    kind: "objeto" as const,
    chaves: raw && typeof raw === "object" ? Object.keys(raw as object) : [],
    amostra: raw,
  };
}

async function sondar(companyId: string, path: string, params?: Record<string, string | number>) {
  try {
    const raw = await caGet<unknown>(companyId, path, params);
    return { path, ok: true, ...resumir(raw) };
  } catch (e) {
    return { path, ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET() {
  const ctx = await getSessionContext();
  if (!can(ctx, "financeiro"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const companyId = await getCompanyId();
  if (!companyId)
    return NextResponse.json({ error: "sem empresa / Conta Azul desconectada" }, { status: 400 });

  // As três fontes do seed: categorias (codigo/tipo/parent), centros de custo,
  // e a árvore do DRE (grupo 01..08 + categorias_financeiras por linha).
  const [categorias, centros, dre] = await Promise.all([
    sondar(companyId, CONTA_AZUL_RESOURCES.categorias.path!, { pagina: 1, tamanho_pagina: 100 }),
    sondar(companyId, CONTA_AZUL_RESOURCES.centrosDeCusto.path!),
    sondar(companyId, CONTA_AZUL_RESOURCES.categoriasDre.path!),
  ]);

  return NextResponse.json({ categorias, centros, dre }, { status: 200 });
}
