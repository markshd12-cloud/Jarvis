"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconCheckupList,
  IconChevronRight,
  IconPencil,
  IconPlus,
  IconRotate,
  IconTrash,
} from "@tabler/icons-react";

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
  METODOS_PAGAMENTO,
  type BusinessUnit,
  type FinCategoria,
  type FinCentro,
  type FinColaborador,
  type GrupoParcela,
  type ParcelaRow,
  type SituacaoParcela,
} from "@/lib/financeiro/types";

/**
 * Aba Contas a Pagar (Passos 6–7). Lança despesa parcelada; a lista agrupa por
 * DÍVIDA (despesa) e expande nas parcelas. Dá pra editar o parcelamento inteiro
 * e dar BAIXA por parcela (marca paga → alimenta o realizado). Validação dura:
 * `Σ parcelas = valor_total` bloqueia o salvar.
 */
const selectCls =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const optionCls = "bg-background text-foreground";
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const cents = (v: number) => Math.round(v * 100);
const fmtData = (iso: string) => iso.split("-").reverse().join("/");

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

/** Soma n meses a uma data ISO (AAAA-MM-DD), com clamp de dia. */
function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, lastDay));
  return base.toISOString().slice(0, 10);
}

const GRUPOS: { key: GrupoParcela; label: string }[] = [
  { key: "a_vencer", label: "A vencer" },
  { key: "vencida", label: "Vencidas" },
  { key: "pagas", label: "Pagas" },
  { key: "todas", label: "Todas" },
];

interface Dimensoes {
  bus: BusinessUnit[];
  categorias: FinCategoria[];
  centros: FinCentro[];
  colaboradores: FinColaborador[];
}

/** Detalhe carregado do GET /despesas/[id] (p/ o dialog de edição). */
interface DespesaDetalhe {
  id: string;
  descricao: string;
  observacao: string | null;
  categoria_id: string;
  centro_custo_id: string | null;
  colaborador_id: string | null;
  valor_total: number;
  parcelas: {
    numero: number;
    bu_id: string;
    valor_previsto: number;
    data_vencimento: string;
    data_competencia: string;
    metodo_pagamento: string | null;
    data_pagamento: string | null;
  }[];
}

interface Grupo {
  despesa_id: string;
  descricao: string;
  categoria_nome: string | null;
  num_parcelas: number;
  parcelas: ParcelaRow[];
  total: number;
  situacao: SituacaoParcela;
}

