"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconPencil,
  IconPlus,
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
import { cn } from "@/lib/utils";
import {
  FIN_TIPOS,
  GRUPOS_DRE,
  type BusinessUnit,
  type FinCategoria,
  type FinCentro,
} from "@/lib/financeiro/types";

/**
 * Aba Cadastros: dimensões do módulo financeiro (Categorias, Business Units,
 * Centros de Custo). Consome as rotas `/api/financeiro/{categorias,bus,centros}`
 * (camada `lib/financeiro/*`). Hierarquia das categorias = **grupo DRE (01…08)**,
 * não o `categoria_pai` do CA. Nada é excluído — só ativado/inativado.
 */
type TreeGrupo = { grupo_dre: string | null; categorias: FinCategoria[] };

interface Cadastros {
  categorias: FinCategoria[];
  tree: TreeGrupo[];
  bus: BusinessUnit[];
  centros: FinCentro[];
}

// Fundo sólido (bg-background) + color-scheme p/ o popup nativo do <select> não
// herdar transparência (ficava ilegível no dark). Os <option> recebem optionCls.
const selectCls =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const optionCls = "bg-background text-foreground";

/** Lança em resposta não-ok, propagando a mensagem da rota. */
async function send(url: string, method: "POST" | "PATCH", body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `HTTP ${res.status}`);
  }
}

type DialogState =
  | { kind: "categoria"; item: FinCategoria | null }
  | { kind: "bu"; item: BusinessUnit | null }
  | { kind: "centro"; item: FinCentro | null }
  | null;

