import type { Metadata } from "next";

import { Chat } from "@/components/chat";
import { getConversationAgent, listAgents } from "@/lib/db/agents";
import { loadConversation } from "@/lib/db/chat";
import { getProfileSettings } from "@/lib/db/profile";

export const metadata: Metadata = {
  title: "Bate-Papo | Jarvis",
};

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [initialMessages, { nickname }, agents, initialAgent] =
    await Promise.all([
      loadConversation(id),
      getProfileSettings(),
      listAgents(),
      getConversationAgent(id),
    ]);

  return (
    <main>
      <section>
        <div className="sectionbox min-h-full flex-col">
          <Chat
            id={id}
            initialMessages={initialMessages}
            nickname={nickname}
            agents={agents}
            initialAgent={initialAgent}
          />
        </div>
      </section>
    </main>
  );
}
