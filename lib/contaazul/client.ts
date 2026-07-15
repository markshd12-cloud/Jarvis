/**
 * Client HTTP da Conta Azul (API v2) para leitura server-side.
 *
 * Responsável por: (1) ler o access_token da empresa em `contaazul_connections`
 * (via service_role — nunca chega ao browser), (2) renovar via refresh_token
 * quando expirado ou quando a API responde 401, e (3) fazer GETs autenticados
 * com Bearer. NÃO deve ser importado em Client Components.
 *
 * O token do Cognito expira em ~1h; guardamos o instante de expiração e
 * renovamos proativamente (com 60s de folga) antes de cada chamada.
 */
import "server-only";

import {
  CONTA_AZUL_API_BASE,
  CONTA_AZUL_ENV,
  CONTA_AZUL_OAUTH,
} from "@/lib/contaazul/config";
import { createAdminClient } from "@/lib/supabase/admin";

/** Erro tipado para o dashboard degradar graciosamente (sem token / falha). */
export class ContaAzulError extends Error {
  constructor(
    message: string,
    readonly kind: "no-connection" | "auth" | "http" | "network",
    readonly status?: number,
  ) {
    super(message);
    this.name = "ContaAzulError";
  }
}

interface TokenRow {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

/** Folga (ms) para renovar antes da expiração real e evitar 401 na borda. */
const SKEW_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Throttle GLOBAL de saída para a API v2. A Conta Azul aplica um "spike arrest"
 * de 10 req/s (429 `SpikeArrestViolation`); espaçamos os INÍCIOS de requisição
 * em ~130ms (~7,7 req/s) para ficar abaixo do teto, mesmo com várias paginações
 * concorrentes (contas-a-receber + contas-a-pagar em paralelo). Como o JS é
 * single-thread, atualizar `throttleAt` de forma síncrona antes do await já
 * escalona chamadas concorrentes sem colisão.
 */
const MIN_GAP_MS = 130;
let throttleAt = 0;
async function throttle(): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, throttleAt + MIN_GAP_MS);
  throttleAt = start;
  const wait = start - now;
  if (wait > 0) await sleep(wait);
}

function basicAuth(): string {
  return Buffer.from(
    `${CONTA_AZUL_ENV.clientId}:${CONTA_AZUL_ENV.clientSecret}`,
  ).toString("base64");
}

/**
 * Renova o access_token via refresh_token e persiste o novo par no DB.
 * Retenta em 429 — o endpoint de auth (Cognito) também aplica rate limit;
 * sob rajada de chamadas o refresh estourava e derrubava o painel.
 */
async function doRefresh(companyId: string, refreshToken: string): Promise<string> {
  const call = () =>
    fetch(CONTA_AZUL_OAUTH.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      cache: "no-store",
    });

  let res = await call();
  for (let tentativa = 0; res.status === 429 && tentativa < 4; tentativa++) {
    await sleep(1100 + tentativa * 500);
    res = await call();
  }

  if (!res.ok) {
    throw new ContaAzulError(
      `Falha ao renovar token (HTTP ${res.status}). Reconecte a Conta Azul.`,
      "auth",
      res.status,
    );
  }

  const token = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
    scope?: string;
  };

  const expiresAt =
    typeof token.expires_in === "number"
      ? new Date(Date.now() + token.expires_in * 1000).toISOString()
      : null;

  const admin = createAdminClient();
  await admin
    .from("contaazul_connections")
    .update({
      access_token: token.access_token,
      // O Cognito pode ou não rotacionar o refresh_token; preserva o antigo se ausente.
      refresh_token: token.refresh_token ?? refreshToken,
      token_type: token.token_type,
      expires_at: expiresAt,
      scope: token.scope,
    })
    .eq("company_id", companyId);

  return token.access_token;
}

/**
 * Deduplica refreshes concorrentes (single-flight) por empresa. Quando o token
 * expira e várias requisições paralelas (contas-a-receber + contas-a-pagar em
 * lotes) disparam refresh ao mesmo tempo, só UM POST é feito — as demais
 * aguardam a mesma promise. Evita o 429 do Cognito e a invalidação em cascata
 * do refresh_token (que é rotacionado a cada refresh). 1 réplica → Map de
 * processo basta.
 */
const inFlightRefresh = new Map<string, Promise<string>>();
function refresh(companyId: string, refreshToken: string): Promise<string> {
  const existing = inFlightRefresh.get(companyId);
  if (existing) return existing;
  const p = doRefresh(companyId, refreshToken).finally(() => {
    inFlightRefresh.delete(companyId);
  });
  inFlightRefresh.set(companyId, p);
  return p;
}

/** Lê a conexão da empresa; renova o token se estiver expirado (ou quase). */
async function getFreshToken(companyId: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("contaazul_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("company_id", companyId)
    .maybeSingle<TokenRow>();

  if (error || !data) {
    throw new ContaAzulError(
      "Conta Azul não conectada para esta empresa.",
      "no-connection",
    );
  }

  const expired =
    data.expires_at != null &&
    new Date(data.expires_at).getTime() - SKEW_MS <= Date.now();

  if (expired && data.refresh_token) {
    return refresh(companyId, data.refresh_token);
  }
  return data.access_token;
}

/** Monta a URL final com querystring (ignora params nulos/vazios). */
function buildUrl(
  path: string,
  params?: Record<string, string | number | undefined>,
): string {
  const url = new URL(`${CONTA_AZUL_API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

/**
 * GET autenticado na API v2. Renova o token e tenta 1x novamente em 401.
 * Retorna o JSON já parseado; lança `ContaAzulError` em falha.
 */
export async function caGet<T = unknown>(
  companyId: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = buildUrl(path, params);

  const call = async (token: string) => {
    await throttle();
    return fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
  };

  let token = await getFreshToken(companyId);
  let res = await call(token);

  // 401: token pode ter sido invalidado fora do ciclo de expiração → renova e retenta.
  if (res.status === 401) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("contaazul_connections")
      .select("refresh_token")
      .eq("company_id", companyId)
      .maybeSingle<{ refresh_token: string | null }>();
    if (data?.refresh_token) {
      token = await refresh(companyId, data.refresh_token);
      res = await call(token);
    }
  }

  // 429 (spike arrest): a janela é de 1s → espera >1s e retenta (backoff leve).
  for (let tentativa = 0; res.status === 429 && tentativa < 4; tentativa++) {
    await sleep(1100 + tentativa * 400);
    res = await call(token);
  }

  if (!res.ok) {
    throw new ContaAzulError(
      `Conta Azul respondeu HTTP ${res.status} em ${path}.`,
      res.status === 401 ? "auth" : "http",
      res.status,
    );
  }

  return (await res.json()) as T;
}

/** Marca a empresa como sincronizada agora (para o rótulo "última sync"). */
export async function markSynced(companyId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("contaazul_connections")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("company_id", companyId);
}
