"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { MoneyInput } from "@/components/financeiro/money-input";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { MetaComAtual } from "@/lib/marketing/metas";

/**
 * Aba Metas do Marketing: uma linha por alvo, com a meta do mês, o que aconteceu
 * e a distância entre os dois.
 *
 * A meta é digitada aqui mesmo — não há tela de cadastro separada. Alvo sem meta
 * aparece com o campo vazio, porque sumir com ele esconderia justamente o que
 * falta preencher.
 */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const num = new Intl.NumberFormat("pt-BR");

function fmt(v: number | null, unidade: "brl" | "num"): string {
  if (v == null) return "—";
  return unidade === "brl" ? brl.format(v) : num.format(Math.round(v));
}

/**
 * Rótulo curto do que a meta cobra, para o cabeçalho de cada bloco.
 *
 * Um grupo aqui só aparece se `alvosDeMeta()` devolver linhas daquela métrica —
 * a lista abaixo tem que ESPELHAR o que o servidor produz. Havia um grupo `cac`
 * que nunca renderizava (o servidor não devolve CAC de propósito: é meta de
 * custo, não alavanca do Marketing — ver `lib/marketing/metas.ts`); ficava como
 * texto morto contradizendo a decisão.
 */
const GRUPOS: { metrica: string; titulo: string; ajuda: string }[] = [
  {
    metrica: "custo_resultado",
    titulo: "Custo por resultado",
    ajuda:
      "Quanto se paga por cada resultado da campanha. Cada marca conta o que a campanha dela produz — lead ou conversa de WhatsApp. Meta é TETO: quanto menor, melhor.",
  },
  {
    metrica: "seguidores_ig",
    titulo: "Seguidores no Instagram",
    ajuda:
      "Ganho de seguidores no mês (não o total). Meta é PISO: quanto maior, melhor.",
  },
  {
    metrica: "seguidores_yt",
    titulo: "Inscritos no YouTube",
    ajuda:
      "Ganho LÍQUIDO de inscritos no mês — ganhos menos perdidos, direto da conta do dono do canal. O número público do YouTube é arredondado e não serve para medir o mês. Meta é PISO: quanto maior, melhor.",
  },
];

/**
 * Campo da meta. Salva ao sair do campo e ao teclar Enter — o mesmo
 * comportamento da meta do DRE, incluindo o `preventDefault` no Enter, sem o
 * qual o evento escapa para o formulário ancestral e recarrega a página.
 */
