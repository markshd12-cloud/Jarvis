"use client";

import { useActionState, useState } from "react";
import { PlugIcon, SettingsIcon } from "lucide-react";

import {
  saveProfileSettings,
  type SettingsState,
} from "@/app/(app)/configuracoes/actions";
import { ChatGptConnect } from "@/components/chatgpt-connect";
import { ContaAzulConnect } from "@/components/contaazul-connect";
import { MetaConnect } from "@/components/meta-connect";
import { NotionConnect } from "@/components/notion-connect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import ThemeToggle from "@/components/switch-07";
import type {
  ContaAzulStatus,
  MarketingStatus,
  NotionStatus,
} from "@/lib/db/connections";
import { cn } from "@/lib/utils";

export interface ProfileSettings {
  nickname: string;
  customInstructions: string;
}

type SectionId = "geral" | "conexoes";

const initialState: SettingsState = {};

export function SettingsDialog({
  open,
  onOpenChange,
  initialSettings,
  connections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSettings: ProfileSettings;
  /**
   * `null` esconde a seção Conexões (usuário sem `conhecimento` nem `marketing`).
   * Cada card é `null` quando falta a permissão correspondente.
   */
  connections: {
    notion: NotionStatus | null;
    contaAzul: ContaAzulStatus | null;
    marketing: MarketingStatus | null;
  } | null;
}) {
  const [section, setSection] = useState<SectionId>("geral");

  const sections = [
    { id: "geral" as const, label: "Geral", icon: SettingsIcon },
    ...(connections
      ? [{ id: "conexoes" as const, label: "Conexões", icon: PlugIcon }]
      : []),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[32rem] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl sm:flex-row">
        <DialogTitle className="sr-only">Configurações</DialogTitle>

        <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-sidebar-border bg-sidebar p-3 sm:w-56 sm:flex-col sm:overflow-visible sm:border-r sm:border-b-0">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm whitespace-nowrap text-sidebar-foreground",
                section === item.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/60",
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </button>
          ))}
        </nav>

        {section === "conexoes" && connections ? (
          <ConnectionsSection
            notion={connections.notion}
            contaAzul={connections.contaAzul}
            marketing={connections.marketing}
          />
        ) : (
          <GeneralSection initialSettings={initialSettings} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Aba "Geral": preferências pessoais do usuário (nome, instruções, tema). */
function GeneralSection({
  initialSettings,
}: {
  initialSettings: ProfileSettings;
}) {
  const [state, formAction, pending] = useActionState(
    saveProfileSettings,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex flex-1 flex-col gap-6 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Geral</h2>
          <p className="text-sm text-muted-foreground">
            Como o Jarvis se comporta com você.
          </p>
        </div>

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="nickname">
              Nome que o Jarvis vai te chamar
            </FieldLabel>
            <Input
              id="nickname"
              name="nickname"
              placeholder="Como você quer ser chamado?"
              defaultValue={initialSettings.nickname}
              maxLength={80}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="customInstructions">
              Instruções para o Jarvis
            </FieldLabel>
            <Textarea
              id="customInstructions"
              name="customInstructions"
              placeholder="Ex.: seja direto, prefiro respostas curtas, meu time trabalha com..."
              defaultValue={initialSettings.customInstructions}
              className="min-h-32"
              maxLength={4000}
            />
            <FieldDescription>
              Aplicado em todas as suas conversas com o Jarvis.
            </FieldDescription>
          </Field>

          <Field orientation="horizontal">
            <FieldLabel className="flex-1">Aparência</FieldLabel>
            <ThemeToggle />
          </Field>
        </FieldGroup>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/50 p-4">
        {state.error ? (
          <FieldDescription className="text-destructive">
            {state.error}
          </FieldDescription>
        ) : state.message ? (
          <FieldDescription className="text-primary">
            {state.message}
          </FieldDescription>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </form>
  );
}

/** Aba "Conexões": fontes externas que alimentam o Jarvis (conhecimento e dados). */
function ConnectionsSection({
  notion,
  contaAzul,
  marketing,
}: {
  notion: NotionStatus | null;
  contaAzul: ContaAzulStatus | null;
  marketing: MarketingStatus | null;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex flex-1 flex-col gap-6 p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Conexões</h2>
          <p className="text-sm text-muted-foreground">
            Bases externas que o Jarvis usa como fonte de conhecimento e dados.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-3 text-base font-medium">ChatGPT (GPT)</h3>
            <ChatGptConnect />
          </div>

          {notion ? (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-3 text-base font-medium">Notion</h3>
              <NotionConnect
                connected={notion.connected}
                workspaceName={notion.workspaceName}
                lastSyncedAt={notion.lastSyncedAt}
              />
            </div>
          ) : null}

          {contaAzul ? (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-3 text-base font-medium">Conta Azul</h3>
              <ContaAzulConnect
                connected={contaAzul.connected}
                accountName={contaAzul.accountName}
                lastSyncedAt={contaAzul.lastSyncedAt}
              />
            </div>
          ) : null}

          {marketing ? (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-3 text-base font-medium">Meta Ads</h3>
              <MetaConnect
                connected={marketing.connected}
                accountName={marketing.accountName}
                lastSyncedAt={marketing.lastSyncedAt}
              />
            </div>
          ) : null}

          <ComingSoonConnection
            name="Google Drive"
            description="Sincronize documentos, planilhas e apresentações do Drive."
          />
        </div>
      </div>
    </div>
  );
}

/** Placeholder de conexão futura (Drive e outras bases). */
function ComingSoonConnection({
  name,
  description,
}: {
  name: string;
  description: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-dashed border-border bg-card/50 p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-medium">{name}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <span className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
        Em breve
      </span>
    </div>
  );
}
