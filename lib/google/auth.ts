/**
 * Auth Google por service account (JWT RS256 → access token), compartilhado.
 *
 * A MESMA service account do Vertex (`GOOGLE_SERVICE_ACCOUNT_JSON`) atende várias
 * APIs Google — só muda o `scope`. Usada hoje pelo GA4 (`analytics.readonly`) e
 * pelo YouTube (`youtube.readonly`). Assina com `node:crypto`, sem dependência
 * externa (a `google-auth-library` não é resolvida no bundle standalone).
 *
 * Token cacheado POR ESCOPO em memória, renovado 1 min antes de expirar.
 */
import "server-only";

import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

const b64url = (s: string) => Buffer.from(s).toString("base64url");

const cache = new Map<string, { token: string; exp: number }>();

/** Access token para o escopo pedido (ex.: ".../auth/youtube.readonly"). */
export async function getGoogleAccessToken(scope: string): Promise<string> {
  const hit = cache.get(scope);
  if (hit && Date.now() < hit.exp - 60_000) return hit.token;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON ausente");
  const sa = JSON.parse(raw) as { client_email: string; private_key: string };

  const now = Math.floor(Date.now() / 1000);
  const signingInput =
    `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.` +
    b64url(JSON.stringify({ iss: sa.client_email, scope, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signature = createSign("RSA-SHA256").update(signingInput).sign(sa.private_key).toString("base64url");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${signature}`,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google auth HTTP ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cache.set(scope, { token: json.access_token, exp: Date.now() + json.expires_in * 1000 });
  return json.access_token;
}
