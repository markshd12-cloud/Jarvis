"use client";

import { useActionState, useEffect, useState } from "react";
import { PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";

import {
  type AgentActionState,
  createAgentAction,
  deleteAgentAction,
  updateAgentAction,
} from "@/app/(app)/agentes/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Agent } from "@/lib/db/agents";

const initial: AgentActionState = {};

export function AgentsManager({
  agents,
  canManage,
}: {
  agents: Agent[];
  canManage: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {agents.length
            ? `${agents.length} agente${agents.length !== 1 ? "s" : ""}`
            : "Nenhum agente ainda."}
        </h2>
        {canManage && !creating ? (
          <Button type="button" onClick={() => setCreating(true)}>
            <PlusIcon />
            Novo agente
          </Button>
        ) : null}
      </div>

      <p className="-mt-3 text-sm text-muted-foreground">
        Para conversar com um agente, digite <code className="rounded bg-muted px-1">/</code>{" "}
        no chat e escolha na lista.
      </p>

      {creating ? <AgentForm onDone={() => setCreating(false)} /> : null}

      <div className="flex flex-col gap-3">
        {agents.map((agent) =>
          editing === agent.id ? (
            <AgentForm
              key={agent.id}
              agent={agent}
              onDone={() => setEditing(null)}
            />
          ) : (
            <AgentCard
              key={agent.id}
              agent={agent}
              canManage={canManage}
              onEdit={() => setEditing(agent.id)}
            />
          ),
        )}
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  canManage,
  onEdit,
}: {
  agent: Agent;
  canManage: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-5">
      <div className="min-w-0">
        <h3 className="font-medium">{agent.name}</h3>
        {agent.description ? (
          <p className="text-sm text-muted-foreground">{agent.description}</p>
        ) : null}
      </div>
      {canManage ? (
        <div className="flex shrink-0 gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={onEdit}>
            <PencilIcon />
            Editar
          </Button>
          <form
            action={deleteAgentAction}
            onSubmit={(e) => {
              if (!window.confirm(`Excluir o agente "${agent.name}"?`)) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="id" value={agent.id} />
            <Button type="submit" size="sm" variant="destructive" aria-label="Excluir">
              <Trash2Icon />
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function AgentForm({ agent, onDone }: { agent?: Agent; onDone: () => void }) {
  const action = agent ? updateAgentAction : createAgentAction;
  const [state, formAction, pending] = useActionState(action, initial);

  useEffect(() => {
    if (state.ok) onDone();
  }, [state, onDone]);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6"
    >
      {agent ? <input type="hidden" name="id" value={agent.id} /> : null}

      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-medium">
          {agent ? `Editar agente: ${agent.name}` : "Novo agente"}
        </h3>
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

      <Field data-invalid={state.error ? true : undefined}>
        <FieldLabel htmlFor="agent-name">Nome</FieldLabel>
        <Input
          id="agent-name"
          name="name"
          defaultValue={agent?.name ?? ""}
          placeholder="Ex.: Marketing, Financeiro, Redator"
          maxLength={60}
          required
          aria-invalid={state.error ? true : undefined}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="agent-desc">Descrição (curta)</FieldLabel>
        <Input
          id="agent-desc"
          name="description"
          defaultValue={agent?.description ?? ""}
          placeholder="Uma linha sobre o que ele faz"
          maxLength={200}
        />
      </Field>

      <Field data-invalid={state.error ? true : undefined}>
        <FieldLabel htmlFor="agent-prompt">Prompt do agente (persona)</FieldLabel>
        <Textarea
          id="agent-prompt"
          name="systemPrompt"
          defaultValue={agent?.systemPrompt ?? ""}
          placeholder="Você é o agente de… Sempre responda sob a ótica de… Seja…"
          className="min-h-40"
          required
          aria-invalid={state.error ? true : undefined}
        />
      </Field>

      {state.error ? <FieldError>{state.error}</FieldError> : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando..." : agent ? "Salvar" : "Criar agente"}
        </Button>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
