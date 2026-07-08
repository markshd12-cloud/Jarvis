"use client";

import { useActionState, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";

import {
  createCompanyAction,
  type CompanyFormState,
} from "@/app/(app)/empresas/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const initial: CompanyFormState = {};

/** Botão "Nova empresa" que expande um formulário inline. */
export function CompanyCreateForm() {
  const [adding, setAdding] = useState(false);
  const [state, action, pending] = useActionState(createCompanyAction, initial);

  if (!adding) {
    return (
      <Button type="button" onClick={() => setAdding(true)}>
        <PlusIcon />
        Nova empresa
      </Button>
    );
  }

  return (
    <form action={action} className="rounded-xl border border-border bg-card p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium">Nova empresa</h3>
          <p className="text-sm text-muted-foreground">
            Ela já nasce com as roles <strong>Administrador</strong> e{" "}
            <strong>Membro</strong>.
          </p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Fechar"
          onClick={() => setAdding(false)}
          disabled={pending}
        >
          <XIcon />
        </Button>
      </div>

      <div className="flex flex-col gap-5">
        <Field data-invalid={state.error ? true : undefined}>
          <FieldLabel htmlFor="company-name">Nome da empresa</FieldLabel>
          <Input
            id="company-name"
            name="name"
            placeholder="Ex.: CPPEM Concursos"
            maxLength={120}
            required
            aria-invalid={state.error ? true : undefined}
          />
        </Field>

        {state.error ? <FieldError>{state.error}</FieldError> : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            <PlusIcon />
            {pending ? "Criando..." : "Criar empresa"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setAdding(false)}
            disabled={pending}
          >
            Cancelar
          </Button>
        </div>
      </div>
    </form>
  );
}
