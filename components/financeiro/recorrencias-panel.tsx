"use client";

import { useCallback, useEffect, useState } from "react";
import {
  IconBuildingStore,
  IconEye,
  IconEyeOff,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUser,
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
import {
  ConfirmDialog,
  type Confirmacao,
} from "@/components/financeiro/confirm-dialog";
import { MoneyInput } from "@/components/financeiro/money-input";
import { Label } from "@/components/ui/label";
import {
  RateioEditorDialog,
  rateioValido,
  type RateioLinha,
} from "@/components/financeiro/rateio-editor";
import { SearchSelect } from "@/components/financeiro/search-select";
import { cn } from "@/lib/utils";
import {
  cabeNoCiclo,
  METODOS_PAGAMENTO,
  PASSO_MESES,
  PERIODICIDADE_LABEL,
  PERIODICIDADES,
  type BusinessUnit,
  type FinCategoria,
  type FinCentro,
  type FinColaborador,
  type FinRecorrencia,
} from "@/lib/financeiro/types";

/**
 * Aba Recorrências (Passo 8). Despesas fixas que se materializam em despesa+parcela
 * por competência, num HORIZONTE de 12 meses — para o DRE dos meses futuros já
 * mostrar o que é certo, igual a uma compra parcelada (que nasce com todas as
 * parcelas visíveis). A geração é automática: ao criar e, todo dia, pelo cron.
 *
 * Editar regera os meses futuros NÃO PAGOS; excluir/inativar pergunta antes de
 * removê-los. Passado e parcela paga nunca se mexem.
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
  centros: FinCentro[];
  colaboradores: FinColaborador[];
}

/**
 * Mês corrente em **America/Sao_Paulo**, não no fuso do navegador. Mesmo helper
 * de Contas a pagar — na virada do mês o fuso errado devolveria o anterior.
 */
function mesAtualComp(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

/** Soma n meses a uma competência 'AAAA-MM'. Vazio parte do mês corrente. */
function addMesComp(ym: string, n: number): string {
  const base = ym || mesAtualComp();
  const [y, m] = base.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function RecorrenciasPanel() {
  const [lista, setLista] = useState<FinRecorrencia[]>([]);
  const [dim, setDim] = useState<Dim | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<FinRecorrencia | "novo" | null>(null);
  const [confirmar, setConfirmar] = useState<Confirmacao | null>(null);
  /**
   * Filtros espelhando Contas a pagar, TRADUZIDOS para o que uma recorrência é.
   *
   * Recorrência é um MOLDE, não uma parcela: não tem "vencida" nem "paga", que
   * são estados de algo já gerado. O eixo equivalente é ativa × inativa.
   *
   * `competencia` filtra por CICLO — quais recorrências geram lançamento naquele
   * mês. Uma trimestral só aparece de 3 em 3, e é a pergunta que mais se faz
   * aqui ("o que cai em agosto?"). Vazio = todas.
   */
  const [filtros, setFiltros] = useState(() => ({
    situacao: "ativas" as "ativas" | "inativas" | "todas",
    competencia: "",
    bu_id: "",
    categoria_id: "",
    busca: "",
  }));
  const setF = (k: keyof typeof filtros, v: string) =>
    setFiltros((s) => ({ ...s, [k]: v }));

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rec, cat, bus, cen, col] = await Promise.all([
        fetch("/api/financeiro/recorrencias").then((r) => r.json()),
        fetch("/api/financeiro/categorias").then((r) => r.json()),
        fetch("/api/financeiro/bus").then((r) => r.json()),
        fetch("/api/financeiro/centros").then((r) => r.json()),
        fetch("/api/financeiro/colaboradores").then((r) => r.json()),
      ]);
      if (rec.error) throw new Error(rec.error);
      setLista(rec.recorrencias ?? []);
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

  /**
   * Antes de excluir/inativar, pergunta o que fazer com os meses FUTUROS já
   * gerados. Com horizonte de 12 meses, sumir (ou deixar) um ano de despesa sem
   * avisar seria uma mudança grande e invisível no DRE.
   */
  const confirmarComFuturos = async (
    r: FinRecorrencia,
    acao: "excluir" | "inativar",
  ) => {
    setError(null);
    let futuros = 0;
    try {
      const j = await fetch(`/api/financeiro/recorrencias/${r.id}`).then((x) => x.json());
      futuros = j.futuros ?? 0;
    } catch {
      /* sem a contagem, segue com a confirmação genérica */
    }
    const verbo = acao === "excluir" ? "Excluir" : "Inativar";
    const url = (removerFuturos: boolean) =>
      `/api/financeiro/recorrencias/${r.id}${removerFuturos ? "?removerFuturos=1" : ""}`;
    const exec = (removerFuturos: boolean) =>
      void runAction(() =>
        acao === "excluir"
          ? send(url(removerFuturos), "DELETE")
          : send(url(removerFuturos), "PATCH", { ativo: false }),
      );

    if (futuros === 0) {
      setConfirmar({
        msg: `${verbo} a recorrência “${r.descricao}”? Não há meses futuros gerados pendentes.`,
        acaoLabel: verbo,
        onOk: () => exec(false),
      });
      return;
    }
    setConfirmar({
      msg:
        `${verbo} a recorrência “${r.descricao}”?\n\n` +
        `Ela tem ${futuros} mês(es) FUTURO(S) já gerado(s) em Contas a Pagar, ainda não pagos. ` +
        `Ao confirmar, esses meses serão REMOVIDOS (o histórico e o que já foi pago permanecem).`,
      acaoLabel: `${verbo} e remover ${futuros} mês(es)`,
      onOk: () => exec(true),
    });
  };

  const remove = (r: FinRecorrencia) => void confirmarComFuturos(r, "excluir");

  const buNome = (id: string) => dim?.bus.find((b) => b.id === id)?.nome ?? "—";
  const catNome = (id: string) => dim?.categorias.find((c) => c.id === id)?.nome ?? "—";
  const centroNome = (id: string | null) =>
    id ? dim?.centros.find((c) => c.id === id)?.nome ?? null : null;
  /**
   * Fornecedor OU colaborador — os dois vivem em `fin_colaboradores`, separados
   * por `tipo`. Devolve o registro inteiro para a tela poder escolher o ícone.
   */
  const pessoa = (id: string | null) =>
    id ? dim?.colaboradores.find((c) => c.id === id) ?? null : null;

  /**
   * Aplicação dos filtros, em memória.
   *
   * A lista de recorrências é pequena (dezenas), então filtrar aqui evita cinco
   * parâmetros novos na API e um ida-e-volta a cada tecla digitada na busca.
   *
   * A BU respeita o RATEIO: uma recorrência 50% Colégio / 50% CPPEM aparece nos
   * dois filtros. Sem isso, filtrar por Colégio esconderia metade de uma despesa
   * que é dele — o mesmo cuidado que Contas a pagar já toma.
   */
  const filtrada = lista.filter((r) => {
    if (filtros.situacao === "ativas" && !r.ativo) return false;
    if (filtros.situacao === "inativas" && r.ativo) return false;
    if (filtros.competencia && !cabeNoCiclo(r, filtros.competencia)) return false;
    if (filtros.categoria_id && r.categoria_id !== filtros.categoria_id) return false;
    if (filtros.bu_id) {
      const fatias = (r.rateio ?? []) as { bu_id: string }[];
      const bate = fatias.length
        ? fatias.some((f) => f.bu_id === filtros.bu_id)
        : r.bu_id === filtros.bu_id;
      if (!bate) return false;
    }
    if (filtros.busca.trim()) {
      const q = filtros.busca.trim().toLowerCase();
      const alvo = [
        r.descricao,
        catNome(r.categoria_id),
        pessoa(r.colaborador_id ?? null)?.nome ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!alvo.includes(q)) return false;
    }
    return true;
  });

  const totalFiltro = filtrada.reduce((s, r) => s + Number(r.valor_previsto || 0), 0);

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

      <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        As despesas são geradas <strong>automaticamente para os próximos 12 meses</strong> —
        ao criar a recorrência e, todo dia, pelo sync. Assim o DRE dos meses futuros já
        mostra o que é certo, igual a uma compra parcelada. Editar uma recorrência
        atualiza os meses futuros ainda não pagos.
      </p>

      {/* Mesma barra de Contas a pagar, com os eixos traduzidos para
          recorrência — ver a nota em `filtros`. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-border p-0.5">
          {(
            [
              ["ativas", "Ativas"],
              ["inativas", "Inativas"],
              ["todas", "Todas"],
            ] as const
          ).map(([k, rot]) => (
            <button
              key={k}
              type="button"
              onClick={() => setF("situacao", k)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                filtros.situacao === k
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {rot}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <label className="text-[11px] text-muted-foreground">Competência:</label>
          {/* Setas ◀ ▶ além do seletor: o campo `month` nativo é inconsistente
              entre navegadores (às vezes o calendário nem abre). Com as setas dá
              pra andar mês a mês sempre. Mesmo padrão de Contas a pagar. */}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setF("competencia", addMesComp(filtros.competencia, -1))}
            title="Mês anterior"
          >
            ◀
          </Button>
          <Input
            type="month"
            className="h-8 w-40"
            value={filtros.competencia}
            onChange={(e) => setF("competencia", e.target.value)}
            title="Vazio = todas as competências"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => setF("competencia", addMesComp(filtros.competencia, 1))}
            title="Próximo mês"
          >
            ▶
          </Button>
          {filtros.competencia ? (
            <button
              type="button"
              className="rounded border border-border px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted"
              onClick={() => setF("competencia", "")}
              title="Limpar (todas as competências)"
            >
              todas
            </button>
          ) : (
            <button
              type="button"
              className="rounded border border-border px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted"
              onClick={() => setF("competencia", mesAtualComp())}
              title="Só as que geram lançamento no mês corrente"
            >
              mês atual
            </button>
          )}
        </div>

        <select
          className="h-8 w-auto rounded-lg border border-input bg-background px-2 text-xs outline-none"
          value={filtros.bu_id}
          onChange={(e) => setF("bu_id", e.target.value)}
        >
          <option value="">Todas as BUs</option>
          {dim?.bus.map((b) => (
            <option key={b.id} value={b.id}>
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
          className="h-8 w-44"
          placeholder="Buscar descrição…"
          value={filtros.busca}
          onChange={(e) => setF("busca", e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {filtrada.map((r) => (
          <li key={r.id} className="fin-row flex items-center gap-2 px-3 py-2.5 text-sm">
            <span
              className={cn(
                "min-w-0 truncate",
                !r.ativo && "text-muted-foreground line-through",
              )}
              title={r.descricao}
            >
              {r.descricao}
            </span>
            {/* `title` porque as categorias de hora-aula só diferem no FINAL
                ("…do Colégio Cppem" / "…do Cppem Presencial" / "…do Cppem Online"). */}
            <span
              className="min-w-0 shrink-2 truncate text-xs text-muted-foreground"
              title={catNome(r.categoria_id)}
            >
              {catNome(r.categoria_id)}
            </span>
            {centroNome(r.centro_custo_id) && (
              <span
                className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                title="Centro de custo"
              >
                {centroNome(r.centro_custo_id)}
              </span>
            )}
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {buNome(r.bu_id)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {r.periodicidade} · dia {r.dia_vencimento}
              {r.metodo_pagamento ? ` · ${r.metodo_pagamento}` : ""}
            </span>
            {/* Fornecedor/colaborador logo na linha: numa recorrência, saber
                PARA QUEM ela paga é o que distingue "Aluguel" de "Aluguel".
                O ícone diz o tipo sem gastar largura com a palavra. */}
            {(() => {
              const p = pessoa(r.colaborador_id ?? null);
              if (!p) return null;
              return (
                <span
                  className="inline-flex max-w-[12rem] items-center gap-1 text-[10px] text-muted-foreground"
                  title={`${p.tipo === "fornecedor" ? "Fornecedor" : "Colaborador"}: ${p.nome}`}
                >
                  {p.tipo === "fornecedor" ? (
                    <IconBuildingStore className="h-3 w-3 shrink-0" />
                  ) : (
                    <IconUser className="h-3 w-3 shrink-0" />
                  )}
                  <span className="truncate">{p.nome}</span>
                </span>
              );
            })()}
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
                  r.ativo
                    ? // Inativar tira a recorrência dos meses futuros → confirma antes.
                      void confirmarComFuturos(r, "inativar")
                    : // Reativar apenas religa; o sync repõe o horizonte.
                      void runAction(() =>
                        send(`/api/financeiro/recorrencias/${r.id}`, "PATCH", { ativo: true }),
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
        {filtrada.length === 0 && (
          <li className="px-3 py-6 text-center text-muted-foreground">
            {lista.length === 0
              ? "Nenhuma recorrência ainda."
              : "Nenhuma recorrência bate com os filtros."}
          </li>
        )}
      </ul>

      {/* Espelha o rodapé de Contas a pagar. Diz "no filtro" de propósito: com
          Ativas ligado por padrão, o número NÃO é o total de tudo. */}
      {filtrada.length > 0 && (
        <p className="text-right text-sm font-medium">
          Total no filtro:{" "}
          <span className="tabular-nums">{brl.format(totalFiltro)}</span>
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {filtrada.length} de {lista.length}
          </span>
        </p>
      )}

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog !== null && dim && (
          <RecorrenciaForm
            item={dialog === "novo" ? null : dialog}
            dim={dim}
            onSaved={() => { setDialog(null); void refetch(); }}
          />
        )}
      </Dialog>

      <ConfirmDialog confirmacao={confirmar} onClose={() => setConfirmar(null)} />
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
  const [centroId, setCentroId] = useState(item?.centro_custo_id ?? "");
  const [buId, setBuId] = useState(item?.bu_id ?? dim.bus[0]?.id ?? "");
  const [colaboradorId, setColaboradorId] = useState(item?.colaborador_id ?? "");
  const [valor, setValor] = useState(item ? String(item.valor_previsto) : "");
  const [periodicidade, setPeriodicidade] = useState(item?.periodicidade ?? "mensal");
  const [metodo, setMetodo] = useState(item?.metodo_pagamento ?? "");
  /**
   * A recorrência é definida por DUAS DATAS — igual ao Contas a Pagar, para não
   * ter duas linguagens diferentes pro mesmo conceito. Da 1ª ocorrência o
   * sistema deduz a regra que se repete todo mês:
   *
   *   dia_vencimento     = dia do 1º vencimento
   *   inicio_competencia = mês da 1ª competência
   *   defasagem_meses    = meses entre as duas datas
   *
   * Ex.: competência 05/07 + vencimento 05/08 → dia 5, início 07/2026, defasagem 1.
   */
  const [primComp, setPrimComp] = useState(() => {
    if (item?.inicio_competencia) return `${item.inicio_competencia}-01`;
    // Nova: se o dia 5 deste mês já passou, sugere o mês que vem (senão a 1ª
    // parcela nasceria vencida).
    const now = new Date();
    const d = now.getDate() > 5 ? new Date(now.getFullYear(), now.getMonth() + 1, 1) : now;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  /**
   * O dia do vencimento GRAVADO. Ao editar, o campo de data mostra o dia já
   * limitado ao mês (dia 31 → 28 em fevereiro); se deduzíssemos o dia daí, uma
   * simples reabertura do formulário rebaixaria "todo dia 31" para "todo dia 28"
   * em silêncio. Então só recalculamos o dia se a pessoa MEXER na data.
   */
  const [diaGravado, setDiaGravado] = useState<number | null>(
    item?.dia_vencimento ?? null,
  );
  const [primVenc, setPrimVenc] = useState(() => {
    if (item?.inicio_competencia) {
      const [a, m] = item.inicio_competencia.split("-").map(Number);
      const d = new Date(Date.UTC(a, m - 1 + (item.defasagem_meses ?? 0), 1));
      const ult = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      const dd = Math.min(item.dia_vencimento, ult);
      const p2 = (n: number) => String(n).padStart(2, "0");
      return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(dd)}`;
    }
    const now = new Date();
    const d = now.getDate() > 5 ? new Date(now.getFullYear(), now.getMonth() + 1, 1) : now;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-05`;
  });
  const [rateio, setRateio] = useState<RateioLinha[]>(item?.rateio ?? []);
  const [rateioOpen, setRateioOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const buNome = (id: string) => dim.bus.find((b) => b.id === id)?.nome ?? "—";

  /**
   * Deduz a regra recorrente das duas datas da 1ª ocorrência.
   * `defasagem` é a diferença em MESES (o dia não importa: a competência da
   * parcela gerada é sempre o dia 01 do mês).
   */
  const regra = (() => {
    if (!primComp || !primVenc) return null;
    const [ca, cm] = primComp.split("-").map(Number);
    const [va, vm, vd] = primVenc.split("-").map(Number);
    const defasagem = va * 12 + vm - (ca * 12 + cm);
    const p2 = (n: number) => String(n).padStart(2, "0");
    return {
      inicio_competencia: `${ca}-${p2(cm)}`,
      // Preserva o dia gravado enquanto a data não for editada (ver `diaGravado`).
      dia_vencimento: diaGravado ?? vd,
      defasagem_meses: defasagem,
      // Rótulos p/ a prévia
      compLabel: `${p2(cm)}/${ca}`,
      vencLabel: `${p2(vd)}/${p2(vm)}/${va}`,
      vencMesLabel: `${p2(vm)}/${va}`,
    };
  })();

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (!categoriaId) throw new Error("Selecione a categoria.");
      if (!buId) throw new Error("Selecione a BU.");
      if (!regra) throw new Error("Informe a 1ª competência e o 1º vencimento.");
      if (regra.defasagem_meses < 0)
        throw new Error(
          "O vencimento não pode ser ANTES da competência. Verifique as duas datas.",
        );
      if (!rateioValido(rateio))
        throw new Error("Rateio inválido — a soma dos percentuais precisa ser 100%.");
      const body = {
        descricao,
        categoria_id: categoriaId,
        bu_id: buId,
        centro_custo_id: centroId || null,
        colaborador_id: colaboradorId || null,
        valor_previsto: Number(valor),
        periodicidade,
        metodo_pagamento: metodo || null,
        rateio: rateio.length ? rateio : null,
        // Regra recorrente deduzida das duas datas da 1ª ocorrência.
        dia_vencimento: regra.dia_vencimento,
        inicio_competencia: regra.inicio_competencia,
        defasagem_meses: regra.defasagem_meses,
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
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label>Centro de custo</Label>
            <SearchSelect
              value={centroId}
              onChange={setCentroId}
              options={dim.centros.map((c) => ({ value: c.id, label: c.nome }))}
              allowEmpty
            />
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
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <div className="flex flex-col gap-1">
            <Label>Valor</Label>
            <MoneyInput value={valor} onChange={setValor} />
          </div>
          <div className="flex flex-col gap-1">
            <Label title="A que mês a 1ª despesa SE REFERE (entra no DRE deste mês)">
              1ª competência
            </Label>
            <div className="flex items-center gap-1">
              <Input
                type="date"
                value={primComp}
                onChange={(e) => setPrimComp(e.target.value)}
              />
              <button
                type="button"
                className="shrink-0 rounded border border-border px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-muted"
                onClick={() => {
                  // Folha/aluguel/encargos: refere-se ao mês anterior ao pagamento.
                  const [a, m, d] = primVenc.split("-").map(Number);
                  const dt = new Date(Date.UTC(a, m - 2, 1));
                  const ult = new Date(
                    Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0),
                  ).getUTCDate();
                  const p2 = (n: number) => String(n).padStart(2, "0");
                  setPrimComp(
                    `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(Math.min(d, ult))}`,
                  );
                }}
                title="Folha, aluguel, encargos: paga em um mês, refere-se ao anterior"
              >
                −1 mês
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label title="Quando a 1ª parcela SERÁ PAGA. O dia se repete todo mês.">
              1º vencimento
            </Label>
            <Input
              type="date"
              value={primVenc}
              onChange={(e) => {
                setPrimVenc(e.target.value);
                setDiaGravado(null); // mexeu na data → o dia passa a vir dela
              }}
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
                  {PERIODICIDADE_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Método de pagamento</Label>
            <select
              className={selectCls}
              value={metodo}
              onChange={(e) => setMetodo(e.target.value)}
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
        {/* Ciclo > mensal: o mês da 1ª competência define TODOS os seguintes, então
            é preciso dizer quais são — senão parece que a recorrência "sumiu" nos
            meses do intervalo. */}
        {PASSO_MESES[periodicidade] > 1 && regra && (
          <p className="text-[11px] text-muted-foreground">
            A cada {PASSO_MESES[periodicidade]} meses a partir de{" "}
            <strong>{regra.inicio_competencia}</strong> — próximas competências:{" "}
            {(() => {
              const passo = PASSO_MESES[periodicidade];
              const [a, m] = regra.inicio_competencia.split("-").map(Number);
              return Array.from({ length: 4 }, (_, k) => {
                const d = new Date(Date.UTC(a, m - 1 + k * passo, 1));
                return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
              }).join(", ");
            })()}
            …
          </p>
        )}
        {/* Prévia: confirma a REGRA deduzida das duas datas e deixa explícito
            que ela se repete — é o que uma recorrência tem a mais que uma conta. */}
        <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs">
          {!regra ? (
            <span className="text-muted-foreground">
              Informe a 1ª competência e o 1º vencimento.
            </span>
          ) : regra.defasagem_meses < 0 ? (
            <span className="text-destructive">
              O vencimento está ANTES da competência — verifique as duas datas.
            </span>
          ) : (
            <>
              <span className="text-muted-foreground">1ª ocorrência: </span>
              <strong>competência {regra.compLabel}</strong>
              <span className="text-muted-foreground"> · vence </span>
              <strong>{regra.vencLabel}</strong>
              <span className="text-muted-foreground">
                {regra.defasagem_meses > 0
                  ? ` — entra no DRE de ${regra.compLabel} e sai do caixa em ${regra.vencMesLabel}.`
                  : " — mesmo mês no DRE e no caixa."}
              </span>
              <div className="mt-1 text-muted-foreground">
                Depois disso, repete todo mês no dia{" "}
                <strong>{regra.dia_vencimento}</strong>
                {regra.defasagem_meses > 0
                  ? `, sempre referente a ${regra.defasagem_meses} mês(es) antes.`
                  : "."}
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">Rateio por BU</span>
          {rateio.length === 0 ? (
            <span className="text-xs text-muted-foreground">— 100% na BU acima</span>
          ) : (
            <span className="text-xs">
              {rateio.map((l) => `${buNome(l.bu_id)} ${l.percentual}%`).join(" · ")}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-7"
            onClick={() => setRateioOpen(true)}
          >
            {rateio.length ? "Editar rateio" : "Dividir entre BUs"}
          </Button>
          {rateio.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-muted-foreground"
              onClick={() => setRateio([])}
            >
              Remover
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Ao gerar o mês, a despesa nasce em Contas a Pagar já com esse rateio.
        </p>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancelar</DialogClose>
          <Button type="submit" disabled={busy}>
            {busy ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </form>

      <Dialog open={rateioOpen} onOpenChange={(o) => !o && setRateioOpen(false)}>
        {rateioOpen && (
          <RateioEditorDialog
            bus={dim.bus}
            titulo="Rateio da recorrência por BU"
            initial={rateio}
            onSave={(linhas) => {
              setRateio(linhas);
              if (linhas.length) setBuId(linhas[0].bu_id);
              setRateioOpen(false);
            }}
            onCancel={() => setRateioOpen(false)}
          />
        )}
      </Dialog>
    </DialogContent>
  );
}
