"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Status {
  connected: boolean;
  accountId?: string;
  expiresAt?: string | null;
  loginError?: string | null;
}

type Mode = "idle" | "waiting" | "device" | "paste";

/**
 * Conexão do ChatGPT (login OAuth, SEM API key). Fluxo PRINCIPAL = automático:
 * sobe um listener local em 1455 (como o Codex CLI) e captura o redirect sozinho
 * — o usuário só clica e loga, sem colar nada. Alternativas: código do
 * dispositivo (para produção/remoto) e colar URL manual (fallback avançado).
 */
export function ChatGptConnect() {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [device, setDevice] = useState<{
    userCode: string;
    verificationUrl: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelPoll = useRef(false);

  async function fetchStatus(): Promise<Status> {
    try {
      const res = await fetch("/api/providers/openai/status");
      return res.ok ? ((await res.json()) as Status) : { connected: false };
    } catch {
      return { connected: false };
    }
  }

  async function refresh() {
    setStatus(await fetchStatus());
  }

  useEffect(() => {
    let active = true;
    (async () => {
      const data = await fetchStatus();
      if (active) setStatus(data);
    })();
    return () => {
      active = false;
      cancelPoll.current = true;
    };
  }, []);

  function reset() {
    cancelPoll.current = true;
    setMode("idle");
    setAuthUrl(null);
    setCallbackUrl("");
    setDevice(null);
    setError(null);
  }

  // ── Fluxo AUTOMÁTICO (loopback 1455) ─────────────────────────────
  // Depois de abrir a URL, faz poll do /status até o token MUDAR (novo login) /
  // erro / timeout. Compara com o token anterior (`prevExpiry`) para o caso de
  // RECONECTAR já estando conectado — senão o poll pararia na hora vendo o token
  // velho ainda no disco.
  async function pollUntilConnected(prevExpiry: string | null | undefined) {
    const deadline = Date.now() + 3 * 60_000; // 3 min
    while (!cancelPoll.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      if (cancelPoll.current) return;
      const st = await fetchStatus();
      if (st.connected && st.expiresAt !== prevExpiry) {
        reset();
        setStatus(st);
        return;
      }
      if (st.loginError) {
        setError(st.loginError);
        return;
      }
    }
    if (!cancelPoll.current) {
      setError("Tempo esgotado aguardando o login. Tente novamente.");
    }
  }

  async function startAuto() {
    setBusy(true);
    setError(null);
    const prevExpiry = status?.expiresAt; // token atual (se reconectando)
    try {
      const res = await fetch("/api/providers/openai/login-start", {
        method: "POST",
      });
      const data = (await res.json()) as { authorize_url?: string; error?: string };
      if (!res.ok || !data.authorize_url) {
        throw new Error(data.error ?? "Falha ao iniciar o login.");
      }
      setAuthUrl(data.authorize_url);
      setMode("waiting");
      cancelPoll.current = false;
      window.open(data.authorize_url, "_blank", "noopener,noreferrer");
      void pollUntilConnected(prevExpiry);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ── Colar URL manual (fallback avançado) ─────────────────────────
  async function startPaste() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/providers/openai/auth-start", {
        method: "POST",
      });
      const data = (await res.json()) as { authorize_url?: string; error?: string };
      if (!res.ok || !data.authorize_url) {
        throw new Error(data.error ?? "Falha ao iniciar o login.");
      }
      setAuthUrl(data.authorize_url);
      setMode("paste");
      window.open(data.authorize_url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function completePaste() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/providers/openai/auth-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_url: callbackUrl.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Falha ao concluir o login.");
      reset();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ── Device Auth (produção/remoto) ────────────────────────────────
  async function runDevicePoll(intervalMs: number) {
    while (!cancelPoll.current) {
      await new Promise((r) => setTimeout(r, intervalMs));
      if (cancelPoll.current) return;
      try {
        const res = await fetch("/api/providers/openai/device-poll", {
          method: "POST",
        });
        const data = (await res.json()) as { status: string; message?: string };
        if (data.status === "authorized") {
          reset();
          await refresh();
          return;
        }
        if (data.status === "error") {
          setError(data.message ?? "Falha no login por dispositivo.");
          return;
        }
      } catch {
        /* rede instável — tenta de novo no próximo ciclo */
      }
    }
  }

  async function startDevice() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/providers/openai/device-start", {
        method: "POST",
      });
      const data = (await res.json()) as {
        user_code?: string;
        verification_url?: string;
        interval?: number;
        error?: string;
      };
      if (!res.ok || !data.user_code) {
        throw new Error(data.error ?? "Device Auth indisponível.");
      }
      setDevice({
        userCode: data.user_code,
        verificationUrl:
          data.verification_url ?? "https://auth.openai.com/codex/device",
      });
      setMode("device");
      cancelPoll.current = false;
      void runDevicePoll((data.interval ?? 5) * 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/providers/openai/logout", { method: "POST" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (status === null) {
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  }

  // ── Conectado ────────────────────────────────────────────────────
  if (status.connected && mode === "idle") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          Conectado via login do ChatGPT
          {status.accountId ? (
            <span className="text-foreground"> · conta {status.accountId}</span>
          ) : null}
          {status.expiresAt
            ? ` · token válido até ${new Date(status.expiresAt).toLocaleString("pt-BR")}`
            : null}
        </p>
        <div className="flex items-center gap-2">
          <Button onClick={startAuto} disabled={busy} variant="outline">
            Reconectar
          </Button>
          <Button onClick={disconnect} disabled={busy} variant="destructive">
            {busy ? "…" : "Desconectar"}
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    );
  }

  // ── Aguardando o login automático (loopback) ─────────────────────
  if (mode === "waiting") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          Abriu uma aba para você logar no ChatGPT. Assim que autorizar, esta tela
          conecta <span className="text-foreground">sozinha</span> — não precisa
          copiar nada.
        </p>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
          <span className="text-sm text-muted-foreground">Aguardando o login…</span>
        </div>
        {authUrl ? (
          <a
            href={authUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary underline"
          >
            Reabrir a página de login
          </a>
        ) : null}
        <button
          type="button"
          onClick={startPaste}
          className="text-xs text-muted-foreground underline"
        >
          Não conectou sozinho? Colar a URL manualmente
        </button>
        <Button onClick={reset} disabled={busy} variant="ghost">
          Cancelar
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    );
  }

  // ── Colar URL manual (fallback) ──────────────────────────────────
  if (mode === "paste") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          Depois de autorizar, o navegador vai para um endereço{" "}
          <code>localhost:1455</code> (pode dar erro de conexão — normal). Copie a
          URL COMPLETA dessa página e cole abaixo.
        </p>
        <Input
          value={callbackUrl}
          onChange={(e) => setCallbackUrl(e.target.value)}
          placeholder="http://localhost:1455/auth/callback?code=…&state=…"
          className="w-full"
        />
        <div className="flex items-center gap-2">
          <Button onClick={completePaste} disabled={busy || !callbackUrl.trim()}>
            {busy ? "Concluindo…" : "Concluir login"}
          </Button>
          <Button onClick={reset} disabled={busy} variant="ghost">
            Cancelar
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    );
  }

  // ── Device Auth ──────────────────────────────────────────────────
  if (mode === "device" && device) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          Acesse{" "}
          <a
            href={device.verificationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline"
          >
            {device.verificationUrl}
          </a>{" "}
          e digite o código:
        </p>
        <span className="rounded-md border border-border bg-muted px-3 py-1.5 font-mono text-lg tracking-widest">
          {device.userCode}
        </span>
        <p className="text-sm text-muted-foreground">
          Aguardando autorização… esta janela atualiza sozinha.
        </p>
        <Button onClick={reset} disabled={busy} variant="ghost">
          Cancelar
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    );
  }

  // ── Desconectado (estado inicial) ────────────────────────────────
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">
        Conecte sua conta do ChatGPT para o Jarvis usar o GPT como IA — login
        OAuth, sem API key (a cobrança vai pela sua assinatura do ChatGPT).
      </p>
      <div className="flex items-center gap-2">
        <Button onClick={startAuto} disabled={busy}>
          {busy ? "Abrindo…" : "Conectar ChatGPT"}
        </Button>
        <Button onClick={startDevice} disabled={busy} variant="outline">
          Usar código do dispositivo
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Ao clicar, abre o login da OpenAI numa aba nova; ao autorizar, conecta
        sozinho. Em servidor remoto, use “código do dispositivo”.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
