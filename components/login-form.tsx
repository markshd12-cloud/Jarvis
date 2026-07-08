"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import {
  sendMagicLink,
  signIn,
  type AuthState,
} from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";

const initialState: AuthState = {};

export function LoginForm({ notice }: { notice?: string }) {
  const [showPassword, setShowPassword] = useState(false);
  const [loginState, loginAction, loginPending] = useActionState(
    signIn,
    initialState,
  );
  const [magicState, magicAction, magicPending] = useActionState(
    sendMagicLink,
    initialState,
  );
  const pending = loginPending || magicPending;
  const error = loginState.error ?? magicState.error;

  return (
    <form action={loginAction} className="w-full max-w-sm">
      <div className="mb-8 flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
        <p className="text-sm text-muted-foreground">
          Acesse o HUB de IAs da sua empresa.
        </p>
      </div>

      {notice ? (
        <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {notice}
        </div>
      ) : null}

      <FieldGroup>
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="voce@empresa.com.br"
            required
            aria-invalid={error ? true : undefined}
            className="h-11"
          />
        </Field>

        <Field data-invalid={error ? true : undefined}>
          <div className="flex items-center justify-between">
            <FieldLabel htmlFor="password">Senha</FieldLabel>
            <Link
              href="/redefinir-senha"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Esqueci minha senha
            </Link>
          </div>
          <InputGroup className="h-11">
            <InputGroupInput
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              aria-invalid={error ? true : undefined}
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
          {error ? <FieldError>{error}</FieldError> : null}
          {magicState.message ? (
            <FieldDescription className="text-primary">
              {magicState.message}
            </FieldDescription>
          ) : null}
        </Field>

        <Button type="submit" size="lg" className="h-11" disabled={pending}>
          {loginPending ? "Entrando..." : "Entrar"}
        </Button>

        <Button
          type="submit"
          formAction={magicAction}
          variant="outline"
          size="lg"
          className="h-11"
          disabled={pending}
        >
          {magicPending ? "Enviando..." : "Entrar com link mágico"}
        </Button>

        <FieldDescription className="text-center">
          Não tem acesso? Fale com o administrador da sua empresa.
        </FieldDescription>
      </FieldGroup>
    </form>
  );
}
