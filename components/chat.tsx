"use client";

import { useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { PaperclipIcon } from "lucide-react";

import { AiChatInput } from "@/components/ai-chat-input";
import { Markdown } from "@/components/markdown";
import { parseMessage } from "@/lib/chat/attachments";
import type { AgentOption } from "@/lib/db/agents";
import { cn } from "@/lib/utils";

/** Mensagem do usuário: texto digitado + chips dos arquivos-texto anexados. */
function UserMessage({ text }: { text: string }) {
  const { body, files } = parseMessage(text);
  return (
    <>
      {body ? <span className="whitespace-pre-wrap">{body}</span> : null}
      {files.length > 0 ? (
        <div className={cn("flex flex-wrap gap-1.5", body && "mt-2")}>
          {files.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-foreground/15 px-2 py-1 text-xs"
            >
              <PaperclipIcon className="h-3.5 w-3.5" />
              <span className="max-w-48 truncate">{f.name}</span>
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** Frases de saudação (estilo Claude/ChatGPT) para a tela inicial do chat. */
const GREETINGS_WITH_NAME = (name: string) => [
  `De volta ao trabalho, ${name}?`,
  `Bem-vindo de volta, ${name}.`,
  `Pronto pra continuar, ${name}?`,
  `Fala, ${name}. Por onde começamos?`,
  `No que posso ajudar hoje, ${name}?`,
];

const GREETINGS_GENERIC = [
  "Como posso ajudar?",
  "No que posso ajudar hoje?",
  "Pronto quando você estiver.",
];

/** Três pontinhos "pensando". */
function TypingDots() {
  return (
    <span className="inline-flex gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
}

export function Chat({
  id,
  initialMessages,
  nickname,
  agents = [],
  initialAgent = null,
}: {
  id: string;
  initialMessages: UIMessage[];
  nickname?: string;
  agents?: AgentOption[];
  initialAgent?: AgentOption | null;
}) {
  // Label do feedback ao vivo (ex.: "Lendo o anexo…"), vindo do servidor.
  const [statusLabel, setStatusLabel] = useState<string | null>(null);

  // Agente ativo da conversa (escolhido pelo menu "/"). Vai no body por envio.
  const [activeAgent, setActiveAgent] = useState<AgentOption | null>(initialAgent);

  // Sorteada no client (após montar) para não divergir da renderização do servidor.
  const [greeting, setGreeting] = useState(GREETINGS_GENERIC[0]);
  useEffect(() => {
    const options = nickname ? GREETINGS_WITH_NAME(nickname) : GREETINGS_GENERIC;
    setGreeting(options[Math.floor(Math.random() * options.length)]);
  }, [nickname]);

  const { messages, sendMessage, status, error } = useChat({
    id,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest({ messages, id, body }) {
        return {
          body: {
            id,
            message: messages[messages.length - 1],
            // agentId chega via sendMessage(..., { body }) no handleSend.
            agentId: (body as { agentId?: string | null })?.agentId ?? null,
          },
        };
      },
    }),
    onData: (dataPart) => {
      if (dataPart.type === "data-status") {
        const label = (dataPart.data as { label?: string })?.label;
        if (label) setStatusLabel(label);
      }
    },
    onFinish: () => setStatusLabel(null),
  });

  const busy = status === "submitted" || status === "streaming";

  function handleSend(message: string, files?: FileUIPart[]) {
    setStatusLabel(null);
    sendMessage(
      { text: message, files },
      { body: { agentId: activeAgent?.id ?? null } },
    );
  }

  // Mostra o indicador enquanto ocupado e o assistente ainda não emitiu texto.
  const last = messages[messages.length - 1];
  const assistantHasText =
    last?.role === "assistant" &&
    last.parts.some((p) => p.type === "text" && p.text.length > 0);
  const showThinking = busy && !assistantHasText;

  // Estado inicial: hero centralizado com o input.
  if (messages.length === 0) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-8 py-10">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">{greeting}</h1>
        </div>
        <AiChatInput
          onSend={handleSend}
          disabled={busy}
          agents={agents}
          activeAgent={activeAgent}
          onSelectAgent={setActiveAgent}
        />
      </div>
    );
  }

  // Conversa: mensagens roláveis + input fixo embaixo.
  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col py-8">
      <div className="flex flex-1 flex-col gap-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex",
              message.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card text-card-foreground",
              )}
            >
              {message.parts.map((part, i) => {
                if (part.type === "text") {
                  return message.role === "assistant" ? (
                    <Markdown key={i}>{part.text}</Markdown>
                  ) : (
                    <UserMessage key={i} text={part.text} />
                  );
                }
                if (
                  part.type === "file" &&
                  part.mediaType.startsWith("image/")
                ) {
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={part.url}
                      alt={part.filename ?? "imagem anexada"}
                      className="mt-1 max-h-64 rounded-lg border border-primary-foreground/20"
                    />
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}

        {showThinking ? (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
              <TypingDots />
              {statusLabel ?? "Jarvis está pensando…"}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Não foi possível obter a resposta. Tente novamente.
          </div>
        ) : null}
      </div>

      <div className="sticky bottom-0 mt-6 bg-background pb-4 pt-2">
        <AiChatInput
          onSend={handleSend}
          disabled={busy}
          showSuggestions={false}
          agents={agents}
          activeAgent={activeAgent}
          onSelectAgent={setActiveAgent}
        />
      </div>
    </div>
  );
}