function CampoMeta({
  item,
  competencia,
  onSaved,
}: {
  item: MetaComAtual;
  competencia: string;
  onSaved: () => void;
}) {
  const [v, setV] = useState(item.valor == null ? "" : String(item.valor));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const salvar = async () => {
    const limpo = v.trim();
    const novo = limpo === "" ? null : Number(limpo);
    if (novo === (item.valor ?? null)) return; // sem mudança — não grava
    setBusy(true);
    setErr(false);
    try {
      const res = await fetch("/api/marketing/metas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          metrica: item.metrica,
          alvo: item.alvo,
          competencia,
          valor: novo,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      onSaved();
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };

  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.currentTarget.blur();
  };

  const classe = cn(
    "h-7 w-32 border-dashed text-right text-sm tabular-nums",
    err && "border-destructive",
  );

  /**
   * Aviso de ordem de grandeza — AVISO, não bloqueio.
   *
   * Dispara quando o número digitado passa de 10× o ganho médio dos últimos
   * meses. Foi o caso dos 110.000 num perfil que cresce ~1.000/mês: 93× a
   * média, e nada na tela questionou.
   *
   * Não bloqueia porque meta ambiciosa existe e é legítima — a tela levanta a
   * dúvida e deixa a decisão com quem tem o contexto.
   */
  const media = item.baseline?.mediaHistorica ?? null;
  const digitado = Number(v.replace(/\./g, "").replace(",", "."));
  const implausivel =
    media != null && media > 0 && Number.isFinite(digitado) && digitado > media * 10;

  // Dinheiro usa a máscara BRL; seguidores são inteiros simples.
  const campo =
    item.unidade === "brl" ? (
      <MoneyInput
        value={v}
        onChange={setV}
        onBlur={() => void salvar()}
        onKeyDown={enter}
        placeholder="meta…"
        disabled={busy}
        className={classe}
      />
    ) : (
      <Input
        value={v}
        onChange={(e) => setV(e.target.value.replace(/\D/g, ""))}
        onBlur={() => void salvar()}
        onKeyDown={enter}
        placeholder="meta…"
        disabled={busy}
        inputMode="numeric"
        className={classe}
      />
    );

  if (!implausivel) return campo;

  return (
    <span className="flex flex-col items-end gap-0.5">
      {campo}
      <span className="max-w-52 text-right text-[10px] leading-tight text-amber-600 dark:text-amber-400">
        {Math.round(digitado / (media as number))}× o ganho médio. Quis dizer o
        TOTAL de seguidores? Aqui a meta é o ganho DO MÊS.
      </span>
    </span>
  );
}

/** Onde a conta está hoje e quanto ela costuma crescer — a ordem de grandeza. */
function Regua({ item }: { item: MetaComAtual }) {
  const b = item.baseline;
  if (!b || (b.atualAbsoluto == null && b.mediaHistorica == null)) return null;

  const partes: string[] = [];
  if (b.atualAbsoluto != null) partes.push(`hoje ${num.format(b.atualAbsoluto)}`);
  if (b.mediaHistorica != null)
    partes.push(`média 3 meses ${num.format(Math.round(b.mediaHistorica))}/mês`);

  return (
    <span className="block truncate text-[11px] text-muted-foreground/80">
      {partes.join(" · ")}
    </span>
  );
}

/** Esperado até hoje e projeção do mês — a leitura justa antes de fechar. */
function Ritmo({ item }: { item: MetaComAtual }) {
  const r = item.ritmo;
  if (!r || item.atual == null) return null;
  return (
    <span
      className="block truncate text-[11px] text-muted-foreground/80"
      title={`Ritmo linear sobre ${r.diasDecorridos} de ${r.diasNoMes} dias (última coleta ${r.ultimaColeta}). Aproximação: campanha concentrada no fim do mês quebra a hipótese.`}
    >
      esperado até hoje {fmt(r.esperadoAteHoje, item.unidade)}
      {r.projecao != null ? ` · projeção ${fmt(r.projecao, item.unidade)}` : ""}
    </span>
  );
}

/**
 * Desvio já vem calculado como "positivo = melhor que o planejado", nos dois
 * tipos de meta — a mesma convenção do DRE, para não exigir que o leitor lembre
 * se aquela linha é teto ou piso.
 */
function Desvio({ item }: { item: MetaComAtual }) {
  if (item.desvio == null)
    return <span className="text-xs text-muted-foreground/60">—</span>;

  /**
   * Métrica ACUMULADA no mês corrente compara contra o **esperado até hoje**,
   * não contra a meta cheia.
   *
   * Sem isto, uma meta de seguidores nasce vermelha no dia 1º e vai esverdeando
   * até o dia 30 — e a cor deixa de significar "está ruim" para significar "o
   * mês ainda não acabou". Três semanas de vermelho falso por mês ensinam o time
   * a ignorar a coluna inteira.
   */
  const usaRitmo = item.ritmo != null && item.atual != null;
  const referencia = usaRitmo ? (item.ritmo as NonNullable<typeof item.ritmo>).esperadoAteHoje : (item.valor ?? 0);
  const desvio = usaRitmo
    ? item.direcao === "max"
      ? referencia - (item.atual as number)
      : (item.atual as number) - referencia
    : item.desvio;

  const bom = desvio >= 0;
  const base = usaRitmo ? referencia : (item.valor ?? 0);
  const pct = base > 0 ? (desvio / base) * 100 : null;
  if (usaRitmo)
    return (
      <span
        className={cn(
          "tabular-nums",
          bom
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-500 dark:text-red-400",
        )}
        title={`Comparado ao esperado até hoje (${fmt(referencia, item.unidade)}), não à meta cheia do mês`}
      >
        {desvio > 0 ? "+" : ""}
        {fmt(desvio, item.unidade)}
        <span className="block text-[10px] font-normal opacity-80">no ritmo</span>
      </span>
    );
  return (
    <span
      className={cn(
        "tabular-nums",
        bom
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-red-500 dark:text-red-400",
      )}
      title={bom ? "Melhor que o planejado" : "Pior que o planejado"}
    >
      {item.desvio > 0 ? "+" : ""}
      {fmt(item.desvio, item.unidade)}
      {pct != null ? (
        <span className="block text-[10px] font-normal opacity-80">
          {pct > 0 ? "+" : ""}
          {pct.toFixed(1).replace(".", ",")}%
        </span>
      ) : null}
    </span>
  );
}

export function MarketingMetasPanel({
  metas,
  competencia,
  competencias,
  podeEditar,
}: {
  metas: MetaComAtual[];
  competencia: string;
  competencias: string[];
  /** `marketing:gerenciar` — sem isso a tela é só leitura. */
  podeEditar: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * Depois de gravar, os dados vêm do servidor — é preciso buscá-los de novo.
   * `router.refresh()` re-renderiza só os Server Components e MANTÉM o estado do
   * cliente; um `location.reload()` recarregaria a página inteira e devolveria o
   * usuário à primeira aba, além de refazer as doze integrações do /marketing.
   */
  const recarregar = () => router.refresh();

  /** Troca a competência pela URL, sem recarga total. */
  const trocarCompetencia = (c: string) => {
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("comp", c);
    qs.set("aba", "metas"); // não perder a aba ao navegar
    router.replace(`${pathname}?${qs}`, { scroll: false });
  };

  return (
    // `div`, não `section`: aqui `section` é camada estrutural de página com
    // `min-h-full` (globals.css / agents/AGENTS.md), e esticaria o painel.
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Metas do mês</h2>
          <p className="text-xs text-muted-foreground">
            O que foi planejado contra o que está acontecendo. Digite direto na coluna
            Meta — Enter confirma.
          </p>
        </div>
        {/* Sem <form>: não há submit — a troca navega pela URL. */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground" htmlFor="comp">
            Competência
          </label>
          <select
            id="comp"
            value={competencia}
            onChange={(e) => trocarCompetencia(e.target.value)}
            className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none scheme-light dark:scheme-dark"
          >
            {competencias.map((c) => (
              <option key={c} value={c} className="bg-background text-foreground">
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {GRUPOS.map((g) => {
        const linhas = metas.filter((m) => m.metrica === g.metrica);
        if (linhas.length === 0) return null;
        return (
          <div key={g.metrica} className="flex flex-col gap-2">
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {g.titulo}
              </h3>
              <p className="text-[11px] text-muted-foreground">{g.ajuda}</p>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="grid grid-cols-[1fr_9rem_8rem_8rem] items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span>Alvo</span>
                <span className="pr-4 text-right">Meta</span>
                <span className="text-right">Atual</span>
                <span className="text-right">Desvio</span>
              </div>

              <div className="divide-y divide-border/60">
                {linhas.map((m) => (
                  <div
                    key={`${m.metrica}|${m.alvo}`}
                    className="fin-row grid grid-cols-[1fr_9rem_8rem_8rem] items-center gap-2 px-4 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{m.rotulo}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {m.detalhe}
                      </span>
                      {/* A RÉGUA. Alguém cadastrou 110.000 num perfil de 93.175
                          seguidores querendo dizer "chegar a 110 mil"; a
                          métrica é ganho no mês. O cabeçalho do bloco já
                          avisava e não bastou — texto explicando não compete
                          com um campo vazio pedindo um número. Com a ordem de
                          grandeza ao lado, ninguém digita 110.000. */}
                      <Regua item={m} />
                      <Ritmo item={m} />
                    </span>

                    <span className="flex justify-end pr-4">
                      {podeEditar ? (
                        <CampoMeta
                          key={`${m.metrica}|${m.alvo}|${competencia}|${m.valor}`}
                          item={m}
                          competencia={competencia}
                          onSaved={recarregar}
                        />
                      ) : (
                        <span className="text-sm tabular-nums">
                          {fmt(m.valor, m.unidade)}
                        </span>
                      )}
                    </span>

                    <span className="text-right text-sm tabular-nums">
                      {fmt(m.atual, m.unidade)}
                      {/* Perder seguidor é diferente de crescer menos que a meta,
                          e a cor do desvio sozinha não distingue os dois. */}
                      {m.regressao ? (
                        <span className="block text-[10px] font-medium text-red-500 dark:text-red-400">
                          queda
                        </span>
                      ) : null}
                    </span>

                    <span className="text-right text-sm">
                      <Desvio item={m} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}

      {/* Os inscritos do YouTube ESTAVAM listados aqui como "ainda de fora", pelo
          arredondamento da API pública. Deixou de valer quando o OAuth do dono
          entrou: hoje há bloco de YouTube na tabela acima, e o texto contradizia
          a própria tela. O que segue de fora, segue por outros motivos. */}
      <p className="text-[11px] text-muted-foreground">
        <strong>Fora desta tela de propósito:</strong> o <strong>CAC</strong> não é meta
        do Marketing — é meta de custo, e quem decide o quanto se gasta em Comercial não
        é quem faz campanha. Ele é consequência das metas acima e fica como leitura na
        aba própria. A <strong>receita do YouTube</strong> fica de fora por falta de
        dado: canais não monetizados não devolvem valor nenhum.
      </p>
    </div>
  );
}
