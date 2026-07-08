import { notFound } from "next/navigation";
import Link from "next/link";
import { FolderIcon, MessageSquarePlusIcon } from "lucide-react";

import {
  deleteProjectAction,
  newChatInProjectAction,
  updateProjectAction,
} from "@/app/(app)/chat/actions";
import { Button } from "@/components/ui/button";
import { listConversations } from "@/lib/db/chat";
import { getProject } from "@/lib/db/projects";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const chats = await listConversations(id);

  return (
    <main>
      <section>
        <div className="sectionbox flex-col gap-6 py-10">
          <div className="flex items-center gap-2">
            <FolderIcon className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold tracking-tight">
              {project.name}
            </h1>
          </div>

          {/* Contexto do projeto: instruções injetadas em todo chat aqui dentro */}
          <form action={updateProjectAction} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={project.id} />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="name" className="text-sm font-medium">
                Nome do projeto
              </label>
              <input
                id="name"
                name="name"
                required
                maxLength={120}
                defaultValue={project.name}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="instructions" className="text-sm font-medium">
                Contexto / instruções
              </label>
              <p className="text-xs text-muted-foreground">
                Tudo que você escrever aqui é enviado ao Jarvis em toda conversa
                deste projeto — ex.: quem é o público, tom de voz, regras,
                informações fixas do cliente.
              </p>
              <textarea
                id="instructions"
                name="instructions"
                rows={8}
                maxLength={20000}
                defaultValue={project.instructions ?? ""}
                placeholder="Ex.: Você atende o setor de RH do CPPEM. Sempre trate dados de candidatos como confidenciais…"
                className="resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit">Salvar contexto</Button>
            </div>
          </form>

          {/* Chats do projeto */}
          <div className="flex flex-col gap-3 border-t border-border pt-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Conversas deste projeto</h2>
              <form action={newChatInProjectAction}>
                <input type="hidden" name="projectId" value={project.id} />
                <Button type="submit" size="sm" className="gap-2">
                  <MessageSquarePlusIcon className="h-4 w-4" />
                  Novo chat
                </Button>
              </form>
            </div>

            {chats.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma conversa ainda. Crie a primeira com “Novo chat”.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {chats.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/chat/${c.id}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:bg-accent"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {c.title?.trim() || "Nova conversa"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Excluir projeto */}
          <form
            action={deleteProjectAction}
            className="border-t border-border pt-6"
          >
            <input type="hidden" name="id" value={project.id} />
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              Excluir projeto
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">
              As conversas não são apagadas — voltam a ser chats soltos.
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}
