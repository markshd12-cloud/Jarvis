"use client";

import { Button } from "@/components/ui/button";

/**
 * Conexão da Conta Azul (scaffold). Espelha o fluxo do Notion, mas os dados
 * alimentam o DASHBOARD (pessoas, vendas, financeiro), não o RAG.
 *
 * ⚠️ Pendente para ligar de verdade: rotas OAuth `/api/contaazul/{connect,callback}`
 * e a migration `contaazul_connections`. Enquanto isso, o botão já aponta para o
 * fluxo previsto.
 */
export function ContaAzulConnect({
  connected,
  accountName,
  lastSyncedAt,
}: {
  connected: boolean;
  accountName: string | null;
  lastSyncedAt: string | null;
}) {
  if (!connected) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          Conecte a Conta Azul para trazer pessoas, vendas e financeiro para o
          Dashboard.
        </p>
        <Button render={<a href="/api/contaazul/connect" />} nativeButton={false}>
          Conectar Conta Azul
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted-foreground">
        Conectado a{" "}
        <span className="text-foreground">{accountName ?? "Conta Azul"}</span>
        {lastSyncedAt
          ? ` · última sincronização ${new Date(lastSyncedAt).toLocaleString("pt-BR")}`
          : " · ainda não sincronizado"}
      </p>
      <Button
        render={<a href="/api/contaazul/connect" />}
        nativeButton={false}
        variant="outline"
      >
        Reconectar
      </Button>
    </div>
  );
}
