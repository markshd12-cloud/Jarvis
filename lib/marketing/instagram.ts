/**
 * Instagram orgânico (IG Graph API v25.0) → social_daily_insights /
 * social_media_insights. GLOBAL: sem company_id. Requer META_ACCESS_TOKEN com
 * os escopos instagram_basic + instagram_manage_insights + pages_read_engagement,
 * e cada IG Business Account (config.ts) vinculado a uma Página sob o token.
 *
 * Defensivo de propósito: as métricas do IG mudam entre versões (ex.: `impressions`
 * → `views` no v22+) e variam por tipo de mídia. Cada chamada de insight é isolada
 * num try/catch — uma métrica indisponível não derruba o sync; o que falha vai
 * para `errors[]` e o resto é gravado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MARKETING_BRANDS,
  META_ENV,
  META_GRAPH_BASE,
} from "@/lib/marketing/config";
import { daysAgo, today } from "@/lib/marketing/metrics";
import { createAdminClient } from "@/lib/supabase/admin";

interface IgAccount {
  brand: string;
  igId: string;
}

/** Achata config → uma entrada por IG Business Account (marca pode ter vários). */
function igAccounts(): IgAccount[] {
  return Object.values(MARKETING_BRANDS).flatMap((b) =>
    b.instagram.map((igId) => ({ brand: b.label, igId })),
  );
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** GET assinado na Graph API; lança em erro HTTP/Graph. */
async function igGet(
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown> & { data?: unknown[] }> {
  const q = new URLSearchParams({ access_token: META_ENV.accessToken, ...params });
  const res = await fetch(`${META_GRAPH_BASE}/${path}?${q}`);
  const json = (await res.json()) as Record<string, unknown> & {
    error?: { message?: string };
  };
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `IG HTTP ${res.status}`);
  }
  return json;
}

/** Meia-noite SP (AAAA-MM-DD) em epoch-segundos (SP = UTC-3). */
function spMidnightUnix(iso: string): number {
  return Math.floor(Date.parse(`${iso}T03:00:00Z`) / 1000);
}

/**
 * Série diária de uma métrica de insight (`period=day`) → Map<data, valor>.
 * A janela `[since, until]` precisa caber em ≤ 30 dias (limite da API). Lança em
 * erro para o chamador registrar em `errors[]`.
 */
async function dailySeries(
  igId: string,
  metric: string,
  since: string,
  until: string,
): Promise<Map<string, number>> {
  const ins = await igGet(`${igId}/insights`, {
    metric,
    period: "day",
    since: String(spMidnightUnix(since)),
    until: String(spMidnightUnix(until) + 86_400),
  });
  const values =
    (ins.data as { values?: { value?: number; end_time?: string }[] }[])?.[0]
      ?.values ?? [];
  const map = new Map<string, number>();
  for (const v of values) {
    const date = (v.end_time ?? "").slice(0, 10);
    if (date) map.set(date, v.value ?? 0);
  }
  return map;
}

export interface InstagramSyncResult {
  accounts: number;
  dailyRows: number;
  media: number;
  errors: string[];
}

/**
 * Sincroniza todas as contas de IG. `lookbackDays` limita a janela de insights
 * diários (a IG Graph API aceita no máx. ~30 dias por chamada).
 */
