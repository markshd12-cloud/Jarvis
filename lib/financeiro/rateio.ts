/**
 * Rateio de parcela entre BUs (`fin_despesa_rateio`) — ativa a tabela que já
 * existia INERTE na 0023. Uma parcela pode ser dividida em % por BU (ex.: aluguel
 * → Colégio 60% / CPPEM 30% / Unicive 10%), editável por parcela.
 *
 * Regra (do schema): **havendo rateio, ele manda; senão, o `bu_id` da parcela.**
 * `expandirPorBu` é a FONTE ÚNICA de quebra por BU — toda agregação (fluxo de
 * caixa, orçamento, painel) passa a chamar isto em vez de ler `bu_id` direto.
 *
 * Dinheiro em CENTAVOS (inteiro) para não perder centavo no rateio: divide por %,
 * e o resto do arredondamento vai para as MAIORES fatias → Σ = valor exato.
 *
 * Server-only, escopado por `companyId`.
 */
import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

export const rateioLinhaSchema = z.object({
  bu_id: z.string().uuid(),
  percentual: z.coerce.number().gt(0).max(100),
});
export type RateioLinha = z.infer<typeof rateioLinhaSchema>;

/** Fatia de um valor atribuída a uma BU (em centavos). */
export interface FatiaBu {
  bu_id: string;
  valorCents: number;
}

/**
 * Valida um rateio: Σ = 100% (em centésimos de %, sem erro de float), sem BU
 * repetida, mínimo 2 BUs. Array VAZIO = "sem rateio" (usa o bu_id da parcela) — ok.
 */
export function validarRateio(linhas: RateioLinha[]): void {
  if (linhas.length === 0) return;
  if (linhas.length === 1)
    throw new Error("Rateio com 1 BU não faz sentido — deixe sem rateio e use o BU da parcela.");
  const vistos = new Set<string>();
  let soma = 0; // em centésimos de % (100% = 10000)
  for (const l of linhas) {
    if (l.percentual <= 0 || l.percentual > 100)
      throw new Error("Percentual inválido (0 < % ≤ 100).");
    if (vistos.has(l.bu_id)) throw new Error("A mesma BU aparece duas vezes no rateio.");
    vistos.add(l.bu_id);
    soma += Math.round(l.percentual * 100);
  }
  if (soma !== 10000)
    throw new Error(`Soma dos percentuais = ${(soma / 100).toFixed(2)}% — precisa ser exatamente 100%.`);
}

/**
 * Expande o valor de UMA parcela em fatias por BU.
 * - Sem rateio → `[{ bu_id: buIdPadrao, valorCents }]`.
 * - Com rateio → divide proporcional; o resto do arredondamento (centavos) vai
 *   para as maiores fatias, garantindo Σ = `valorCents` exato.
 */
export function expandirPorBu(
  valorCents: number,
  buIdPadrao: string,
  rateio: RateioLinha[] | undefined | null,
): FatiaBu[] {
  if (!rateio || rateio.length === 0) return [{ bu_id: buIdPadrao, valorCents }];

  const parts = rateio.map((l) => ({
    bu_id: l.bu_id,
    pct: l.percentual,
    valorCents: Math.floor((valorCents * Math.round(l.percentual * 100)) / 10000),
  }));
  const alocado = parts.reduce((s, p) => s + p.valorCents, 0);
  let resto = valorCents - alocado; // sempre 0..(n-1) centavos
  // Distribui o resto para as maiores fatias (desempate por valor).
  parts.sort((a, b) => b.pct - a.pct || b.valorCents - a.valorCents);
  for (let i = 0; i < parts.length && resto > 0; i++, resto--) parts[i].valorCents++;
  return parts.map((p) => ({ bu_id: p.bu_id, valorCents: p.valorCents }));
}

