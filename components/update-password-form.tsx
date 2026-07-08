"use client";

import { useActionState, useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { updatePassword } from "@/app/atualizar-senha/actions";
import { type AuthState } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

const initialState: AuthState = {};

export function UpdatePasswordForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [state, action, pending] = useActionState(updatePassword, initialState);

  return (
    <form action={action} className="w-full max-w-sm">
      <div className="mb-8 flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Nova senha</h1>
        <p className="text-sm text-muted-foreground">
          Defina a nova senha da sua conta.
        </p>
      </div>

      <FieldGroup>
        <Field data-invalid={state.error ? true : undefined}>
          <FieldLabel htmlFor="password">Nova senha</FieldLabel>
          <InputGroup className="h-11">
            <InputGroupInput
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="••••••••"
              required
              aria-invalid={state.error ? true : undefined}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-sm"
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((prev) => !prev)}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>

        <Field data-invalid={state.error ? true : undefined}>
          <FieldLabel htmlFor="confirm">Confirmar senha</FieldLabel>
          <InputGroup className="h-11">
            <InputGroupInput
              id="confirm"
              name="confirm"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="••••••••"
              required
              aria-invalid={state.error ? true : undefined}
            />
          </InputGroup>
          {state.error ? <FieldError>{state.error}</FieldError> : null}
        </Field>

        <Button type="submit" size="lg" className="h-11" disabled={pending}>
          {pending ? "Salvando..." : "Salvar nova senha"}
        </Button>
      </FieldGroup>
    </form>
  );
}
