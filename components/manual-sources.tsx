"use client";

import { useActionState, useEffect, useState } from "react";
import {
  BuildingIcon,
  CheckIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
  UserIcon,
  XIcon,
} from "lucide-react";

import {
  createSource,
  deleteSource,
  updateSource,
  type SourceState,
} from "@/app/(app)/personalizar/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ManualSource } from "@/lib/db/sources";

const initial: SourceState = {};
const ACCEPT = ".html,.htm,.csv,.tsv,.txt,.md,.markdown,.json";

export interface CompanyOption {
  id: string;
  name: string;
}

interface Ctx {
  canEdit: boolean;
  isSuperadmin: boolean;
  companies: CompanyOption[];
  userCompanyId: string | null;
}

export function ManualSources({
  sources,
  canEdit,
  isSuperadmin,
  companies,
  userCompanyId,
}: {
  sources: ManualSource[];
  /** Sem `personalizar:editar` a lista é só leitura (some inserir/editar/excluir). */
  canEdit: boolean;
  isSuperadmin: boolean;
  companies: CompanyOption[];
  userCompanyId: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const ctx: Ctx = { canEdit, isSuperadmin, companies, userCompanyId };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {sources.length
            ? `Suas fontes (${sources.length})`
            : "Nenhuma fonte cadastrada ainda."}
        </h2>
        {canEdit && !adding ? (
          <Button type="button" onClick={() => setAdding(true)}>
            <PlusIcon />
            Inserir fonte
          </Button>
        ) : null}
      </div>

      {canEdit && adding ? (
        <AddSourceForm ctx={ctx} onDone={() => setAdding(false)} />
      ) : null}

      <div className="flex flex-col gap-3">
        {sources.map((source) => (
          <SourceCard key={source.id} source={source} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

/** Selo do alcance da fonte, com ícone. */
function ScopeBadge({ source }: { source: ManualSource }) {
  const icon = source.personal ? (
    <UserIcon className="h-3.5 w-3.5" />
  ) : (
    <BuildingIcon className="h-3.5 w-3.5" />
  );
  const label = source.personal
    ? "Única — só sua"
    : source.companies.length
      ? source.companies.map((c) => c.name).join(", ")
      : "Sem empresa";

  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
      {icon}
      {label}
    </span>
  );
}

/**
 * Checkbox estilizado (visual do CheckboxButton das roles) que AINDA submete no
 * form: o input nativo fica escondido dentro do label preservando name/value.
 */
function StyledCheckbox({
  name,
  value,
  checked,
  disabled,
  onChange,
  label,
  icon,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <label
      className={`flex select-none items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
        disabled
          ? "cursor-not-allowed opacity-40"
          : "cursor-pointer hover:border-muted-foreground"
      } ${checked ? "border-primary bg-primary/10" : "border-border"}`}
    >
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border"
        }`}
      >
        {checked ? <CheckIcon className="h-3.5 w-3.5" /> : null}
      </span>
      {icon}
      {label}
    </label>
  );
}

/**
 * Checkboxes de alcance. Emite `personal=1` (pessoal) OU vários `companyIds`.
 * Marcar "Única" desabilita as empresas (pessoal tem prioridade no servidor).
 * Superadmin vê um checkbox por empresa; o comum vê só "Minha empresa".
 */
function ScopeFields({
  ctx,
  defaultPersonal,
  defaultCompanyIds,
}: {
  ctx: Ctx;
  defaultPersonal: boolean;
  defaultCompanyIds: string[];
}) {
  const [personal, setPersonal] = useState(defaultPersonal);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaultCompanyIds),
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Superadmin: todas as empresas. Comum: só a própria (se houver).
  const companyOptions: CompanyOption[] = ctx.isSuperadmin
    ? ctx.companies
    : ctx.userCompanyId
      ? [{ id: ctx.userCompanyId, name: "Minha empresa" }]
      : [];

  return (
    <Field>
      <FieldLabel>Quem enxerga esta fonte</FieldLabel>

      {/* Empresas lado a lado (quebram em linha quando não cabem). */}
      <div className="flex flex-wrap gap-2">
        {companyOptions.map((c) => (
          <StyledCheckbox
            key={c.id}
            name="companyIds"
            value={c.id}
            checked={!personal && selected.has(c.id)}
            disabled={personal}
            onChange={() => toggle(c.id)}
            label={c.name}
            icon={<BuildingIcon className="h-3.5 w-3.5 text-muted-foreground" />}
          />
        ))}
      </div>

      <StyledCheckbox
        name="personal"
        value="1"
        checked={personal}
        onChange={setPersonal}
        label="Única — só para mim"
        icon={<UserIcon className="h-3.5 w-3.5 text-muted-foreground" />}
      />
    </Field>
  );
}

/** Formulário para adicionar uma fonte — por texto digitado OU por arquivo. */
function AddSourceForm({ ctx, onDone }: { ctx: Ctx; onDone: () => void }) {
  const [state, action, pending] = useActionState(createSource, initial);

  // Fecha ao salvar com sucesso (a lista recarrega via revalidatePath).
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

  // Comum já vem com a própria empresa marcada; superadmin escolhe.
  const defaultCompanies =
    !ctx.isSuperadmin && ctx.userCompanyId ? [ctx.userCompanyId] : [];

  return (
    <form action={action} className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium">Nova fonte</h3>
          <p className="text-sm text-muted-foreground">
            Escreva o texto ou envie um arquivo (HTML, CSV, TXT, MD, JSON).
          </p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Fechar"
          onClick={onDone}
          disabled={pending}
        >
          <XIcon />
        </Button>
      </div>

      <div className="flex flex-col gap-5">
        <Field data-invalid={state.error ? true : undefined}>
          <FieldLabel htmlFor="new-title">Título da fonte</FieldLabel>
          <Input
            id="new-title"
            name="title"
            placeholder="Ex.: Política de reembolso (deixe em branco p/ usar o nome do arquivo)"
            maxLength={120}
            aria-invalid={state.error ? true : undefined}
          />
        </Field>

        <ScopeFields
          ctx={ctx}
          defaultPersonal={false}
          defaultCompanyIds={defaultCompanies}
        />

        <Field>
          <FieldLabel htmlFor="new-file">Arquivo (opcional)</FieldLabel>
          <Input
            id="new-file"
            name="file"
            type="file"
            accept={ACCEPT}
            className="h-auto py-1.5"
          />
        </Field>

        <Field data-invalid={state.error ? true : undefined}>
          <FieldLabel htmlFor="new-content">Ou digite/cole o conteúdo</FieldLabel>
          <Textarea
            id="new-content"
            name="content"
            placeholder="Escreva o texto que o Jarvis deve usar como verdade…"
            className="max-h-72 min-h-32 overflow-y-auto"
            aria-invalid={state.error ? true : undefined}
          />
        </Field>

        {state.error ? <FieldError>{state.error}</FieldError> : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            <UploadIcon />
            {pending ? "Indexando..." : "Salvar fonte"}
          </Button>
          <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
            Cancelar
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Cartão de uma fonte: visualização com editar/excluir e edição inline. */
function SourceCard({ source, ctx }: { source: ManualSource; ctx: Ctx }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(updateSource, initial);

  // Fecha o editor ao salvar com sucesso. Reagir ao término da server action é o
  // uso legítimo do efeito aqui (não há "onSuccess" no fluxo de <form action>).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (state.ok) setEditing(false);
  }, [state]);

  if (editing && ctx.canEdit) {
    return (
      <form action={action} className="rounded-xl border border-border bg-card p-5">
        <input type="hidden" name="id" value={source.id} />
        <div className="flex flex-col gap-5">
          <Field data-invalid={state.error ? true : undefined}>
            <FieldLabel htmlFor={`title-${source.id}`}>Título da fonte</FieldLabel>
            <Input
              id={`title-${source.id}`}
              name="title"
              defaultValue={source.title}
              maxLength={120}
              required
              aria-invalid={state.error ? true : undefined}
            />
          </Field>

          <ScopeFields
            ctx={ctx}
            defaultPersonal={source.personal}
            defaultCompanyIds={source.companyIds}
          />

          <Field data-invalid={state.error ? true : undefined}>
            <FieldLabel htmlFor={`content-${source.id}`}>Conteúdo</FieldLabel>
            <Textarea
              id={`content-${source.id}`}
              name="content"
              defaultValue={source.content}
              className="max-h-72 min-h-40 overflow-y-auto"
              required
              aria-invalid={state.error ? true : undefined}
            />
          </Field>

          {state.error ? <FieldError>{state.error}</FieldError> : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h3 className="font-medium">{source.title}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <ScopeBadge source={source} />
            {source.updatedAt ? (
              <span className="text-xs text-muted-foreground">
                Atualizado em {new Date(source.updatedAt).toLocaleString("pt-BR")}
              </span>
            ) : null}
          </div>
        </div>

        {ctx.canEdit ? (
          <div className="flex shrink-0 gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              <PencilIcon />
              Editar
            </Button>
            <DeleteSourceButton id={source.id} title={source.title} />
          </div>
        ) : null}
      </div>

      <p className="line-clamp-4 text-sm whitespace-pre-wrap text-muted-foreground">
        {source.content}
      </p>
    </div>
  );
}

/** Botão de exclusão com confirmação (form action simples). */
function DeleteSourceButton({ id, title }: { id: string; title: string }) {
  return (
    <form
      action={deleteSource}
      onSubmit={(e) => {
        if (!window.confirm(`Excluir a fonte "${title}"? Não dá para desfazer.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="destructive">
        <Trash2Icon />
        Excluir
      </Button>
    </form>
  );
}
