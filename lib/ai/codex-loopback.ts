import { createServer, type Server } from "node:http";

import { oauthConfig, writeCodexAuth } from "@/lib/ai/codex-auth";
import { generatePkce } from "@/lib/ai/codex-oauth";

/**
 * Login do ChatGPT SEM colar URL — replica o que o Codex CLI faz: sobe um
 * servidor local em 127.0.0.1:1455 que CAPTURA o redirect do OAuth
 * automaticamente. O usuário só clica, loga no navegador e pronto.
 *
 * ⚠️ Só funciona quando o navegador e o servidor estão na MESMA máquina
 * (desenvolvimento local, ou acessando o próprio host). Em produção (VPS, com o
 * navegador noutra máquina) `localhost:1455` aponta para o laptop do usuário —
 * aí use o fluxo de Device Auth. Ver DEPLOY.md.
 *
 * O estado (servidor 1455 + PKCE pendente) vive em `globalThis`: no dev do Next
 * os módulos recarregam a quente, mas o servidor HTTP fica vivo — se o `pending`
 * estivesse numa variável de módulo comum, o callback cairia numa instância nova
 * com `pending` nulo ("Login inválido"). O globalThis mantém tudo coerente.
 */

const LOOPBACK_PORT = 1455;

interface LoopbackState {
  server: Server | null;
  pending: { verifier: string; state: string } | null;
  lastError: string | null;
}

const globalRef = globalThis as unknown as {
  __codexLoopback?: LoopbackState;
};

function store(): LoopbackState {
  if (!globalRef.__codexLoopback) {
    globalRef.__codexLoopback = { server: null, pending: null, lastError: null };
  }
  return globalRef.__codexLoopback;
}

/** Último erro do fluxo de loopback, para a UI diferenciar erro de espera. */
export function loopbackError(): string | null {
  return store().lastError;
}

/**
 * Inicia o login: gera PKCE, garante o listener em 1455 e devolve a URL de
 * autorização para abrir no navegador. Ao voltar, o listener troca o code e
 * grava o auth.json — a UI detecta via /status.
 */
export async function startLoopbackLogin(): Promise<{ authorizeUrl: string }> {
  const cfg = oauthConfig();
  const { verifier, challenge, state } = generatePkce();

  const s = store();
  s.pending = { verifier, state };
  s.lastError = null;

  await ensureServer();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: cfg.scopes,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
  });
  return { authorizeUrl: `${cfg.authorizeUrl}?${params.toString()}` };
}

/** Sobe o servidor de loopback uma única vez (idempotente, via globalThis). */
function ensureServer(): Promise<void> {
  const s = store();
  if (s.server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      void handleCallback(req.url ?? "/", res);
    });
    srv.on("error", (err: NodeJS.ErrnoException) => {
      // Porta ocupada por um listener nosso anterior: mantém o que já está de pé.
      if (err.code === "EADDRINUSE") {
        resolve();
        return;
      }
      reject(err);
    });
    srv.listen(LOOPBACK_PORT, "127.0.0.1", () => {
      s.server = srv;
      resolve();
    });
  });
}

const resultPage = (icon: string, msg: string) =>
  `<!doctype html><meta charset="utf-8"><title>Jarvis</title>` +
  `<body style="font-family:system-ui;background:#0b0b0b;color:#eaeaea;display:grid;place-items:center;height:100vh;margin:0">` +
  `<div style="text-align:center;max-width:28rem;padding:2rem">` +
  `<div style="font-size:2.5rem">${icon}</div><h1 style="font-size:1.1rem">${msg}</h1>` +
  `<p style="color:#9a9a9a">Pode fechar esta aba e voltar ao Jarvis.</p></div>`;

/** Trata o GET /auth/callback?code=&state= vindo do OAuth. */
async function handleCallback(
  rawUrl: string,
  res: import("node:http").ServerResponse,
): Promise<void> {
  const url = new URL(rawUrl, `http://localhost:${LOOPBACK_PORT}`);
  if (!url.pathname.startsWith("/auth/callback")) {
    res.writeHead(404).end();
    return;
  }

  const s = store();
  const finish = (status: number, icon: string, msg: string) => {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(resultPage(icon, msg));
  };

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthErr = url.searchParams.get("error");

  if (oauthErr) {
    s.lastError = `A OpenAI recusou o login: ${oauthErr}`;
    finish(400, "❌", "Login recusado pela OpenAI.");
    return;
  }
  if (!s.pending || !state || state !== s.pending.state || !code) {
    s.lastError = "Login inválido ou expirado — recomece pelo Jarvis.";
    finish(400, "❌", "Login inválido — recomece pelo Jarvis.");
    return;
  }

  try {
    const cfg = oauthConfig();
    const tokenRes = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: cfg.redirectUri,
        client_id: cfg.clientId,
        code_verifier: s.pending.verifier,
      }),
    });
    if (!tokenRes.ok) {
      const detail = await tokenRes.text().catch(() => "");
      throw new Error(`troca de token HTTP ${tokenRes.status} ${detail.slice(0, 200)}`);
    }
    await writeCodexAuth(
      (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        id_token?: string;
      },
    );
    s.pending = null;
    s.lastError = null;
    finish(200, "✅", "ChatGPT conectado com sucesso!");
  } catch (error) {
    s.lastError = `Falha ao concluir o login: ${(error as Error).message}`;
    finish(500, "❌", "Falha ao concluir o login.");
  }
}
