"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { JANELAS } from "@/lib/marketing/youtube-janelas";

/**
 * Seletor de canal e de janela do painel de dados do dono.
 *
 * Um canal por vez, e não os dois lado a lado: são ~12 consultas ao Google por
 * canal, e o detalhe (top vídeos, termos de busca, demografia) só faz sentido
 * lido por canal — CPPEM e Colégio têm públicos e formatos sem nada em comum.
 *
 * O estado vive na URL para o link ser compartilhável e o botão voltar funcionar,
 * mesmo padrão da competência das metas. As janelas vêm de `youtube-janelas.ts`
 * porque a página também precisa delas para validar o parâmetro — e constante
 * exportada daqui chegaria lá como referência, não como array.
 */

export function YoutubeAnalyticsControles({
  canais,
  canalAtual,
  dias,
}: {
  canais: { channelId: string; titulo: string }[];
  canalAtual: string;
  dias: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const navegar = (chave: string, valor: string) => {
    const qs = new URLSearchParams(searchParams.toString());
    qs.set(chave, valor);
    qs.set("aba", "youtube"); // não perder a aba ao navegar
    router.replace(`${pathname}?${qs}`, { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Um único canal não é escolha — o seletor só apareceria para enfeitar. */}
      {canais.length > 1 ? (
        <select
          aria-label="Canal"
          value={canalAtual}
          onChange={(e) => navegar("ytCanal", e.target.value)}
          className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none scheme-light dark:scheme-dark"
        >
          {canais.map((c) => (
            <option
              key={c.channelId}
              value={c.channelId}
              className="bg-background text-foreground"
            >
              {c.titulo}
            </option>
          ))}
        </select>
      ) : null}

      <div className="flex overflow-hidden rounded-lg border border-input">
        {JANELAS.map((j) => (
          <button
            key={j.dias}
            type="button"
            onClick={() => navegar("ytDias", String(j.dias))}
            className={
              j.dias === dias
                ? "bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground"
                : "bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted"
            }
          >
            {j.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
