"use client";

import { useCallback, useEffect, useState } from "react";
import { IconEye, IconEyeOff, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/financeiro/search-select";
import { cn } from "@/lib/utils";
import {
  PERIODICIDADES,
  type BusinessUnit,
  type FinCategoria,
  type FinColaborador,
  type FinRecorrencia,
} from "@/lib/financeiro/types";

/**
 * Aba Recorrências (Passo 8). Despesas fixas que se materializam em despesa+parcela
 * por competência. "Gerar do mês" é idempotente (não duplica). Editar a recorrência
 * não mexe em parcelas já geradas.
 */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const selectCls =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const optionCls = "bg-background text-foreground";

async function send(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j;
}

interface Dim {
  bus: BusinessUnit[];
  categorias: FinCategoria[];
  colaboradores: FinColaborador[];
}

export function RecorrenciasPanel() {
  const [lista, setLista] = useState<FinRecorrencia[]>([]);
  const [dim, setDim] = useState<Dim | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [dialog, setDialog] = useState<FinRecorrencia | "novo" | null>(null);
  const [competencia, setCompetencia] = useState(new Date().toISOString().slice(0, 7));

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rec, cat, bus, col] = await Promise.all([
        fetch("/api/financeiro/recorrencias").then((r) => r.json()),
        fetch("/api/financeiro/categorias").then((r) => r.json()),
        fetch("/api/financeiro/bus").then((r) => r.json()),
        fetch("/api/financeiro/colaboradores").then((r) => r.json()),
      ]);
      if (rec.error) throw new Error(rec.error);
      setLista(rec.recorrencias ?? []);
      setDim({
        bus: (bus.bus ?? []).filter((b: BusinessUnit) => b.ativo),
        categorias: (cat.categorias ?? []).filter(
          (c: FinCategoria) => c.ativo && c.tipo !== "receita",
        ),
        colaboradores: (col.colaboradores ?? []).filter((c: FinColaborador) => c.ativo),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const runAction = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refetch();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const gerar = () =>
    void runAction(async () => {
      const j = await send("/api/financeiro/recorrencias/materializar", "POST", {
        competencia,
      });
      const [ano, mes] = competencia.split("-");
      let msg = `${mes}/${ano}: ${j.gerados} despesa(s) gerada(s), ${j.pulados} já existia(m).`;
      if (j.erros?.length) msg += ` Erros: ${j.erros.join("; ")}`;
      setAviso(msg);
    });

  const remove = (r: FinRecorrencia) => {
    setError(null);
    void runAction(() => send(`/api/financeiro/recorrencias/${r.id}`, "DELETE"));
  };

  const buNome = (id: string) => dim?.bus.find((b) => b.id === id)?.nome ?? "—";
  const catNome = (id: string) => dim?.categorias.find((c) => c.id === id)?.nome ?? "—";

  if (loading && lista.length === 0)
    return <p className="text-sm text-muted-foreground">Carregando…</p>;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold">Recorrências</h2>
          <p className="text-xs text-muted-foreground">
            Despesas fixas que geram a conta do mês automaticamente
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={!dim}
          onClick={() => setDialog("novo")}
        >
          <IconPlus className="h-4 w-4" />
          Nova recorrência
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        <span className="text-xs text-muted-foreground">Gerar despesas da competência:</span>
        <Input
          type="month"
          className="h-8 w-40"
          value={competencia}
          onChange={(e) => setCompetencia(e.target.value)}
        />
        <Button size="sm" onClick={gerar} disabled={!dim}>
          Gerar do mês
        </Button>
        <span className="text-[11px] text-muted-foreground">
          (idempotente — rodar de novo não duplica)
        </span>
      </div>

      {aviso && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {aviso}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {lista.map((r) => (
          <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className={cn(!r.ativo && "text-muted-foreground line-through")}>
              {r.descricao}
            </span>
            <span className="text-xs text-muted-foreground">{catNome(r.categoria_id)}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {buNome(r.bu_id)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {r.periodicidade} · dia {r.dia_vencimento}
            </span>
            <span className="ml-auto tabular-nums">{brl.format(r.valor_previsto)}</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setDialog(r)}
                title="Editar"
              >
                <IconPencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() =>
                  void runAction(() =>
                    send(`/api/financeiro/recorrencias/${r.id}`, "PATCH", { ativo: !r.ativo }),
                  )
                }
                title={r.ativo ? "Inativar" : "Reativar"}
              >
                {r.ativo ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => remove(r)}
                title="Excluir"
              >
                <IconTrash className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
        {lista.length === 0 && (
          <li className="px-3 py-6 text-center text-muted-foreground">
            Nenhuma recorrência ainda.
          </li>
        )}
      </ul>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog !== null && dim && (
          <RecorrenciaForm
            item={dialog === "novo" ? null : dialog}
            dim={dim}
            onSaved={() => { setDialog(null); void refetch(); }}
          />
        )}
      </Dialog>
    </section>
  );
}

function RecorrenciaForm({
  item,
  dim,
  onSaved,
}: {
  item: FinRecorrencia | null;
  dim: Dim;
  onSaved: () => void;
}) {
  const [descricao, setDescricao] = useState(item?.descricao ?? "");
  const [categoriaId, setCategoriaId] = useState(item?.categoria_id ?? "");
  const [buId, setBuId] = useState(item?.bu_id ?? dim.bus[0]?.id ?? "");
  const [colaboradorId, setColaboradorId] = useState(item?.colaborador_id ?? "");
  const [valor, setValor] = useState(item ? String(item.valor_previsto) : "");
  const [dia, setDia] = useState(item ? String(item.dia_vencimento) : "5");
  const [periodicidade, setPeriodicidade] = useState(item?.periodicidade ?? "mensal");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (!categoriaId) throw new Error("Selecione a categoria.");
      if (!buId) throw new Error("Selecione a BU.");
      const body = {
        descricao,
        categoria_id: categoriaId,
        bu_id: buId,
        colaborador_id: colaboradorId || null,
        valor_previsto: Number(valor),
        dia_vencimento: Number(dia),
        periodicidade,
      };
      if (item) await send(`/api/financeiro/recorrencias/${item.id}`, "PATCH", body);
      else await send("/api/financeiro/recorrencias", "POST", body);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent className="w-[min(34rem,94vw)] max-w-none sm:max-w-none">
      <DialogHeader>
        <DialogTitle>{item ? "Editar recorrência" : "Nova recorrência"}</DialogTitle>
      </DialogHeader>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-1">
          <Label>Descrição</Label>
          <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label>Categoria</Label>
            <SearchSelect
              value={categoriaId}
              onChange={setCategoriaId}
              options={dim.categorias.map((c) => ({ value: c.id, label: c.nome }))}
              placeholder="— selecione —"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Business Unit</Label>
            <SearchSelect
              value={buId}
              onChange={setBuId}
              options={dim.bus.map((b) => ({ value: b.id, label: b.nome }))}
              placeholder="— selecione —"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Colaborador/Fornecedor (se pessoal)</Label>
          <SearchSelect
            value={colaboradorId}
            onChange={setColaboradorId}
            options={dim.colaboradores.map((c) => ({ value: c.id, label: c.nome }))}
            allowEmpty
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <Label>Valor</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Dia venc.</Label>
            <Input
              type="number"
              min="1"
              max="31"
              value={dia}
              onChange={(e) => setDia(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Periodicidade</Label>
            <select
              className={selectCls}
              value={periodicidade}
              onChange={(e) => setPeriodicidade(e.target.value as FinRecorrencia["periodicidade"])}
            >
              {PERIODICIDADES.map((p) => (
                <option key={p} value={p} className={optionCls}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
        {periodicidade === "anual" && (
          <p className="text-[11px] text-muted-foreground">
            Anual gera apenas no mês de criação da recorrência.
          </p>
        )}
        {err && <p className="text-xs text-destructive">{err}</p>}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
          <Button type="submit" disabled={busy}>
            {busy ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
