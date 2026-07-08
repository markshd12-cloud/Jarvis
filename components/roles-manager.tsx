"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";

import {
  createRoleAction,
  deleteRoleAction,
  updateRoleAction,
} from "@/app/(app)/empresas/roles-actions";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { CompanyRole } from "@/lib/db/companies";
import {
  ALL_ACTIONS,
  type Action,
  FEATURES,
  type Permissions,
} from "@/lib/permissions";

const actionLabel: Record<Action, string> = {
  ver: "Ver",
  editar: "Editar",
  gerenciar: "Gerenciar",
};

function summarize(permissions: Permissions): string {
  const feats = FEATURES.filter((f) => permissions[f.key]?.length);
  if (feats.length === 0) return "Sem acesso";
  return feats.map((f) => f.label).join(" · ");
}

type EditorTarget = { mode: "create" } | { mode: "edit"; role: CompanyRole };

export function RolesManager({
  companyId,
  roles,
}: {
  companyId: string;
  roles: CompanyRole[];
}) {
  const [target, setTarget] = useState<EditorTarget | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const handleDelete = (role: CompanyRole) => {
    if (!window.confirm(`Excluir a role "${role.name}"? Não dá para desfazer.`)) {
      return;
    }
    startTransition(async () => {
      const res = await deleteRoleAction({ roleId: role.id });
      if (res.error) window.alert(res.error);
      else router.refresh();
    });
  };

  if (target) {
    return (
      <RoleEditor
        companyId={companyId}
        target={target}
        onClose={() => setTarget(null)}
        onSaved={() => {
          setTarget(null);
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Roles ({roles.length})
        </h2>
        <Button type="button" size="sm" onClick={() => setTarget({ mode: "create" })}>
          <PlusIcon />
          Nova role
        </Button>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {roles.map((role) => (
          <li
            key={role.id}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="font-medium">{role.name}</span>
                {role.isBuiltin && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    built-in
                  </span>
                )}
              </div>
              <span className="truncate text-xs text-muted-foreground">
                {summarize(role.permissions)}
              </span>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setTarget({ mode: "edit", role })}
              >
                <PencilIcon />
                Editar
              </Button>
              {!role.isBuiltin && (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => handleDelete(role)}
                >
                  <Trash2Icon />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoleEditor({
  companyId,
  target,
  onClose,
  onSaved,
}: {
  companyId: string;
  target: EditorTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = target.mode === "edit" ? target.role : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [perms, setPerms] = useState<Permissions>(() =>
    editing ? structuredClone(editing.permissions) : {},
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isBuiltin = editing?.isBuiltin ?? false;

  const has = (key: string, action: Action) => perms[key]?.includes(action) ?? false;

  const toggle = (key: string, action: Action) => {
    setPerms((prev) => {
      const current = prev[key] ?? [];
      const next = current.includes(action)
        ? current.filter((a) => a !== action)
        : [...current, action];
      const copy = { ...prev };
      if (next.length) copy[key] = next;
      else delete copy[key];
      return copy;
    });
  };

  const toggleAll = (key: string, available: Action[]) => {
    setPerms((prev) => {
      const copy = { ...prev };
      const allOn = (prev[key]?.length ?? 0) === available.length;
      if (allOn) delete copy[key];
      else copy[key] = [...available];
      return copy;
    });
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = editing
        ? await updateRoleAction({ roleId: editing.id, name, description, permissions: perms })
        : await createRoleAction({ companyId, name, description, permissions: perms });
      if (res.error) setError(res.error);
      else onSaved();
    });
  };

  return (
    <div className="flex flex-col gap-6 rounded-xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-medium">
          {editing ? `Editar role: ${editing.name}` : "Nova role"}
        </h2>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Fechar"
          onClick={onClose}
          disabled={pending}
        >
          <XIcon />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="role-name">Nome</FieldLabel>
          <Input
            id="role-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isBuiltin}
            maxLength={60}
            placeholder="Ex.: RH, Financeiro, Professor"
          />
          {isBuiltin && (
            <span className="text-xs text-muted-foreground">
              Roles built-in não podem ser renomeadas.
            </span>
          )}
        </Field>
        <Field>
          <FieldLabel htmlFor="role-desc">Descrição</FieldLabel>
          <Input
            id="role-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={160}
            placeholder="Breve descrição"
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Permissões</h3>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-xs text-muted-foreground uppercase">
                <th className="px-4 py-2.5 text-left font-medium">Recurso</th>
                {ALL_ACTIONS.map((action) => (
                  <th key={action} className="px-3 py-2.5 text-center font-medium">
                    {actionLabel[action]}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-center font-medium">Todos</th>
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((feature) => {
                const allOn =
                  (perms[feature.key]?.length ?? 0) === feature.actions.length;
                return (
                  <tr key={feature.key} className="border-t border-border/60">
                    <td className="px-4 py-2.5 font-medium">{feature.label}</td>
                    {ALL_ACTIONS.map((action) => {
                      const available = feature.actions.includes(action);
                      return (
                        <td key={action} className="px-3 py-2.5 text-center">
                          {available ? (
                            <CheckboxButton
                              checked={has(feature.key, action)}
                              onClick={() => toggle(feature.key, action)}
                            />
                          ) : (
                            <span className="text-muted-foreground/40">–</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-center">
                      <CheckboxButton
                        checked={allOn}
                        onClick={() => toggleAll(feature.key, feature.actions)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? "Salvando..." : editing ? "Salvar alterações" : "Criar role"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function CheckboxButton({
  checked,
  onClick,
}: {
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      className={`mx-auto flex h-6 w-6 items-center justify-center rounded border-2 transition-colors ${
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border hover:border-muted-foreground"
      }`}
    >
      {checked && <CheckIcon className="h-3.5 w-3.5" />}
    </button>
  );
}