export function ContasPagarPanel() {
  const [dim, setDim] = useState<Dimensoes | null>(null);
  const [parcelas, setParcelas] = useState<ParcelaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [editar, setEditar] = useState<DespesaDetalhe | null>(null);
  const [confirmar, setConfirmar] = useState<{ msg: string; onOk: () => void } | null>(null);
  const [baixando, setBaixando] = useState<ParcelaRow | null>(null);
  const [aberto, setAberto] = useState<Set<string>>(new Set());
  const [filtros, setFiltros] = useState({
    grupo: "a_vencer" as GrupoParcela,
    bu_id: "",
    categoria_id: "",
    busca: "",
  });

  useEffect(() => {
    void (async () => {
      try {
        const [cat, bus, cen, col] = await Promise.all([
          fetch("/api/financeiro/categorias").then((r) => r.json()),
          fetch("/api/financeiro/bus").then((r) => r.json()),
          fetch("/api/financeiro/centros").then((r) => r.json()),
          fetch("/api/financeiro/colaboradores").then((r) => r.json()),
        ]);
        setDim({
          bus: (bus.bus ?? []).filter((b: BusinessUnit) => b.ativo),
          categorias: (cat.categorias ?? []).filter(
            (c: FinCategoria) => c.ativo && c.tipo !== "receita",
          ),
          centros: (cen.centros ?? []).filter((c: FinCentro) => c.ativo),
          colaboradores: (col.colaboradores ?? []).filter((c: FinColaborador) => c.ativo),
        });
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("grupo", filtros.grupo);
      if (filtros.bu_id) qs.set("bu_id", filtros.bu_id);
      if (filtros.categoria_id) qs.set("categoria_id", filtros.categoria_id);
      if (filtros.busca.trim()) qs.set("busca", filtros.busca.trim());
      const j = await fetch(`/api/financeiro/despesas?${qs}`).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      setParcelas(j.parcelas ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filtros]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Agrupa as parcelas por dívida (despesa) preservando a ordem de chegada.
  const grupos = useMemo<Grupo[]>(() => {
    const map = new Map<string, Grupo>();
    for (const p of parcelas) {
      let g = map.get(p.despesa_id);
      if (!g) {
        g = {
          despesa_id: p.despesa_id,
          descricao: p.descricao,
          categoria_nome: p.categoria_nome,
          num_parcelas: p.num_parcelas,
          parcelas: [],
          total: 0,
          situacao: "paga",
        };
        map.set(p.despesa_id, g);
      }
      g.parcelas.push(p);
    }
    for (const g of map.values()) {
      g.total = g.parcelas.reduce((s, p) => s + cents(p.valor_previsto), 0) / 100;
      g.situacao = g.parcelas.some((p) => p.situacao === "vencida")
        ? "vencida"
        : g.parcelas.every((p) => p.situacao === "paga")
          ? "paga"
          : "a_vencer";
    }
    return [...map.values()];
  }, [parcelas]);

  const totalGeral = useMemo(
    () => parcelas.reduce((s, p) => s + cents(p.valor_previsto), 0) / 100,
    [parcelas],
  );

  const setF = (k: keyof typeof filtros, v: string) => setFiltros((s) => ({ ...s, [k]: v }));
  const toggle = (id: string) =>
    setAberto((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const acao = (fn: () => Promise<unknown>) =>
    void fn()
      .then(refetch)
      .catch((e) => setError((e as Error).message));

  const excluir = (g: Grupo) => {
    const msg =
      g.num_parcelas > 1
        ? `Excluir a dívida “${g.descricao}” inteira (${g.num_parcelas} parcelas)? Esta ação não pode ser desfeita.`
        : `Excluir “${g.descricao}”? Esta ação não pode ser desfeita.`;
    setConfirmar({
      msg,
      onOk: () => acao(() => send(`/api/financeiro/despesas/${g.despesa_id}`, "DELETE")),
    });
  };

  const abrirEdicao = async (despesaId: string) => {
    setError(null);
    try {
      const j = await fetch(`/api/financeiro/despesas/${despesaId}`).then((r) => r.json());
      if (j.error) throw new Error(j.error);
      setEditar(j.despesa as DespesaDetalhe);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold">Contas a Pagar</h2>
          <p className="text-xs text-muted-foreground">
            Dívidas próprias com parcelamento — clique para ver as parcelas
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={!dim}
          onClick={() => setNovo(true)}
        >
          <IconPlus className="h-4 w-4" />
          Nova despesa
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border p-0.5">
          {GRUPOS.map((g) => (
            <button
              key={g.key}
              onClick={() => setF("grupo", g.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                filtros.grupo === g.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
        <select
          className={cn(selectCls, "w-auto")}
          value={filtros.bu_id}
          onChange={(e) => setF("bu_id", e.target.value)}
        >
          <option value="" className={optionCls}>
            Todas as BUs
          </option>
          {dim?.bus.map((b) => (
            <option key={b.id} value={b.id} className={optionCls}>
              {b.nome}
            </option>
          ))}
        </select>
        <SearchSelect
          className="w-52"
          value={filtros.categoria_id}
          onChange={(v) => setF("categoria_id", v)}
          options={(dim?.categorias ?? []).map((c) => ({ value: c.id, label: c.nome }))}
          allowEmpty
          emptyLabel="Todas as categorias"
          placeholder="Todas as categorias"
        />
        <Input
          className="h-8 w-40"
          placeholder="Buscar descrição…"
          value={filtros.busca}
          onChange={(e) => setF("busca", e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-col gap-1.5">
        {grupos.map((g) => {
          const open = aberto.has(g.despesa_id);
          const parcelado = g.num_parcelas > 1;
          return (
            <div key={g.despesa_id} className="rounded-lg border border-border">
              <div className="flex items-center gap-2 px-3 py-2 text-sm">
                <button
                  className="flex flex-1 items-center gap-2 text-left"
                  onClick={() => parcelado && toggle(g.despesa_id)}
                >
                  {parcelado ? (
                    <IconChevronRight
                      className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-90")}
                    />
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <span className="font-medium">{g.descricao}</span>
                  {parcelado && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {g.num_parcelas}x
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">{g.categoria_nome ?? "—"}</span>
                </button>
                <SituacaoBadge s={g.situacao} />
                <span className="w-28 text-right tabular-nums">{brl.format(g.total)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => void abrirEdicao(g.despesa_id)}
                  title="Editar dívida"
                >
                  <IconPencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  onClick={() => excluir(g)}
                  title="Excluir dívida"
                >
                  <IconTrash className="h-4 w-4" />
                </Button>
              </div>

              {(open || !parcelado) && (
                <ul className="divide-y divide-border border-t border-border">
                  {g.parcelas.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-2 px-3 py-1.5 pl-9 text-xs"
                    >
                      {parcelado && (
                        <span className="w-8 text-muted-foreground">
                          {p.numero}/{p.num_parcelas}
                        </span>
                      )}
                      <span className="w-24">{fmtData(p.data_vencimento)}</span>
                      <span className="text-muted-foreground">{p.bu_nome ?? "—"}</span>
                      {p.metodo_pagamento && (
                        <span className="text-muted-foreground">{p.metodo_pagamento}</span>
                      )}
                      <span className="ml-auto w-24 text-right tabular-nums">
                        {brl.format(p.valor_previsto)}
                      </span>
                      <SituacaoBadge s={p.situacao} />
                      {p.situacao === "paga" ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() =>
                            acao(() =>
                              send(`/api/financeiro/parcelas/${p.id}`, "PATCH", {
                                acao: "desfazer",
                              }),
                            )
                          }
                          title="Desfazer baixa"
                        >
                          <IconRotate className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-emerald-600"
                          onClick={() => setBaixando(p)}
                          title="Marcar como paga"
                        >
                          <IconCheckupList className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {grupos.length === 0 && !loading && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma conta neste filtro.
          </p>
        )}
      </div>

      {grupos.length > 0 && (
        <p className="text-right text-sm font-medium">
          Total do filtro: <span className="tabular-nums">{brl.format(totalGeral)}</span>
        </p>
      )}

      <Dialog open={novo} onOpenChange={setNovo}>
        {novo && dim && (
          <DespesaForm dim={dim} onSaved={() => { setNovo(false); void refetch(); }} />
        )}
      </Dialog>

      <Dialog open={editar !== null} onOpenChange={(o) => !o && setEditar(null)}>
        {editar && dim && (
          <DespesaForm
            dim={dim}
            initial={editar}
            onSaved={() => { setEditar(null); void refetch(); }}
          />
        )}
      </Dialog>

      <Dialog open={confirmar !== null} onOpenChange={(o) => !o && setConfirmar(null)}>
        {confirmar && (
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Confirmar exclusão</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{confirmar.msg}</p>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
              <Button
                variant="destructive"
                onClick={() => {
                  confirmar.onOk();
                  setConfirmar(null);
                }}
              >
                Excluir
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={baixando !== null} onOpenChange={(o) => !o && setBaixando(null)}>
        {baixando && (
          <BaixaDialog
            parcela={baixando}
            onDone={() => { setBaixando(null); void refetch(); }}
          />
        )}
      </Dialog>
    </section>
  );
}

function BaixaDialog({ parcela, onDone }: { parcela: ParcelaRow; onDone: () => void }) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState(hoje);
  const [valor, setValor] = useState(parcela.valor_previsto.toFixed(2));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const confirmar = async () => {
    setBusy(true);
    setErr(null);
    try {
      await send(`/api/financeiro/parcelas/${parcela.id}`, "PATCH", {
        acao: "baixar",
        data_pagamento: data,
        valor_realizado: Number(valor),
      });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Marcar como paga</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        {parcela.descricao}
        {parcela.num_parcelas > 1 ? ` (${parcela.numero}/${parcela.num_parcelas})` : ""} —
        previsto {brl.format(parcela.valor_previsto)}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label>Data do pagamento</Label>
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label>Valor pago</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </div>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
        <Button onClick={confirmar} disabled={busy}>
          {busy ? "Salvando…" : "Confirmar baixa"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function SituacaoBadge({ s }: { s: SituacaoParcela }) {
  const map: Record<SituacaoParcela, string> = {
    paga: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    vencida: "bg-destructive/10 text-destructive",
    a_vencer: "bg-muted text-muted-foreground",
  };
  const label: Record<SituacaoParcela, string> = {
    paga: "Paga",
    vencida: "Vencida",
    a_vencer: "A vencer",
  };
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", map[s])}>
      {label[s]}
    </span>
  );
}

interface LinhaParcela {
  bu_id: string;
  valor: string;
  data_vencimento: string;
  data_competencia: string;
  metodo_pagamento: string;
}

function DespesaForm({
  dim,
  initial,
  onSaved,
}: {
  dim: Dimensoes;
  initial?: DespesaDetalhe;
  onSaved: () => void;
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const editando = !!initial;
  const temPagas = initial?.parcelas.some((p) => p.data_pagamento) ?? false;

  const [descricao, setDescricao] = useState(initial?.descricao ?? "");
  const [observacao, setObservacao] = useState(initial?.observacao ?? "");
  const [categoriaId, setCategoriaId] = useState(initial?.categoria_id ?? "");
  const [centroId, setCentroId] = useState(initial?.centro_custo_id ?? "");
  const [colaboradorId, setColaboradorId] = useState(initial?.colaborador_id ?? "");
  const [valorTotal, setValorTotal] = useState(
    initial ? String(initial.valor_total) : "",
  );
  const [numParcelas, setNumParcelas] = useState(
    initial ? String(initial.parcelas.length) : "1",
  );
  const [primVenc, setPrimVenc] = useState(initial?.parcelas[0]?.data_vencimento ?? hoje);
  const [defBu, setDefBu] = useState(initial?.parcelas[0]?.bu_id ?? dim.bus[0]?.id ?? "");
  const [defMetodo, setDefMetodo] = useState("");
  const [linhas, setLinhas] = useState<LinhaParcela[]>(
    (initial?.parcelas ?? []).map((p) => ({
      bu_id: p.bu_id,
      valor: p.valor_previsto.toFixed(2),
      data_vencimento: p.data_vencimento,
      data_competencia: p.data_competencia,
      metodo_pagamento: p.metodo_pagamento ?? "",
    })),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Candidatos a duplicata (mesma categoria/valor/venc) achados antes de criar.
  const [dupCandidatos, setDupCandidatos] = useState<
    { descricao: string; fonte: string }[] | null
  >(null);

  const gerar = () => {
    const total = cents(Number(valorTotal) || 0);
    const n = Math.max(1, Math.floor(Number(numParcelas) || 1));
    if (total <= 0 || !defBu) {
      setErr("Preencha valor total, nº de parcelas e a BU padrão.");
      return;
    }
    setErr(null);
    const base = Math.floor(total / n);
    const resto = total - base * n;
    setLinhas(
      Array.from({ length: n }, (_, i) => ({
        bu_id: defBu,
        valor: ((base + (i === n - 1 ? resto : 0)) / 100).toFixed(2),
        data_vencimento: addMonths(primVenc, i),
        data_competencia: addMonths(primVenc, i),
        metodo_pagamento: defMetodo,
      })),
    );
  };

  const setLinha = (i: number, k: keyof LinhaParcela, v: string) =>
    setLinhas((s) => s.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const somaCents = linhas.reduce((s, l) => s + cents(Number(l.valor) || 0), 0);
  const totalCents = cents(Number(valorTotal) || 0);
  const bate = linhas.length > 0 && somaCents === totalCents;

  const submit = async (forcar = false) => {
    setBusy(true);
    setErr(null);
    try {
      if (!categoriaId) throw new Error("Selecione a categoria.");
      if (linhas.length === 0) throw new Error("Gere as parcelas.");
      if (!bate)
        throw new Error(
          `Soma das parcelas (${brl.format(somaCents / 100)}) ≠ total (${brl.format(totalCents / 100)}).`,
        );
      // Antes de CRIAR: checa duplicata — não recria à mão o que veio do import
      // do CA (defesa contra double-count no DRE cortado). Editar não checa.
      if (!editando && !forcar) {
        const qs = new URLSearchParams({
          categoria_id: categoriaId,
          valor: String(Number(valorTotal) || 0),
          vencimento: linhas[0]?.data_vencimento ?? primVenc,
        });
        const dup = await fetch(`/api/financeiro/despesas/duplicatas?${qs}`).then((r) =>
          r.json(),
        );
        if (Array.isArray(dup.candidatos) && dup.candidatos.length > 0) {
          setDupCandidatos(dup.candidatos);
          setBusy(false);
          return;
        }
      }
      const body = {
        descricao,
        observacao: observacao || null,
        categoria_id: categoriaId,
        centro_custo_id: centroId || null,
        colaborador_id: colaboradorId || null,
        valor_total: Number(valorTotal),
        parcelas: linhas.map((l) => ({
          bu_id: l.bu_id,
          valor_previsto: Number(l.valor),
          data_vencimento: l.data_vencimento,
          data_competencia: l.data_competencia,
          metodo_pagamento: l.metodo_pagamento || null,
        })),
      };
      if (editando)
        await send(`/api/financeiro/despesas/${initial!.id}`, "PATCH", body);
      else await send("/api/financeiro/despesas", "POST", body);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent className="w-[min(60rem,94vw)] max-w-none sm:max-w-none">
      <DialogHeader>
        <DialogTitle>{editando ? "Editar despesa" : "Nova despesa"}</DialogTitle>
      </DialogHeader>
      <form
        className="flex max-h-[85vh] flex-col gap-3 overflow-y-auto pr-1"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {temPagas && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Esta dívida tem parcelas já pagas. Ao regenerar as parcelas, os pagamentos
            registrados são preservados apenas nas parcelas de mesmo número.
          </p>
        )}
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
            <Label>Centro de custo</Label>
            <SearchSelect
              value={centroId}
              onChange={setCentroId}
              options={dim.centros.map((c) => ({ value: c.id, label: c.nome }))}
              allowEmpty
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label>Colaborador/Fornecedor (se pessoal)</Label>
            <SearchSelect
              value={colaboradorId}
              onChange={setColaboradorId}
              options={dim.colaboradores.map((c) => ({ value: c.id, label: c.nome }))}
              allowEmpty
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Observação</Label>
            <Input value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </div>
        </div>

        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Parcelamento</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="flex flex-col gap-1">
              <Label>Valor total</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={valorTotal}
                onChange={(e) => setValorTotal(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Nº parcelas</Label>
              <Input
                type="number"
                min="1"
                value={numParcelas}
                onChange={(e) => setNumParcelas(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>1º vencimento</Label>
              <Input
                type="date"
                value={primVenc}
                onChange={(e) => setPrimVenc(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label>BU padrão</Label>
              <select className={selectCls} value={defBu} onChange={(e) => setDefBu(e.target.value)}>
                {dim.bus.map((b) => (
                  <option key={b.id} value={b.id} className={optionCls}>
                    {b.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Método padrão</Label>
              <select
                className={selectCls}
                value={defMetodo}
                onChange={(e) => setDefMetodo(e.target.value)}
              >
                <option value="" className={optionCls}>
                  —
                </option>
                {METODOS_PAGAMENTO.map((m) => (
                  <option key={m} value={m} className={optionCls}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={gerar}>
            Gerar parcelas
          </Button>

          {linhas.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-2">#</th>
                    <th className="py-1 pr-2">BU</th>
                    <th className="py-1 pr-2">Valor</th>
                    <th className="py-1 pr-2">Vencimento</th>
                    <th className="py-1 pr-2">Competência</th>
                    <th className="py-1 pr-2">Método</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-2 text-muted-foreground">{i + 1}</td>
                      <td className="py-1 pr-2">
                        <select
                          className={cn(selectCls, "h-7")}
                          value={l.bu_id}
                          onChange={(e) => setLinha(i, "bu_id", e.target.value)}
                        >
                          {dim.bus.map((b) => (
                            <option key={b.id} value={b.id} className={optionCls}>
                              {b.nome}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 pr-2">
                        <Input
                          className="h-7 w-24"
                          type="number"
                          step="0.01"
                          min="0"
                          value={l.valor}
                          onChange={(e) => setLinha(i, "valor", e.target.value)}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <Input
                          className="h-7 w-36"
                          type="date"
                          value={l.data_vencimento}
                          onChange={(e) => setLinha(i, "data_vencimento", e.target.value)}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <Input
                          className="h-7 w-36"
                          type="date"
                          value={l.data_competencia}
                          onChange={(e) => setLinha(i, "data_competencia", e.target.value)}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <select
                          className={cn(selectCls, "h-7")}
                          value={l.metodo_pagamento}
                          onChange={(e) => setLinha(i, "metodo_pagamento", e.target.value)}
                        >
                          <option value="" className={optionCls}>
                            —
                          </option>
                          {METODOS_PAGAMENTO.map((m) => (
                            <option key={m} value={m} className={optionCls}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p
                className={cn(
                  "mt-2 text-xs",
                  bate ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
                )}
              >
                Σ parcelas: {brl.format(somaCents / 100)} / total {brl.format(totalCents / 100)}
                {bate ? " ✓" : " — não bate"}
              </p>
            </div>
          )}
        </div>

        {dupCandidatos && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <p className="font-medium">
              Já existe despesa parecida ({dupCandidatos.length}) — pode ser a mesma que veio do
              Conta Azul:
            </p>
            <ul className="mt-1 list-disc pl-4">
              {dupCandidatos.slice(0, 5).map((d, i) => (
                <li key={i}>
                  {d.descricao} {d.fonte === "ca_import" ? "· (importada do CA)" : ""}
                </li>
              ))}
            </ul>
            <p className="mt-1">Revise para não duplicar, ou salve mesmo assim.</p>
          </div>
        )}
        {err && <p className="text-xs text-destructive">{err}</p>}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
          {dupCandidatos ? (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setDupCandidatos(null);
                void submit(true);
              }}
            >
              {busy ? "Salvando…" : "Salvar mesmo assim"}
            </Button>
          ) : (
            <Button type="submit" disabled={busy || !bate}>
              {busy ? "Salvando…" : editando ? "Salvar alterações" : "Salvar despesa"}
            </Button>
          )}
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
