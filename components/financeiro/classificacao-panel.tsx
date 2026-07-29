"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconRefresh, IconInfoCircle } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { sugerirCentro, type Confianca } from "@/lib/financeiro/classificar-centro";
import { matchCentroIdeal } from "@/lib/financeiro/centros-ideal";

/**
 * Aba "Classificação sugerida" (Plano 4, Fase 3): para cada categoria de DESPESA,
 * sugere o Centro de Custo pelo nome (arquivo "Categorias de Despesas e
 * Receitas.md"). READ-ONLY — é um assistente para padronizar a categorização no
 * Conta Azul; NÃO grava nada. Ver `docs/financeiro-centros-ideal.md`.
 */
interface CategoriaApi {
  id: string;
  nome: string;
  tipo: "receita" | "despesa";
  ativo: boolean;
}

interface Linha {
  id: string;
  nome: string;
  ativo: boolean;
  centro: string | null;
  confianca: Confianca;
  motivo: string;
}

const CONF_CLS: Record<Confianca, string> = {
  alta: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  media: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  baixa: "bg-muted text-muted-foreground",
};
const CONF_LABEL: Record<Confianca, string> = { alta: "Alta", media: "Média", baixa: "—" };

export function ClassificacaoPanel() {
  const [cats, setCats] = useState<CategoriaApi[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const j = (await fetch("/api/financeiro/categorias").then((r) => r.json())) as
        | { categorias: CategoriaApi[] }
        | { error: string };
      if ("error" in j) throw new Error(j.error);
      setCats(j.categorias);
    } catch (e) {
      setErro((e as Error).message);
      setCats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const { linhas, stats } = useMemo(() => {
    const despesa = (cats ?? []).filter((c) => c.tipo === "despesa");
    const ls: Linha[] = despesa.map((c) => {
      const s = sugerirCentro(c.nome);
      return { id: c.id, nome: c.nome, ativo: c.ativo, centro: s.centro, confianca: s.confianca, motivo: s.motivo };
    });
    // Ordena por centro (sem sugestão por último), depois por nome.
    ls.sort((a, b) => {
      const ca = a.centro ?? "￿";
      const cb = b.centro ?? "￿";
      return ca === cb ? a.nome.localeCompare(b.nome) : ca.localeCompare(cb);
    });
    const total = ls.length;
    const alta = ls.filter((l) => l.confianca === "alta").length;
    const media = ls.filter((l) => l.confianca === "media").length;
    const sem = ls.filter((l) => !l.centro).length;
    return { linhas: ls, stats: { total, alta, media, sem } };
  }, [cats]);

  const pctIdeal = (centro: string | null): string => {
    if (!centro) return "";
    const ideal = matchCentroIdeal(centro);
    return ideal ? `${ideal.minPct}–${ideal.maxPct}%` : "";
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold">Classificação sugerida por Centro de Custo</h2>
          <p className="text-xs text-muted-foreground">
            Sugestão automática pelo nome da categoria (arquivo de Categorias). Somente leitura —
            use para padronizar a categorização no Conta Azul.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void refetch()}
          disabled={loading}
        >
          <IconRefresh className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Atualizar
        </Button>
      </div>

      {/* Aviso de que é assistivo */}
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3">
        <IconInfoCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Heurística por palavra-chave — <strong>confira antes de aplicar</strong>. Confiança{" "}
          <strong>Alta</strong> = termo inequívoco; <strong>Média</strong> = provável, revisar;{" "}
          <strong>—</strong> = não reconhecido (classifique manualmente).
        </p>
      </div>

      {erro && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {erro}
        </p>
      )}

      {/* Cobertura */}
      {cats && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-muted px-2.5 py-1">
            {stats.total} categorias de despesa
          </span>
          <span className="rounded-full bg-emerald-500/12 px-2.5 py-1 text-emerald-600 dark:text-emerald-400">
            {stats.alta} alta confiança
          </span>
          <span className="rounded-full bg-amber-500/12 px-2.5 py-1 text-amber-600 dark:text-amber-400">
            {stats.media} média
          </span>
          <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
            {stats.sem} sem sugestão
          </span>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Categoria</th>
              <th className="px-3 py-2 font-medium">Centro sugerido</th>
              <th className="px-3 py-2 font-medium">Faixa ideal</th>
              <th className="px-3 py-2 font-medium">Confiança</th>
              <th className="px-3 py-2 font-medium">Termo</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  {l.nome}
                  {!l.ativo ? (
                    <span className="ml-2 text-[10px] uppercase text-muted-foreground">inativo</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  {l.centro ?? <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{pctIdeal(l.centro)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${CONF_CLS[l.confianca]}`}>
                    {CONF_LABEL[l.confianca]}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {l.centro ? l.motivo : ""}
                </td>
              </tr>
            ))}
            {linhas.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  {erro ? "Não foi possível carregar." : "Nenhuma categoria de despesa."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
