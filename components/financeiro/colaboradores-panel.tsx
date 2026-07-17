"use client";

import { useCallback, useEffect, useState } from "react";
import {
  IconEye,
  IconEyeOff,
  IconPencil,
  IconPlus,
  IconTrash,
  IconUserPlus,
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
  TIPOS_PESSOA,
  type BusinessUnit,
  type FinColaborador,
  type MembroEmpresa,
  type TipoPessoa,
} from "@/lib/financeiro/types";

/**
 * Aba Colaboradores & Fornecedores (Passo 5). Pessoas internas p/ atrelar despesa
 * de pessoal. Dados sensíveis (pix/conta) — página só-admin (gate `financeiro`).
 * Inativar tira dos seletores de lançamento; excluir só quando não referenciado.
 */
const selectCls =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const optionCls = "bg-background text-foreground";
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

async function send(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `HTTP ${res.status}`);
  }
}

const TIPO_LABEL: Record<TipoPessoa, string> = {
  colaborador: "Colaboradores",
  fornecedor: "Fornecedores",
};

export function ColaboradoresPanel() {
  const [lista, setLista] = useState<FinColaborador[]>([]);
  const [members, setMembers] = useState<MembroEmpresa[]>([]);
  const [bus, setBus] = useState<BusinessUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [dialog, setDialog] = useState<FinColaborador | "novo" | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [col, b] = await Promise.all([
        fetch("/api/financeiro/colaboradores").then((r) => r.json()),
        fetch("/api/financeiro/bus").then((r) => r.json()),
      ]);
      if (col.error) throw new Error(col.error);
      setLista(col.colaboradores ?? []);
      setMembers(col.members ?? []);
      setBus(b.bus ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const runAction = async (fn: () => Promise<void>) => {
    setActionErr(null);
    try {
      await fn();
      await refetch();
    } catch (e) {
      setActionErr((e as Error).message);
    }
  };

  const remove = (c: FinColaborador) => {
    if (!window.confirm(`Excluir ${c.nome}? Esta ação não pode ser desfeita.`)) return;
    void runAction(() => send(`/api/financeiro/colaboradores/${c.id}`, "DELETE"));
  };

  const importar = () =>
    void runAction(async () => {
      const res = await fetch("/api/financeiro/colaboradores/import", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setAviso(
        j.importados > 0
          ? `${j.importados} usuário(s) importado(s).`
          : "Nenhum usuário novo — todos já estão vinculados.",
      );
    });

  if (loading && lista.length === 0)
    return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (error)
    return (
      <p className="text-sm text-destructive">
        Erro ao carregar: {error}{" "}
        <button className="underline" onClick={() => void refetch()}>
          tentar de novo
        </button>
      </p>
    );

  const buNome = (id: string | null) => bus.find((b) => b.id === id)?.nome;
  const grupos = TIPOS_PESSOA.map((t) => ({
    tipo: t,
    itens: lista.filter((c) => c.tipo === t),
  }));

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-sm font-semibold">Colaboradores & Fornecedores</h2>
          <p className="text-xs text-muted-foreground">
            Pessoas internas para atrelar despesa de pessoal
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={importar}
          title="Cria um colaborador para cada usuário da empresa ainda não vinculado"
        >
          <IconUserPlus className="h-4 w-4" />
          Importar usuários
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDialog("novo")}>
          <IconPlus className="h-4 w-4" />
          Novo
        </Button>
      </div>

      {aviso && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {aviso}
        </p>
      )}

      {actionErr && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionErr}
        </p>
      )}

      {grupos.map((g) => (
        <div key={g.tipo} className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">
            {TIPO_LABEL[g.tipo]} · {g.itens.length}
          </h3>
          {g.itens.length === 0 ? (
            <p className="text-sm text-muted-foreground">— nenhum —</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {g.itens.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className={cn(!c.ativo && "text-muted-foreground line-through")}>
                    {c.nome}
                  </span>
                  {c.profile_id && (
                    <span
                      className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                      title="Vinculado a um usuário do painel de Empresas"
                    >
                      login
                    </span>
                  )}
                  {c.cargo && (
                    <span className="text-[10px] text-muted-foreground">{c.cargo}</span>
                  )}
                  {c.bu_id && buNome(c.bu_id) && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {buNome(c.bu_id)}
                    </span>
                  )}
                  {c.salario_base != null && (
                    <span className="text-[10px] text-muted-foreground">
                      {brl.format(c.salario_base)}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setDialog(c)}
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
                          send(`/api/financeiro/colaboradores/${c.id}`, "PATCH", {
                            ativo: !c.ativo,
                          }),
                        )
                      }
                      title={c.ativo ? "Inativar" : "Reativar"}
                    >
                      {c.ativo ? (
                        <IconEyeOff className="h-4 w-4" />
                      ) : (
                        <IconEye className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(c)}
                      title="Excluir"
                    >
                      <IconTrash className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        {dialog !== null && (
          <ColaboradorForm
            item={dialog === "novo" ? null : dialog}
            bus={bus}
            members={members}
            onSaved={() => {
              setDialog(null);
              void refetch();
            }}
          />
        )}
      </Dialog>
    </section>
  );
}

function ColaboradorForm({
  item,
  bus,
  members,
  onSaved,
}: {
  item: FinColaborador | null;
  bus: BusinessUnit[];
  members: MembroEmpresa[];
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    nome: item?.nome ?? "",
    tipo: item?.tipo ?? "colaborador",
    cpf_cnpj: item?.cpf_cnpj ?? "",
    cargo: item?.cargo ?? "",
    salario_base: item?.salario_base != null ? String(item.salario_base) : "",
    bu_id: item?.bu_id ?? "",
    banco: item?.banco ?? "",
    agencia: item?.agencia ?? "",
    conta: item?.conta ?? "",
    chave_pix: item?.chave_pix ?? "",
    profile_id: item?.profile_id ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  // Vincular a um usuário da empresa: prefill do nome + guarda o profile_id.
  const vincular = (id: string) => {
    const m = members.find((x) => x.id === id);
    setF((s) => ({ ...s, profile_id: id, nome: m && !s.nome ? m.nome : s.nome }));
  };

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = {
        nome: f.nome,
        tipo: f.tipo,
        cpf_cnpj: f.cpf_cnpj.trim() || null,
        cargo: f.cargo || null,
        salario_base: f.salario_base.trim() ? Number(f.salario_base) : null,
        bu_id: f.bu_id || null,
        banco: f.banco || null,
        agencia: f.agencia || null,
        conta: f.conta || null,
        chave_pix: f.chave_pix || null,
        profile_id: f.profile_id || null,
      };
      if (item) await send(`/api/financeiro/colaboradores/${item.id}`, "PATCH", body);
      else await send("/api/financeiro/colaboradores", "POST", body);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{item ? "Editar pessoa" : "Nova pessoa"}</DialogTitle>
      </DialogHeader>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-1">
          <Label>Usuário da empresa</Label>
          <select
            className={selectCls}
            value={f.profile_id}
            onChange={(e) => vincular(e.target.value)}
          >
            <option value="" className={optionCls}>
              — sem vínculo (ex.: fornecedor) —
            </option>
            {members.map((m) => (
              <option key={m.id} value={m.id} className={optionCls}>
                {m.nome}
                {m.email ? ` · ${m.email}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Nome</Label>
          <Input value={f.nome} onChange={(e) => set("nome", e.target.value)} autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label>Tipo</Label>
            <select
              className={selectCls}
              value={f.tipo}
              onChange={(e) => set("tipo", e.target.value)}
            >
              {TIPOS_PESSOA.map((t) => (
                <option key={t} value={t} className={optionCls}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>CPF/CNPJ</Label>
            <Input value={f.cpf_cnpj} onChange={(e) => set("cpf_cnpj", e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label>Cargo</Label>
            <Input value={f.cargo} onChange={(e) => set("cargo", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Salário-base</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={f.salario_base}
              onChange={(e) => set("salario_base", e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Business Unit</Label>
          <select
            className={selectCls}
            value={f.bu_id}
            onChange={(e) => set("bu_id", e.target.value)}
          >
            <option value="" className={optionCls}>
              — nenhuma —
            </option>
            {bus.map((b) => (
              <option key={b.id} value={b.id} className={optionCls}>
                {b.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1">
            <Label>Banco</Label>
            <Input value={f.banco} onChange={(e) => set("banco", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Agência</Label>
            <Input value={f.agencia} onChange={(e) => set("agencia", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Conta</Label>
            <Input value={f.conta} onChange={(e) => set("conta", e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Chave Pix</Label>
          <Input value={f.chave_pix} onChange={(e) => set("chave_pix", e.target.value)} />
        </div>
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
