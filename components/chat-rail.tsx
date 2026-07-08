"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  MessageSquarePlusIcon,
  SearchIcon,
} from "lucide-react";

import { createProjectAction } from "@/app/(app)/chat/actions";
import { Button } from "@/components/ui/button";
import type { ConversationSummary } from "@/lib/db/chat";
import type { ProjectSummary } from "@/lib/db/projects";
import { cn } from "@/lib/utils";

/** Data curta para o item da lista (relativa nas últimas 24h). */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  const diffH = (Date.now() - d.getTime()) / 3.6e6;
  if (diffH < 24)
    return d.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  if (diffH < 24 * 7)
    return d.toLocaleDateString("pt-BR", { weekday: "short" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** Linha de um chat na rail (nested = recuo dentro do projeto). */
function ChatLink({
  chat,
  active,
  nested,
}: {
  chat: ConversationSummary;
  active: boolean;
  nested?: boolean;
}) {
  return (
    <Link
      href={`/chat/${chat.id}`}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg py-2 text-sm transition-colors",
        nested ? "pr-3 pl-9" : "px-3",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/50",
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        {chat.title?.trim() || "Nova conversa"}
      </span>
      <span
        suppressHydrationWarning
        className="shrink-0 text-xs text-muted-foreground"
      >
        {formatWhen(chat.updated_at)}
      </span>
    </Link>
  );
}

export function ChatRail({
  projects,
  conversations,
}: {
  projects: ProjectSummary[];
  conversations: ConversationSummary[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  // Projetos que o usuário abriu manualmente (além do ativo, que abre sozinho).
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set());

  const isProjectRoute = pathname?.startsWith("/chat/projeto/") ?? false;
  const activeProjectId = isProjectRoute
    ? pathname!.slice("/chat/projeto/".length)
    : undefined;
  const activeChatId =
    !isProjectRoute && pathname?.startsWith("/chat/")
      ? pathname.slice("/chat/".length)
      : undefined;

  // project_id do chat aberto (para destacar/expandir o projeto dele).
  const activeChatProjectId = activeChatId
    ? (conversations.find((c) => c.id === activeChatId)?.project_id ?? null)
    : null;

  // Agrupa as conversas: por projeto + as soltas (sem project_id).
  const { chatsByProject, looseChats } = useMemo(() => {
    const byProject = new Map<string, ConversationSummary[]>();
    const loose: ConversationSummary[] = [];
    for (const c of conversations) {
      if (c.project_id) {
        const arr = byProject.get(c.project_id) ?? [];
        arr.push(c);
        byProject.set(c.project_id, arr);
      } else {
        loose.push(c);
      }
    }
    return { chatsByProject: byProject, looseChats: loose };
  }, [conversations]);

  const q = query.trim().toLowerCase();

  const filteredLooseChats = useMemo(
    () =>
      q
        ? looseChats.filter((c) => (c.title ?? "").toLowerCase().includes(q))
        : looseChats,
    [looseChats, q],
  );

  // Chat solto novo (id ativo ainda não salvo na lista).
  const activeChatIsNew =
    !!activeChatId && !conversations.some((c) => c.id === activeChatId);

  const toggleProject = (id: string) =>
    setOpenProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside className="hidden h-full w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      {/* Busca */}
      <div className="p-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar"
            className="w-full rounded-lg border border-input bg-background py-1.5 pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {/* ---- PROJETOS ---- */}
        <div className="flex items-center justify-between px-2 pt-1 pb-1">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Projetos
          </span>
          <button
            type="button"
            onClick={() => setCreatingProject((v) => !v)}
            aria-label="Novo projeto"
            className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          >
            <FolderPlusIcon className="h-4 w-4" />
          </button>
        </div>

        {creatingProject ? (
          <form
            action={createProjectAction}
            className="mb-1 flex gap-1 px-1"
            onSubmit={() => setCreatingProject(false)}
          >
            <input
              name="name"
              autoFocus
              required
              maxLength={120}
              placeholder="Nome do projeto"
              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
            <Button type="submit" size="sm">
              Criar
            </Button>
          </form>
        ) : null}

        <ul className="mb-2 flex flex-col gap-0.5">
          {projects.map((p) => {
            const projectChats = chatsByProject.get(p.id) ?? [];
            const nameMatches = q ? p.name.toLowerCase().includes(q) : true;
            const matchingChats = q
              ? projectChats.filter((c) =>
                  (c.title ?? "").toLowerCase().includes(q),
                )
              : projectChats;
            // Com busca ativa, esconde projetos sem correspondência (nome/chat).
            if (q && !nameMatches && matchingChats.length === 0) return null;

            const chatsToShow = nameMatches ? projectChats : matchingChats;
            const active = p.id === activeProjectId;
            // Abre sozinho: projeto ativo, dono do chat aberto, ou busca ativa.
            const open =
              !!q ||
              openProjects.has(p.id) ||
              active ||
              p.id === activeChatProjectId;

            return (
              <li key={p.id}>
                <div
                  className={cn(
                    "group flex items-center gap-1 rounded-lg pr-2 transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleProject(p.id)}
                    aria-label={open ? "Recolher projeto" : "Expandir projeto"}
                    aria-expanded={open}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-sidebar-foreground"
                  >
                    <ChevronRightIcon
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        open && "rotate-90",
                      )}
                    />
                  </button>
                  <Link
                    href={`/chat/projeto/${p.id}`}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 py-2 text-sm",
                      active && "font-medium",
                    )}
                  >
                    <FolderIcon className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {projectChats.length > 0 ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {projectChats.length}
                      </span>
                    ) : null}
                  </Link>
                </div>

                {open ? (
                  <ul className="mt-0.5 mb-1 flex flex-col gap-0.5">
                    {chatsToShow.map((c) => (
                      <li key={c.id}>
                        <ChatLink
                          chat={c}
                          active={c.id === activeChatId}
                          nested
                        />
                      </li>
                    ))}
                    {chatsToShow.length === 0 ? (
                      <li className="py-1 pl-9 text-xs text-muted-foreground">
                        Sem conversas ainda.
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </li>
            );
          })}
          {projects.length === 0 ? (
            <li className="px-3 py-1 text-xs text-muted-foreground">
              Nenhum projeto ainda.
            </li>
          ) : null}
        </ul>

        {/* ---- CHATS SOLTOS ---- */}
        <div className="flex items-center justify-between px-2 pt-2 pb-1">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Chats
          </span>
          <button
            type="button"
            onClick={() => router.push(`/chat/${crypto.randomUUID()}`)}
            aria-label="Nova conversa"
            className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          >
            <MessageSquarePlusIcon className="h-4 w-4" />
          </button>
        </div>

        <ul className="flex flex-col gap-0.5">
          {activeChatIsNew ? (
            <li className="flex items-center gap-2 rounded-lg bg-sidebar-accent px-3 py-2 text-sm font-medium text-sidebar-accent-foreground">
              Nova conversa
            </li>
          ) : null}
          {filteredLooseChats.map((c) => (
            <li key={c.id}>
              <ChatLink chat={c} active={c.id === activeChatId} />
            </li>
          ))}
          {filteredLooseChats.length === 0 && !activeChatIsNew ? (
            <li className="px-3 py-1 text-xs text-muted-foreground">
              {q ? "Nenhuma conversa encontrada." : "Nenhuma conversa ainda."}
            </li>
          ) : null}
        </ul>
      </div>
    </aside>
  );
}
