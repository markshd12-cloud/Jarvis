import { ChatRail } from "@/components/chat-rail";
import { listConversations } from "@/lib/db/chat";
import { guardFeature } from "@/lib/db/permissions";
import { listProjects } from "@/lib/db/projects";

// Painel lateral (rail) com Projetos + Chats soltos + a área da conversa ativa.
export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardFeature("chat");
  // Traz TODAS as conversas: a rail agrupa por projeto (aninhando os chats do
  // projeto) e deixa os soltos numa seção à parte. Chats de projeto não poluem
  // mais a lista principal, mas continuam acessíveis dentro do projeto.
  const [projects, conversations] = await Promise.all([
    listProjects(),
    listConversations(undefined, 200),
  ]);

  return (
    <div className="flex h-full min-h-0">
      <ChatRail projects={projects} conversations={conversations} />
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
