import { redirect } from "next/navigation";

import { listConversations } from "@/lib/db/chat";

// Abrir "Bate-Papo" RETOMA a conversa mais recente (não perde o contexto).
// Se não houver nenhuma, começa uma nova. O painel lateral e o botão
// "Nova conversa" cuidam de criar/alternar conversas.
export default async function ChatIndexPage() {
  const [recent] = await listConversations("loose", 1);
  redirect(`/chat/${recent?.id ?? crypto.randomUUID()}`);
}
