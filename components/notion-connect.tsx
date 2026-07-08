"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

export function NotionConnect({
  connected,
  workspaceName,
  lastSyncedAt,
}: {
  connected: boolean;
  workspaceName: string | null;
  lastSyncedAt: string | null;
}) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Chama o sync em laço: cada rodada indexa uma fatia e retorna rápido.
  // O total acumulado sobe na tela a cada rodada → o usuário vê que está vivo,
  // e o backlog termina sozinho sem precisar clicar de novo.
  async function sync() {
    setSyncing(true);
    setResult("Sincronizando… isso pode levar alguns minutos no primeiro envio.");

    let indexed = 0;
    let skipped = 0;
    try {
      for (let round = 1; ; round++) {
        const res = await fetch("/api/notion/sync", { method: "POST" });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as {
          indexed: number;
          skipped: number;
          done: boolean;
        };
        indexed += data.indexed;
        skipped += data.skipped;

        if (data.done) {
          setResult(`Concluído: ${indexed} indexadas, ${skipped} já atualizadas.`);
          return;
        }

        // Trava de segurança: rodada sem progresso nenhum não fica em loop infinito.
        if (round > 1 && data.indexed === 0 && data.skipped === 0) {
          setResult(
            `Pausado: ${indexed} indexadas até agora. Clique novamente para continuar.`,
          );
          return;
        }

        setResult(`Sincronizando… ${indexed} indexadas, ${skipped} já atualizadas (continua).`);
      }
    } catch {
      setResult(
        indexed > 0
          ? `Interrompido com ${indexed} indexadas. Clique novamente para continuar.`
          : "Falha ao sincronizar. Tente novamente.",
      );
    } finally {
      setSyncing(false);
    }
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          Conecte um workspace do Notion para o Jarvis usar seus dados como fonte.
        </p>
        <Button render={<a href="/api/notion/connect" />} nativeButton={false}>
          Conectar Notion
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">
        Conectado a <span className="text-foreground">{workspaceName ?? "Notion"}</span>
        {lastSyncedAt
          ? ` · última sincronização ${new Date(lastSyncedAt).toLocaleString("pt-BR")}`
          : " · ainda não sincronizado"}
      </p>
      <div className="flex items-center gap-2">
        <Button onClick={sync} disabled={syncing}>
          {syncing ? "Sincronizando..." : "Sincronizar agora"}
        </Button>
        <Button render={<a href="/api/notion/connect" />} nativeButton={false} variant="outline">
          Reconectar
        </Button>
      </div>
      {result ? <p className="text-sm text-muted-foreground">{result}</p> : null}
    </div>
  );
}
