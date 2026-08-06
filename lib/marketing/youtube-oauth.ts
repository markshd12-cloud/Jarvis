/**
 * OAuth do dono do canal para o YouTube (Nível B) — config, troca de código por
 * token e renovação. Server-only.
 *
 * POR QUE OAUTH, se o Nível A já funciona com a service account: a service
 * account lê dados PÚBLICOS (inscritos arredondados, views, vídeos). Tudo que é
 * do dono — `subscribersGained` exato, watch time, retenção, receita — exige o
 * consentimento de quem administra o canal. Não há caminho por service account.
 *
 * As credenciais reusam `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` do ambiente,
 * criadas no projeto `jarvis-498903` para este fim. O nome é genérico, mas são
 * do YouTube: o GA4 e o Vertex usam OUTRO caminho (a service account em
 * `GOOGLE_SERVICE_ACCOUNT_JSON`), sem OAuth.
 */
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export const YOUTUBE_OAUTH = {
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  /**
   * `yt-analytics.readonly` cobre audiência, watch time e retenção.
   * `yt-analytics-monetary.readonly` acrescenta RECEITA — é o escopo sensível,
   * e é o que torna a tela de consentimento "Interno" importante (sem ela o
   * Google exigiria verificação com vídeo demonstrativo).
   * `youtube.readonly` é o que permite listar os canais do usuário no callback,
   * para descobrir o `channel_id` que estamos autorizando.
   */
  scope: [
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    "https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
    "https://www.googleapis.com/auth/youtube.readonly",
  ].join(" "),
} as const;

export const YOUTUBE_ENV = {
  clientId: process.env.GOOGLE_CLIENT_ID ?? "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  /**
   * Precisa bater EXATAMENTE com um dos URIs cadastrados no console. Em
   * produção é o domínio (`https://jarvis.cppem.com.br/...`); o Google recusa
   * IP puro como redirect, aceitando só domínio público ou localhost.
   */
  redirectUri:
    process.env.YOUTUBE_REDIRECT_URI ?? "http://localhost:3000/api/youtube/callback",
} as const;

export function youtubeConfigurado(): boolean {
  return !!YOUTUBE_ENV.clientId && !!YOUTUBE_ENV.clientSecret;
}

/** URL de consentimento. `state` é anti-CSRF (validado no callback). */
export function urlDeAutorizacao(state: string): string {
  const p = new URLSearchParams({
    client_id: YOUTUBE_ENV.clientId,
    redirect_uri: YOUTUBE_ENV.redirectUri,
    response_type: "code",
    scope: YOUTUBE_OAUTH.scope,
    state,
    // `offline` + `consent` são o que garantem o REFRESH TOKEN. Sem os dois, o
    // Google só o devolve na primeiríssima autorização da conta — e numa
    // reautorização a conexão passaria a morrer em 1h, sem renovação possível.
    access_type: "offline",
    // `select_account` junto: sem ele o Google usa a sessão já aberta no
    // navegador e NÃO oferece troca de conta — quem estivesse logado na conta
    // pessoal não conseguia autorizar com a `administrador@cppem.com.br`, que é
    // a dona dos canais. Os dois valores são separados por espaço.
    prompt: "select_account consent",
    include_granted_scopes: "true",
  });
  return `${YOUTUBE_OAUTH.authorizeUrl}?${p}`;
}

interface RespostaToken {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

/** Troca o `code` do callback por tokens. */
export async function trocarCodigo(code: string): Promise<RespostaToken> {
  const res = await fetch(YOUTUBE_OAUTH.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: YOUTUBE_ENV.clientId,
      client_secret: YOUTUBE_ENV.clientSecret,
      redirect_uri: YOUTUBE_ENV.redirectUri,
    }),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`trocarCodigo: HTTP ${res.status} ${txt.slice(0, 200)}`);
  return JSON.parse(txt) as RespostaToken;
}

export interface ConexaoYoutube {
  channel_id: string;
  channel_title: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
  last_synced_at: string | null;
}

export async function listarConexoes(): Promise<ConexaoYoutube[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("youtube_connections")
    .select("channel_id, channel_title, access_token, refresh_token, expires_at, scope, last_synced_at")
    .order("channel_title", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`listarConexoes: ${error.message}`);
  return (data ?? []) as ConexaoYoutube[];
}

/**
 * Access token válido do canal, renovando quando perto de expirar.
 *
 * A margem de 60s evita o token vencer ENTRE a checagem e a chamada — sem ela,
 * uma requisição na virada do minuto falharia com 401 sem motivo aparente.
 */
export async function tokenValido(channelId: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("youtube_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("channel_id", channelId)
    .maybeSingle();
  if (error) throw new Error(`tokenValido: ${error.message}`);
  if (!data) throw new Error(`Canal ${channelId} não conectado.`);

  const expira = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (expira - Date.now() > 60_000) return data.access_token as string;

  const refresh = data.refresh_token as string | null;
  if (!refresh)
    throw new Error(
      `Canal ${channelId} sem refresh_token — é preciso reconectar (autorize novamente).`,
    );

  const res = await fetch(YOUTUBE_OAUTH.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: YOUTUBE_ENV.clientId,
      client_secret: YOUTUBE_ENV.clientSecret,
    }),
  });
  const txt = await res.text();
  if (!res.ok) {
    /**
     * `invalid_grant` = o usuário revogou o acesso em myaccount.google.com (ou o
     * refresh caducou). O token nunca mais vai funcionar, então a linha só
     * atrapalha: a tela seguiria dizendo "conectado" e toda leitura falharia.
     * Remover devolve o canal ao estado "não conectado", que convida a religar.
     */
    if (txt.includes("invalid_grant")) {
      await admin.from("youtube_connections").delete().eq("channel_id", channelId);
      throw new Error(
        `Acesso ao canal ${channelId} foi revogado no Google — conecte novamente.`,
      );
    }
    throw new Error(`renovar token: HTTP ${res.status} ${txt.slice(0, 200)}`);
  }
  const t = JSON.parse(txt) as RespostaToken;

  // A renovação NÃO devolve refresh_token novo — preservamos o existente.
  await admin
    .from("youtube_connections")
    .update({
      access_token: t.access_token,
      expires_at: t.expires_in
        ? new Date(Date.now() + t.expires_in * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    })
    .eq("channel_id", channelId);

  return t.access_token;
}

/** Desconecta o canal (o usuário precisa autorizar de novo para voltar). */
export async function desconectar(channelId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("youtube_connections")
    .delete()
    .eq("channel_id", channelId);
  if (error) throw new Error(`desconectar: ${error.message}`);
}