export async function syncInstagram(
  opts: { lookbackDays?: number } = {},
): Promise<InstagramSyncResult> {
  if (!META_ENV.accessToken)
    throw new Error("META_ACCESS_TOKEN ausente no ambiente.");

  const admin = createAdminClient();
  // A IG Graph API rejeita janelas de insight > 30 dias. Com `until` = hoje + 1
  // dia (fim do dia), 28 dias de lookback mantém o intervalo em 29 dias — dentro
  // do limite e ainda cobrindo ~4 semanas de histórico.
  const lookback = Math.min(28, Math.max(1, Math.trunc(opts.lookbackDays ?? 28)));
  const since = daysAgo(lookback);
  const until = today();
  const errors: string[] = [];
  let dailyRows = 0;
  let media = 0;
  let accounts = 0;

  for (const { brand, igId } of igAccounts()) {
    try {
      // Nó da conta: total de seguidores (estável entre versões).
      const node = await igGet(igId, {
        fields: "username,followers_count,media_count",
      });
      const followers = (node.followers_count as number | undefined) ?? null;

      // Alcance diário (métrica estável no time series do IG).
      let reachMap = new Map<string, number>();
      try {
        reachMap = await dailySeries(igId, "reach", since, until);
      } catch (e) {
        errors.push(`${brand} reach: ${msg(e)}`);
      }

      // Backfill da curva de seguidores: `follower_count` dá o GANHO líquido por
      // dia (~28 dias). Ancorando no total atual (`followers`) e voltando dia a
      // dia (total[d-1] = total[d] − ganho[d]) reconstruímos o acumulado passado
      // — a Graph API não expõe histórico do total diretamente.
      const cumByDate = new Map<string, number>();
      try {
        const gains = await dailySeries(igId, "follower_count", since, until);
        const dates = [...gains.keys()].sort();
        if (followers != null && dates.length) {
          const totalGain = dates.reduce((s, d) => s + (gains.get(d) ?? 0), 0);
          let running = followers - totalGain; // linha de base antes do 1º dia
          for (const d of dates) {
            running += gains.get(d) ?? 0; // total ao FIM do dia d
            cumByDate.set(d, running);
          }
        }
      } catch (e) {
        errors.push(`${brand} follower_count: ${msg(e)}`);
      }
      // Garante o total absoluto de hoje mesmo se a série não incluir `until`.
      if (followers != null) cumByDate.set(until, followers);

      const dateSet = new Set<string>([...cumByDate.keys(), ...reachMap.keys()]);
      const rows = [...dateSet].map((date) => ({
        provider: "instagram",
        account_id: igId,
        brand,
        date,
        followers: cumByDate.get(date) ?? null,
        reach: reachMap.get(date) ?? null,
      }));
      if (rows.length) {
        const { error } = await admin
          .from("social_daily_insights")
          .upsert(rows, { onConflict: "provider,account_id,date" });
        if (error) errors.push(`${brand} upsert diário: ${error.message}`);
        else dailyRows += rows.length;
      }

      // Conteúdo recente + insights por mídia.
      media += await syncMedia(admin, brand, igId, errors);
      accounts++;
    } catch (e) {
      errors.push(`${brand} (${igId}): ${msg(e)}`);
    }
  }

  return { accounts, dailyRows, media, errors };
}

/** Puxa as últimas ~25 mídias e seus insights (best-effort por tipo). */
async function syncMedia(
  admin: SupabaseClient,
  brand: string,
  igId: string,
  errors: string[],
): Promise<number> {
  let list: { data?: unknown[] };
  try {
    list = await igGet(`${igId}/media`, {
      fields:
        "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
      limit: "25",
    });
  } catch (e) {
    errors.push(`${brand} media list: ${msg(e)}`);
    return 0;
  }

  const rows = [];
  for (const raw of (list.data as Record<string, unknown>[]) ?? []) {
    const m = raw as {
      id: string;
      caption?: string;
      media_type?: string;
      media_product_type?: string;
      permalink?: string;
      timestamp?: string;
      like_count?: number;
      comments_count?: number;
    };
    const ins: Record<string, number> = {};
    try {
      const metric =
        m.media_product_type === "REELS"
          ? "reach,saved,shares,views,likes,comments"
          : "reach,saved,shares";
      const r = await igGet(`${m.id}/insights`, { metric });
      for (const item of (r.data as { name: string; values?: { value?: number }[] }[]) ??
        []) {
        ins[item.name] = item.values?.[0]?.value ?? 0;
      }
    } catch {
      // Insights por mídia falham para alguns tipos (ex.: álbum antigo) — ok.
    }
    rows.push({
      provider: "instagram",
      media_id: m.id,
      account_id: igId,
      brand,
      media_type: m.media_type ?? null,
      media_product_type: m.media_product_type ?? null,
      permalink: m.permalink ?? null,
      caption: (m.caption ?? "").slice(0, 280) || null,
      reach: ins.reach ?? null,
      views: ins.views ?? null,
      likes: ins.likes ?? m.like_count ?? null,
      comments: ins.comments ?? m.comments_count ?? null,
      saved: ins.saved ?? null,
      shares: ins.shares ?? null,
      metrics: ins,
      posted_at: m.timestamp ?? null,
    });
  }

  if (rows.length) {
    const { error } = await admin
      .from("social_media_insights")
      .upsert(rows, { onConflict: "provider,media_id" });
    if (error) {
      errors.push(`${brand} upsert media: ${error.message}`);
      return 0;
    }
  }
  return rows.length;
}
