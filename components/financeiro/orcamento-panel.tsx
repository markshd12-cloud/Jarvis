"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconBulb, IconDeviceFloppy, IconPlus, IconTrash } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ConfirmDialog,
  type Confirmacao,
} from "@/components/financeiro/confirm-dialog";
import { MoneyInput } from "@/components/financeiro/money-input";
import { SearchSelect } from "@/components/financeiro/search-select";
import { cn } from "@/lib/utils";
import type {
  BusinessUnit,
  FinCategoria,
  OrcamentoLinha,
  OrcamentoSugestaoLinha,
} from "@/lib/financeiro/types";

/**
 * Aba Orçamento & Limite (Passo 9). Meta por categoria × BU × competência, com o
 * comparativo Meta (=orçado) × Lançado (=previsto) × Realizado × Limite (lançado/
 * realizado vêm das parcelas). "Sugerir" pré-preenche a Meta com a MÉDIA mensal do custo
 * dos últimos N meses — a previsão pro próximo mês. Flags de estouro são live
 * (recalculados enquanto edita). Salvar faz upsert idempotente por linha.
 */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const MESES_OPCOES = [3, 6, 12];

const key = (catId: string, buId: string | null) => `${catId}|${buId ?? ""}`;

async function send(url: string, method: "POST" | "DELETE", body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

function competenciaAtual(): string {
  return new Date().toISOString().slice(0, 7);
}
/** 'AAAA-MM' ± n meses. */
function addMeses(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Editavel = { orcado: string; limite: string };

export function OrcamentoPanel() {
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [meses, setMeses] = useState(3);
  const [linhas, setLinhas] = useState<OrcamentoLinha[]>([]);
  const [edit, setEdit] = useState<Map<string, Editavel>>(new Map());
  const [cats, setCats] = useState<FinCategoria[]>([]);
  const [bus, setBus] = useState<BusinessUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // adicionar linha nova (categoria sem histórico/meta)
  const [novaCat, setNovaCat] = useState("");
  const [novaBu, setNovaBu] = useState("");
  const [confirmar, setConfirmar] = useState<Confirmacao | null>(null);
  /**
   * FILTROS da tabela (categoria/BU). Não confundir com os campos de "Adicionar
   * linha" no rodapé: aqueles CRIAM uma meta; estes só filtram o que já está
   * na tela. Ficam no topo, junto da competência, que é onde se procura filtro.
   */
  const [filtroCat, setFiltroCat] = useState("");
  const [filtroBu, setFiltroBu] = useState("");

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [orc, cat, bu] = await Promise.all([
        fetch(`/api/financeiro/orcamentos?competencia=${competencia}`).then((r) => r.json()),
        fetch("/api/financeiro/categorias").then((r) => r.json()),
        fetch("/api/financeiro/bus").then((r) => r.json()),
      ]);
      if (orc.error) throw new Error(orc.error);
      const ls = (orc.linhas ?? []) as OrcamentoLinha[];
      setLinhas(ls);
      setEdit(
        new Map(
          ls.map((l) => [
            key(l.categoria_id, l.bu_id),
            { orcado: l.orcado ? String(l.orcado) : "", limite: l.limite != null ? String(l.limite) : "" },
          ]),
        ),
      );
      // RECEITA entra: a Meta do Faturamento Bruto do DRE nasce daqui (categoria
      // de receita × BU × competência). Receitas primeiro na lista, pra achar fácil.
      const todas = (cat.categorias ?? []).filter((c: FinCategoria) => c.ativo);
      setCats([
        ...todas.filter((c: FinCategoria) => c.tipo === "receita"),
        ...todas.filter((c: FinCategoria) => c.tipo !== "receita"),
      ]);
      setBus((bu.bus ?? []).filter((b: BusinessUnit) => b.ativo));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [competencia]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const catNome = (id: string) => cats.find((c) => c.id === id)?.nome ?? id.slice(0, 8);
  const buNome = (id: string | null) => (id ? bus.find((b) => b.id === id)?.nome ?? "—" : "Todas");

  const setCampo = (k: string, campo: keyof Editavel, valor: string) => {
    setEdit((prev) => {
      const next = new Map(prev);
      const cur = next.get(k) ?? { orcado: "", limite: "" };
      next.set(k, { ...cur, [campo]: valor });
      return next;
    });
  };

  const addLinha = () => {
    if (!novaCat) return;
    const buId = novaBu || null;
    const k = key(novaCat, buId);
    if (linhas.some((l) => key(l.categoria_id, l.bu_id) === k)) {
      setAviso("Essa categoria/BU já está na lista.");
      return;
    }
    setLinhas((prev) => [
      ...prev,
      {
        id: null,
        categoria_id: novaCat,
        bu_id: buId,
        competencia,
        orcado: 0,
        limite: null,
        previsto: 0,
        realizado: 0,
        previstoExcede: false,
        limiteEstourado: false,
      },
    ]);
    setEdit((prev) => new Map(prev).set(k, { orcado: "", limite: "" }));
    setNovaCat("");
    setNovaBu("");
    setAviso(null);
  };

  const sugerir = async () => {
    setError(null);
    setAviso(null);
    setBusy(true);
    try {
      const j = await fetch(
        `/api/financeiro/orcamentos/sugestao?competencia=${competencia}&meses=${meses}`,
      ).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      const sug = (j.linhas ?? []) as OrcamentoSugestaoLinha[];
      // garante linha pra cada categoria/BU sugerida (mesmo sem meta/lançamento neste mês)
      setLinhas((prev) => {
        const vistos = new Set(prev.map((l) => key(l.categoria_id, l.bu_id)));
        const extras: OrcamentoLinha[] = sug
          .filter((s) => !vistos.has(key(s.categoria_id, s.bu_id)))
          .map((s) => ({
            id: null,
            categoria_id: s.categoria_id,
            bu_id: s.bu_id,
            competencia,
            orcado: 0,
            limite: null,
            previsto: 0,
            realizado: 0,
            previstoExcede: false,
            limiteEstourado: false,
          }));
        return [...prev, ...extras];
      });
      setEdit((prev) => {
        const next = new Map(prev);
        for (const s of sug) {
          const k = key(s.categoria_id, s.bu_id);
          const cur = next.get(k) ?? { orcado: "", limite: "" };
          next.set(k, { ...cur, orcado: s.sugerido ? String(s.sugerido) : "" });
        }
        return next;
      });
      const base = (j.competenciasBase ?? []).join(", ");
      setAviso(`Meta preenchida com a média mensal de ${j.meses} meses (${base}). Revise e salve.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const salvar = async () => {
    setError(null);
    setBusy(true);
    try {
      const alvo = linhas.filter((l) => {
        const e = edit.get(key(l.categoria_id, l.bu_id));
        return e && (Number(e.orcado) > 0 || e.limite !== "");
      });
      for (const l of alvo) {
        const e = edit.get(key(l.categoria_id, l.bu_id))!;
        await send("/api/financeiro/orcamentos", "POST", {
          categoria_id: l.categoria_id,
          bu_id: l.bu_id,
          competencia,
          valor_orcado: Number(e.orcado) || 0,
          valor_limite: e.limite === "" ? null : Number(e.limite),
        });
      }
      setAviso(`${alvo.length} meta(s) salva(s).`);
      await refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remover = (l: OrcamentoLinha) => {
    if (!l.id) {
      // linha só local (ainda não salva): some da lista, nada a confirmar
      setLinhas((prev) => prev.filter((x) => x !== l));
      return;
    }
    setConfirmar({
      msg: `Excluir a meta de “${catNome(l.categoria_id)}” (${buNome(l.bu_id)}) em ${competencia}? O Lançado e o Realizado não são afetados — só a meta.`,
      acaoLabel: "Excluir meta",
      onOk: () => {
        setError(null);
        void send(`/api/financeiro/orcamentos/${l.id}`, "DELETE")
          .then(refetch)
          .catch((e) => setError((e as Error).message));
      },
    });
  };

  const ordenadas = useMemo(
    () =>
      [...linhas]
        .filter((l) => (!filtroCat || l.categoria_id === filtroCat))
        // BU "Todas" do orçamento é `null`; o filtro casa o id exato.
        .filter((l) => (!filtroBu || l.bu_id === filtroBu))
        .sort((a, b) => catNome(a.categoria_id).localeCompare(catNome(b.categoria_id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linhas, cats, filtroCat, filtroBu],
  );

  // Totais acompanham o FILTRO (senão o rodapé contradiz o que está na tela).
  const totais = useMemo(() => {
    let orcado = 0, previsto = 0, realizado = 0;
    for (const l of ordenadas) {
      const e = edit.get(key(l.categoria_id, l.bu_id));
      orcado += Number(e?.orcado) || 0;
      previsto += l.previsto;
      realizado += l.realizado;
    }
    return { orcado, previsto, realizado };
  }, [ordenadas, edit]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold">Orçamento &amp; Limite</h2>
          <p className="text-xs text-muted-foreground">
            <strong>Meta</strong> (você planeja) · <strong>Lançado</strong> (já registrado) ·{" "}
            <strong>Realizado</strong> (pago/recebido) — por categoria × BU. A Meta também alimenta o DRE.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <label className="mr-1 text-xs text-muted-foreground">Competência:</label>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCompetencia((c) => addMeses(c, -1))}
            title="Mês anterior"
          >
            ◀
          </Button>
          <Input
            type="month"
            className="h-8 w-40"
            value={competencia}
            onChange={(e) => e.target.value && setCompetencia(e.target.value)}
          />
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCompetencia((c) => addMeses(c, 1))}
            title="Próximo mês"
          >
            ▶
          </Button>
        </div>
      </div>

      {/* FILTROS da tabela — no topo, que é onde se procura por eles. Não
          confundir com "Adicionar linha" (rodapé), que CRIA uma meta nova. */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">Filtrar por categoria</label>
          <div className="w-56">
            <SearchSelect
              value={filtroCat}
              onChange={setFiltroCat}
              options={cats.map((c) => ({ value: c.id, label: c.nome }))}
              allowEmpty
              emptyLabel="Todas as categorias"
              placeholder="Todas as categorias"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">Filtrar por BU</label>
          <div className="w-44">
            <SearchSelect
              value={filtroBu}
              onChange={setFiltroBu}
              options={bus.map((b) => ({ value: b.id, label: b.nome }))}
              allowEmpty
              emptyLabel="Todas as BUs"
              placeholder="Todas as BUs"
            />
          </div>
        </div>
        {(filtroCat || filtroBu) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFiltroCat("");
              setFiltroBu("");
            }}
          >
            Limpar filtros
          </Button>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {ordenadas.length} de {linhas.length} linha(s)
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        <Button variant="outline" size="sm" onClick={sugerir} disabled={busy || loading}>
          <IconBulb className="h-4 w-4" /> Sugerir do histórico
        </Button>
        <select
          className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none [color-scheme:light] dark:[color-scheme:dark]"
          value={meses}
          onChange={(e) => setMeses(Number(e.target.value))}
        >
          {MESES_OPCOES.map((m) => (
            <option key={m} value={m}>
              últimos {m} meses
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted-foreground">média mensal do custo lançado</span>
        <Button size="sm" className="ml-auto" onClick={salvar} disabled={busy || loading}>
          <IconDeviceFloppy className="h-4 w-4" /> Salvar metas
        </Button>
      </div>

      {aviso && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {aviso}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="fin-table w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Categoria</th>
                <th className="px-3 py-2 font-medium">BU</th>
                <th className="px-3 py-2 text-right font-medium" title="Quanto você PLANEJA gastar/faturar no mês (a meta que você define).">
                  Meta
                </th>
                <th className="px-3 py-2 text-right font-medium" title="O que já foi LANÇADO no sistema neste mês — contas registradas, pagas ou não.">
                  Lançado
                </th>
                <th className="px-3 py-2 text-right font-medium" title="O que de fato foi PAGO/RECEBIDO (saiu ou entrou no caixa).">
                  Realizado
                </th>
                <th className="px-3 py-2 text-right font-medium" title="Teto opcional — se o Realizado passar disto, é estouro.">
                  Limite
                </th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((l) => {
                const k = key(l.categoria_id, l.bu_id);
                const e = edit.get(k) ?? { orcado: "", limite: "" };
                const orcadoN = Number(e.orcado) || 0;
                const limiteN = e.limite === "" ? null : Number(e.limite);
                const previstoExcede = orcadoN > 0 && l.previsto > orcadoN;
                const limiteEstourado = limiteN != null && l.realizado > limiteN;
                return (
                  <tr key={k} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-1.5">{catNome(l.categoria_id)}</td>
                    <td className="px-3 py-1.5">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {buNome(l.bu_id)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <MoneyInput
                        value={e.orcado}
                        onChange={(v) => setCampo(k, "orcado", v)}
                        className="h-7 w-32 text-right tabular-nums"
                      />
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1.5 text-right tabular-nums",
                        previstoExcede && "text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {brl.format(l.previsto)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1.5 text-right tabular-nums",
                        limiteEstourado && "font-medium text-destructive",
                      )}
                    >
                      {brl.format(l.realizado)}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <MoneyInput
                        value={e.limite}
                        onChange={(v) => setCampo(k, "limite", v)}
                        className="h-7 w-32 text-right tabular-nums"
                        placeholder="—"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        {previstoExcede && (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                            previsto &gt; orçado
                          </span>
                        )}
                        {limiteEstourado && (
                          <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">
                            limite estourado
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => remover(l)}
                          title="Remover meta"
                        >
                          <IconTrash className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {ordenadas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    Nenhuma meta nem lançamento nesta competência. Use "Sugerir do histórico" ou adicione abaixo.
                  </td>
                </tr>
              )}
            </tbody>
            {ordenadas.length > 0 && (
              <tfoot>
                <tr className="border-t border-border text-xs font-medium">
                  <td className="px-3 py-2" colSpan={2}>
                    Total
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{brl.format(totais.orcado)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{brl.format(totais.previsto)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{brl.format(totais.realizado)}</td>
                  <td className="px-3 py-2" colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Adicionar linha pra uma categoria sem histórico/meta ainda */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-2">
        <p className="w-full text-[11px] font-medium text-muted-foreground">
          ➕ Criar meta para uma categoria que ainda não está na lista{" "}
          <span className="font-normal">(isto adiciona uma linha — não é filtro)</span>
        </p>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">Categoria</label>
          <div className="w-56">
            <SearchSelect
              value={novaCat}
              onChange={setNovaCat}
              options={cats.map((c) => ({ value: c.id, label: c.nome }))}
              placeholder="— selecione —"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">BU</label>
          <div className="w-44">
            <SearchSelect
              value={novaBu}
              onChange={setNovaBu}
              options={bus.map((b) => ({ value: b.id, label: b.nome }))}
              placeholder="Todas"
              allowEmpty
            />
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={addLinha} disabled={!novaCat}>
          <IconPlus className="h-4 w-4" /> Adicionar linha
        </Button>
      </div>

      <ConfirmDialog confirmacao={confirmar} onClose={() => setConfirmar(null)} />
    </section>
  );
}
