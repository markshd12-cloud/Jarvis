"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Conexão do Meta Ads. Diferente de Notion/Conta Azul, NÃO há OAuth: o token
 * (System User) vive no ambiente, então "conectar" é apenas sincronizar. Uma
 * execução cobre as 4 contas e grava em `marketing_daily_insights` (GLOBAL).
 */
export function MetaConnect({
  connected,
  accountName,
  lastSyncedAt,
}: {
  connected: boolean;
  accountName: string | null;
  lastSyncedAt: string | null;
}) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function sync() {
    setSyncing(true);
    setResult("Sincronizando as contas de anúncio… isso pode levar um minuto.");
    try {
      const res = await fetch("/api/marketing/sync", { method: "POST" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as {
        accounts: number;
        days: number;
        upserted: number;
      };
      setResult(
        `Concluído: ${data.accounts} contas, ${data.days} dias, ${data.upserted} linhas atualizadas.`,
      );
    } catch {
      setResult("Falha ao sincronizar. Tente novamente.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">
        {connected ? (
          <>
            Conectado a{" "}
            <span className="text-foreground">{accountName ?? "Meta Ads"}</span>
            {lastSyncedAt
              ? ` · última sincronização ${new Date(lastSyncedAt).toLocaleString("pt-BR")}`
              : " · ainda não sincronizado"}
          </>
        ) : (
          "Configurado via ambiente. Rode a primeira sincronização para trazer os dados das marcas para o Dashboard."
        )}
      </p>
      <Button onClick={sync} disabled={syncing}>
        {syncing ? "Sincronizando..." : "Sincronizar agora"}
      </Button>
      {result ? <p className="text-sm text-muted-foreground">{result}</p> : null}
    </div>
  );
}
