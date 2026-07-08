"use client";

import { useActionState } from "react";
import Link from "next/link";

import { requestPasswordReset, type AuthState } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const initialState: AuthState = {};

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(
    requestPasswordReset,
    initialState,
  );

  return (
    <form action={action} className="w-full max-w-sm">
      <div className="mb-8 flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          Redefinir senha
        </h1>
        <p className="text-sm text-muted-foreground">
          Informe seu email e enviaremos um link para criar uma nova senha.
        </p>
      </div>

      <FieldGroup>
        <Field data-invalid={state.error ? true : undefined}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="voce@empresa.com.br"
            required
            aria-invalid={state.error ? true : undefined}
            className="h-11"
          />
          {state.error ? <FieldError>{state.error}</FieldError> : null}
          {state.message ? (
            <FieldDescription className="text-primary">
              {state.message}
            </FieldDescription>
          ) : null}
        </Field>

        <Button type="submit" size="lg" className="h-11" disabled={pending}>
          {pending ? "Enviando..." : "Enviar link"}
        </Button>

        <FieldDescription className="text-center">
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Voltar para o login
          </Link>
        </FieldDescription>
      </FieldGroup>
    </form>
  );
}