export function CadastrosPanel() {
  const [data, setData] = useState<Cadastros | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cat, bus, centros] = await Promise.all([
        fetch("/api/financeiro/categorias").then((r) => r.json()),
        fetch("/api/financeiro/bus").then((r) => r.json()),
        fetch("/api/financeiro/centros").then((r) => r.json()),
      ]);
      if (cat.error) throw new Error(cat.error);
      setData({
        categorias: cat.categorias ?? [],
        tree: cat.tree ?? [],
        bus: bus.bus ?? [],
        centros: centros.centros ?? [],
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

  const buById = useMemo(() => {
    const m = new Map<string, BusinessUnit>();
    for (const b of data?.bus ?? []) m.set(b.id, b);
    return m;
  }, [data?.bus]);

  if (loading && !data)
    return <p className="text-sm text-muted-foreground">Carregando cadastros…</p>;
  if (error)
    return (
      <p className="text-sm text-destructive">
        Erro ao carregar: {error}{" "}
        <button className="underline" onClick={() => void refetch()}>
          tentar de novo
        </button>
      </p>
    );
  if (!data) return null;

  const onSaved = () => {
    setDialog(null);
    void refetch();
  };

  // Executa uma ação (toggle/delete), captura o erro numa faixa e refaz o fetch.
  const runAction = async (fn: () => Promise<void>) => {
    setActionErr(null);
    try {
      await fn();
      await refetch();
    } catch (e) {
      setActionErr((e as Error).message);
    }
  };

  const toggle = (base: string, item: { id: string; ativo: boolean }) =>
    runAction(() =>
      send(`/api/financeiro/${base}/${item.id}`, "PATCH", { ativo: !item.ativo }),
    );
  const remove = (base: string, id: string, rotulo: string) => {
    if (!window.confirm(`Excluir ${rotulo}? Esta ação não pode ser desfeita.`)) return;
    void runAction(async () => {
      const res = await fetch(`/api/financeiro/${base}/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
    });
  };

  return (
    <section className="flex flex-col gap-8">
      {actionErr && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionErr}
        </p>
      )}

      <CategoriasSection
        tree={data.tree}
        buById={buById}
        onNew={() => setDialog({ kind: "categoria", item: null })}
        onEdit={(item) => setDialog({ kind: "categoria", item })}
        onToggle={(item) => void toggle("categorias", item)}
        onDelete={(item) => remove("categorias", item.id, item.nome)}
      />

      <BusSection
        bus={data.bus}
        onNew={() => setDialog({ kind: "bu", item: null })}
        onEdit={(item) => setDialog({ kind: "bu", item })}
        onToggle={(item) => void toggle("bus", item)}
        onDelete={(item) => remove("bus", item.id, item.nome)}
      />

      <CentrosSection
        centros={data.centros}
        onNew={() => setDialog({ kind: "centro", item: null })}
        onEdit={(item) => setDialog({ kind: "centro", item })}
        onToggle={(item) => void toggle("centros", item)}
        onDelete={(item) => remove("centros", item.id, item.nome)}
      />

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog?.kind === "categoria" && (
          <CategoriaForm item={dialog.item} bus={data.bus} onSaved={onSaved} />
        )}
        {dialog?.kind === "bu" && <BuForm item={dialog.item} onSaved={onSaved} />}
        {dialog?.kind === "centro" && (
          <CentroForm item={dialog.item} onSaved={onSaved} />
        )}
      </Dialog>
    </section>
  );
}

/* ---------------------------------------------------------------- Categorias */

function CategoriasSection({
  tree,
  buById,
  onNew,
  onEdit,
  onToggle,
  onDelete,
}: {
  tree: TreeGrupo[];
  buById: Map<string, BusinessUnit>;
  onNew: () => void;
  onEdit: (c: FinCategoria) => void;
  onToggle: (c: FinCategoria) => void;
  onDelete: (c: FinCategoria) => void;
}) {
  const [aberto, setAberto] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setAberto((s) => {
      const n = new Set(s);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  return (
    <div className="flex flex-col gap-3">
      <SectionHeader
        titulo="Categorias"
        subtitulo="Agrupadas por grupo do DRE (01…08)"
        onNew={onNew}
      />
      <div className="flex flex-col gap-1">
        {tree.map((g) => {
          const key = g.grupo_dre ?? "sem";
          const label = g.grupo_dre ? `Grupo ${g.grupo_dre}` : "Sem grupo DRE";
          const open = aberto.has(key);
          return (
            <div key={key} className="rounded-lg border border-border">
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
                onClick={() => toggle(key)}
              >
                <IconChevronRight
                  className={cn("h-4 w-4 transition-transform", open && "rotate-90")}
                />
                {label}
                <span className="ml-auto text-xs text-muted-foreground">
                  {g.categorias.length}
                </span>
              </button>
              {open && (
                <ul className="divide-y divide-border border-t border-border">
                  {g.categorias.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm"
                    >
                      <span className={cn(!c.ativo && "text-muted-foreground line-through")}>
                        {c.codigo ? `${c.codigo} · ` : ""}
                        {c.nome}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {c.tipo}
                      </span>
                      {c.natureza && (
                        <span className="text-[10px] text-muted-foreground">
                          {c.natureza}
                        </span>
                      )}
                      {c.bu_id && buById.get(c.bu_id) && (
                        <span className="text-[10px] text-muted-foreground">
                          {buById.get(c.bu_id)!.nome}
                        </span>
                      )}
                      <RowActions
                        ativo={c.ativo}
                        onEdit={() => onEdit(c)}
                        onToggle={() => onToggle(c)}
                        onDelete={() => onDelete(c)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CategoriaForm({
  item,
  bus,
  onSaved,
}: {
  item: FinCategoria | null;
  bus: BusinessUnit[];
  onSaved: () => void;
}) {
  const [nome, setNome] = useState(item?.nome ?? "");
  const [codigo, setCodigo] = useState(item?.codigo ?? "");
  const [tipo, setTipo] = useState(item?.tipo ?? "despesa");
  const [grupo, setGrupo] = useState(item?.grupo_dre ?? "");
  const [natureza, setNatureza] = useState(item?.natureza ?? "");
  const [buId, setBuId] = useState(item?.bu_id ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        nome,
        codigo: codigo || null,
        tipo,
        grupo_dre: grupo || null,
        natureza: natureza || null,
        bu_id: buId || null,
      };
      if (item) await send(`/api/financeiro/categorias/${item.id}`, "PATCH", body);
      else await send("/api/financeiro/categorias", "POST", body);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormShell
      titulo={item ? "Editar categoria" : "Nova categoria"}
      busy={busy}
      err={err}
      onSubmit={submit}
    >
      <FormField label="Nome">
        <Input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
      </FormField>
      <FormField label="Código">
        <Input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="ex.: 1.8"
        />
      </FormField>
      <FormField label="Tipo">
        <select className={selectCls} value={tipo} onChange={(e) => setTipo(e.target.value as FinCategoria["tipo"])}>
          {FIN_TIPOS.map((t) => (
            <option key={t} value={t} className={optionCls}>
              {t}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Grupo DRE">
        <select className={selectCls} value={grupo} onChange={(e) => setGrupo(e.target.value as FinCategoria["grupo_dre"] & string)}>
          <option value="" className={optionCls}>
            — nenhum —
          </option>
          {GRUPOS_DRE.map((g) => (
            <option key={g} value={g} className={optionCls}>
              {g}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Natureza">
        <select className={selectCls} value={natureza} onChange={(e) => setNatureza(e.target.value as FinCategoria["natureza"] & string)}>
          <option value="" className={optionCls}>
            — não definida —
          </option>
          <option value="fixa" className={optionCls}>
            fixa
          </option>
          <option value="variavel" className={optionCls}>
            variável
          </option>
        </select>
      </FormField>
      <FormField label="Business Unit">
        <select className={selectCls} value={buId} onChange={(e) => setBuId(e.target.value)}>
          <option value="" className={optionCls}>
            — nenhuma —
          </option>
          {bus.map((b) => (
            <option key={b.id} value={b.id} className={optionCls}>
              {b.nome}
            </option>
          ))}
        </select>
      </FormField>
    </FormShell>
  );
}

/* --------------------------------------------------------------- Business Units */

function BusSection({
  bus,
  onNew,
  onEdit,
  onToggle,
  onDelete,
}: {
  bus: BusinessUnit[];
  onNew: () => void;
  onEdit: (b: BusinessUnit) => void;
  onToggle: (b: BusinessUnit) => void;
  onDelete: (b: BusinessUnit) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SectionHeader titulo="Business Units" subtitulo="Unidades de negócio" onNew={onNew} />
      <ul className="divide-y divide-border rounded-lg border border-border">
        {bus.map((b) => (
          <li key={b.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span
              className="h-3 w-3 shrink-0 rounded-full border border-border"
              style={{ background: b.cor ?? "transparent" }}
            />
            <span className={cn(!b.ativo && "text-muted-foreground line-through")}>
              {b.nome}
            </span>
            <span className="text-[10px] text-muted-foreground">{b.slug}</span>
            <RowActions
              ativo={b.ativo}
              onEdit={() => onEdit(b)}
              onToggle={() => onToggle(b)}
              onDelete={() => onDelete(b)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function BuForm({ item, onSaved }: { item: BusinessUnit | null; onSaved: () => void }) {
  const [nome, setNome] = useState(item?.nome ?? "");
  const [slug, setSlug] = useState(item?.slug ?? "");
  const [cnpj, setCnpj] = useState(item?.cnpj ?? "");
  const [cor, setCor] = useState(item?.cor ?? "#3b82f6");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = { nome, slug, cnpj: cnpj || null, cor: cor || null };
      if (item) await send(`/api/financeiro/bus/${item.id}`, "PATCH", body);
      else await send("/api/financeiro/bus", "POST", body);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormShell titulo={item ? "Editar BU" : "Nova BU"} busy={busy} err={err} onSubmit={submit}>
      <FormField label="Nome">
        <Input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
      </FormField>
      <FormField label="Slug">
        <Input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="minúsculas-com-hifen"
        />
      </FormField>
      <FormField label="CNPJ">
        <Input value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
      </FormField>
      <FormField label="Cor">
        <input
          type="color"
          className="h-8 w-14 rounded border border-input bg-transparent"
          value={cor}
          onChange={(e) => setCor(e.target.value)}
        />
      </FormField>
    </FormShell>
  );
}

/* -------------------------------------------------------------- Centros de Custo */

function CentrosSection({
  centros,
  onNew,
  onEdit,
  onToggle,
  onDelete,
}: {
  centros: FinCentro[];
  onNew: () => void;
  onEdit: (c: FinCentro) => void;
  onToggle: (c: FinCentro) => void;
  onDelete: (c: FinCentro) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SectionHeader
        titulo="Centros de Custo"
        subtitulo="Sincronizados do Conta Azul; criáveis manualmente"
        onNew={onNew}
      />
      <ul className="divide-y divide-border rounded-lg border border-border">
        {centros.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className={cn(!c.ativo && "text-muted-foreground line-through")}>
              {c.codigo ? `${c.codigo} · ` : ""}
              {c.nome}
            </span>
            {c.ca_centro_id && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                CA
              </span>
            )}
            <RowActions
              ativo={c.ativo}
              onEdit={() => onEdit(c)}
              onToggle={() => onToggle(c)}
              onDelete={() => onDelete(c)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CentroForm({ item, onSaved }: { item: FinCentro | null; onSaved: () => void }) {
  const [nome, setNome] = useState(item?.nome ?? "");
  const [codigo, setCodigo] = useState(item?.codigo ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = { nome, codigo: codigo || null };
      if (item) await send(`/api/financeiro/centros/${item.id}`, "PATCH", body);
      else await send("/api/financeiro/centros", "POST", body);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormShell
      titulo={item ? "Editar centro" : "Novo centro"}
      busy={busy}
      err={err}
      onSubmit={submit}
    >
      <FormField label="Nome">
        <Input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
      </FormField>
      <FormField label="Código">
        <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} />
      </FormField>
    </FormShell>
  );
}

/* ------------------------------------------------------------------- primitivos */

function SectionHeader({
  titulo,
  subtitulo,
  onNew,
}: {
  titulo: string;
  subtitulo: string;
  onNew: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div>
        <h2 className="text-sm font-semibold">{titulo}</h2>
        <p className="text-xs text-muted-foreground">{subtitulo}</p>
      </div>
      <Button variant="outline" size="sm" className="ml-auto" onClick={onNew}>
        <IconPlus className="h-4 w-4" />
        Novo
      </Button>
    </div>
  );
}

function RowActions({
  ativo,
  onEdit,
  onToggle,
  onDelete,
}: {
  ativo: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="ml-auto flex items-center gap-1">
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Editar">
        <IconPencil className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={onToggle}
        title={ativo ? "Inativar" : "Reativar"}
      >
        {ativo ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        onClick={onDelete}
        title="Excluir"
      >
        <IconTrash className="h-4 w-4" />
      </Button>
    </div>
  );
}

function FormShell({
  titulo,
  busy,
  err,
  onSubmit,
  children,
}: {
  titulo: string;
  busy: boolean;
  err: string | null;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{titulo}</DialogTitle>
      </DialogHeader>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
        {err && <p className="text-xs text-destructive">{err}</p>}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            Cancelar
          </DialogClose>
          <Button type="submit" disabled={busy}>
            {busy ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