/** BU "principal" de um rateio (maior %) — vira o `bu_id` obrigatório da parcela. */
export function buPrincipal(linhas: RateioLinha[]): string | null {
  if (linhas.length === 0) return null;
  return [...linhas].sort((a, b) => b.percentual - a.percentual)[0].bu_id;
}

// ------------------------------- I/O --------------------------------------- //

/** Rateios de várias parcelas de uma vez → Map<parcela_id, RateioLinha[]>. */
export async function listRateios(
  companyId: string,
  parcelaIds: string[],
): Promise<Map<string, RateioLinha[]>> {
  const map = new Map<string, RateioLinha[]>();
  if (parcelaIds.length === 0) return map;
  const admin = createAdminClient();

  // Em lotes: `.in()` vira `?parcela_id=in.(…)` na URL, e cada UUID custa ~39
  // caracteres. Com as recorrências materializadas 12 meses à frente, listar
  // "todos os meses" passou de 1.200 parcelas — uma URL de ~50 KB, que o proxy
  // recusa antes de chegar ao banco. A resposta volta VAZIA e o painel quebrava
  // com "Unexpected end of JSON input". 200 por vez mantém a URL abaixo de 8 KB.
  const LOTE = 200;
  for (let i = 0; i < parcelaIds.length; i += LOTE) {
    const { data, error } = await admin
      .from("fin_despesa_rateio")
      .select("parcela_id, bu_id, percentual")
      .eq("company_id", companyId)
      .in("parcela_id", parcelaIds.slice(i, i + LOTE));
    if (error) throw new Error(`listRateios: ${error.message}`);
    for (const r of data ?? []) {
      const arr = map.get(r.parcela_id as string) ?? [];
      arr.push({ bu_id: r.bu_id as string, percentual: Number(r.percentual) });
      map.set(r.parcela_id as string, arr);
    }
  }
  return map;
}

/**
 * Insere rateios de várias parcelas de uma vez (bulk). Valida cada Σ=100% antes.
 * Entradas sem linhas são ignoradas. Usado por criar/atualizar despesa (as
 * parcelas acabaram de ser inseridas, então não há rateio antigo a limpar).
 */
export async function inserirRateios(
  companyId: string,
  entries: { parcelaId: string; linhas: RateioLinha[] }[],
): Promise<void> {
  const rows: {
    company_id: string;
    parcela_id: string;
    bu_id: string;
    percentual: number;
  }[] = [];
  for (const e of entries) {
    if (!e.linhas || e.linhas.length === 0) continue;
    validarRateio(e.linhas);
    for (const l of e.linhas)
      rows.push({
        company_id: companyId,
        parcela_id: e.parcelaId,
        bu_id: l.bu_id,
        percentual: l.percentual,
      });
  }
  if (rows.length === 0) return;
  const admin = createAdminClient();
  const { error } = await admin.from("fin_despesa_rateio").insert(rows);
  if (error) throw new Error(`inserirRateios: ${error.message}`);
}

/**
 * Substitui (replace) o rateio de uma parcela. Valida Σ=100% antes. Array vazio
 * remove o rateio (a parcela volta a valer pelo `bu_id`).
 */
export async function replaceRateio(
  companyId: string,
  parcelaId: string,
  linhas: RateioLinha[],
): Promise<void> {
  validarRateio(linhas);
  const admin = createAdminClient();
  const { error: eDel } = await admin
    .from("fin_despesa_rateio")
    .delete()
    .eq("company_id", companyId)
    .eq("parcela_id", parcelaId);
  if (eDel) throw new Error(`replaceRateio (limpar): ${eDel.message}`);
  if (linhas.length === 0) return;
  const rows = linhas.map((l) => ({
    company_id: companyId,
    parcela_id: parcelaId,
    bu_id: l.bu_id,
    percentual: l.percentual,
  }));
  const { error } = await admin.from("fin_despesa_rateio").insert(rows);
  if (error) throw new Error(`replaceRateio (gravar): ${error.message}`);
}
