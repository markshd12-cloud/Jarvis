"use client";

import { useActionState, useEffect, useState } from "react";
import { PencilIcon, PlusIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react";

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

export function ManualSources({ sources }: { sources: ManualSource[] }) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {sources.length
            ? `Suas fontes (${sources.length})`
            : "Nenhuma fonte cadastrada ainda."}
        </h2>
        {!adding ? (
          <Button type="button" onClick={() => setAdding(true)}>
            <PlusIcon />
            Inserir fonte
          </Button>
        ) : null}
      </div>

      {adding ? <AddSourceForm onDone={() => setAdding(false)} /> : null}

      <div className="flex flex-col gap-3">
        {sources.map((source) => (
          <SourceCard key={source.id} source={source} />
        ))}
      </div>
    </div>
  );
}

/** Formulário para adicionar uma fonte — por texto digitado OU por arquivo. */
function AddSourceForm({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState(createSource, initial);

  // Fecha ao salvar com sucesso (a lista recarrega via revalidatePath).
  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

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
            className="min-h-32"
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
function SourceCard({ source }: { source: ManualSource }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(updateSource, initial);

  useEffect(() => {
    if (state.ok) setEditing(false);
  }, [state]);

  if (editing) {
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

          <Field data-invalid={state.error ? true : undefined}>
            <FieldLabel htmlFor={`content-${source.id}`}>Conteúdo</FieldLabel>
            <Textarea
              id={`content-${source.id}`}
              name="content"
              defaultValue={source.content}
              className="min-h-40"
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
        <div className="flex flex-col">
          <h3 className="font-medium">{source.title}</h3>
          {source.updatedAt ? (
            <span className="text-xs text-muted-foreground">
              Atualizado em {new Date(source.updatedAt).toLocaleString("pt-BR")}
            </span>
          ) : null}
        </div>

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
