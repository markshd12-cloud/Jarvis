"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Faixa de conexão do YouTube Nível B (dados do dono do canal).
 *
 * UMA AUTORIZAÇÃO COBRE TODOS OS CANAIS DA CONTA. Isto contraria o desenho
 * anterior, que pedia uma conexão por canal e travou por completo: os canais
 * CPPEM e Everton são CONTAS DE MARCA, e o Google não as oferece no seletor da
 * tela de consentimento. Testado na prática — o token obtido pelo Colégio lê o
 * CPPEM Concursos sem reclamar, porque a Analytics API recebe o canal como
 * parâmetro e só exige que a conta autorizada o administre.
 *
 * Por isso a tela mostra a CONTA conectada e os canais que ela alcança, e não
 * uma lista de canais a conectar um a um.
 */
export interface CanalCoberto {
  channelId: string;
  titulo: string;
}

export interface ContaYoutube {
  /** Canal próprio da conta autorizada — é o que o Google devolve no callback. */
  channelId: string;
  titulo: string | null;
  /** Sem refresh_token a conexão morre em 1h e precisa ser refeita. */
  temRefresh: boolean;
}

const RECADOS: Record<string, { texto: string; erro: boolean }> = {
  conectado: { texto: "Conta conectada.", erro: false },
  negado: { texto: "Autorização cancelada no Google.", erro: true },
  erro: { texto: "Falha ao conectar — tente de novo.", erro: true },
  "state-invalido": {
    texto: "Sessão de autorização expirada. Comece de novo.",
    erro: true,
  },
  "sem-canal": {
    texto: "O Google não devolveu nenhum canal para essa conta.",
    erro: true,
  },
  "sem-credencial": {
    texto: "Faltam GOOGLE_CLIENT_ID/SECRET no ambiente.",
    erro: true,
  },
  "sem-permissao": { texto: "Você não tem permissão para conectar.", erro: true },
};

export function YoutubeConexoes({
  conta,
  canais,
  podeGerenciar,
}: {
  conta: ContaYoutube | null;
  canais: CanalCoberto[];
  podeGerenciar: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState(false);
  const recado = RECADOS[searchParams.get("youtube") ?? ""];

  const desconectar = async () => {
    if (!conta) return;
    setBusy(true);
    try {
      await fetch(
        `/api/youtube/conexoes?channelId=${encodeURIComponent(conta.channelId)}`,
        { method: "DELETE" },
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Dados do dono do canal</h3>
          <p className="text-xs text-muted-foreground">
            Destrava o número exato de inscritos ganhos e perdidos, tempo de exibição
            e retenção. A leitura pública arredonda os inscritos e esconde a variação
            do mês.
          </p>
        </div>
        {/* `nativeButton={false}`: o Base UI avisa quando um Button renderiza algo
            que não é <button> — aqui é um <a>, porque conectar é uma navegação de
            verdade. Mesmo padrão do Notion e do Conta Azul. */}
        {podeGerenciar && !conta ? (
          <Button
            variant="outline"
            size="sm"
            render={<a href="/api/youtube/connect" />}
            nativeButton={false}
          >
            Conectar conta do Google
          </Button>
        ) : null}
      </div>

      {recado ? (
        <p
          className={cn(
            "text-xs",
            recado.erro ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
          )}
        >
          {recado.texto}
        </p>
      ) : null}

      {conta ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
              conectado
            </span>
            <span className="text-muted-foreground">
              autorizado por{" "}
              <span className="font-medium text-foreground">
                {conta.titulo ?? conta.channelId}
              </span>
            </span>

            {/* Sem refresh_token o acesso expira em ~1h e não há como renovar
                sozinho — precisa de nova autorização. Avisar antes de quebrar. */}
            {!conta.temRefresh ? (
              <span
                className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400"
                title="Reconecte para obter um refresh token — sem ele o acesso expira em 1 hora."
              >
                sem renovação automática
              </span>
            ) : null}

            {podeGerenciar ? (
              <button
                type="button"
                onClick={() => void desconectar()}
                disabled={busy}
                className="ml-auto text-[11px] text-muted-foreground hover:text-destructive"
              >
                desconectar
              </button>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground">
            Cobre {canais.length === 1 ? "o canal" : "os canais"}{" "}
            {canais.map((c) => c.titulo).join(" e ")} — a mesma autorização vale para
            todos os canais que essa conta administra.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Nenhuma conta conectada. Uma única autorização cobre{" "}
          {canais.map((c) => c.titulo).join(" e ")}.
        </p>
      )}
    </div>
  );
}
