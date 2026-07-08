"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { FileUIPart } from "ai";
import {
  ArrowUpIcon,
  CircleStopIcon,
  LoaderIcon,
  MicIcon,
  PaperclipIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { type ChatAttachment, composeMessage } from "@/lib/chat/attachments";
import { encodeWavBase64, resampleTo16k } from "@/lib/audio/wav";
import type { AgentOption } from "@/lib/db/agents";
import { ACCEPTED_EXTENSIONS, extractFileText } from "@/lib/sources/extract";

// Gravação de voz: para automaticamente para não gerar payloads gigantes.
const MAX_RECORDING_MS = 60_000;

/** Textarea que cresce com o conteúdo (entre min e max). */
function useAutoResizeTextarea(minHeight: number, maxHeight: number) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const el = textareaRef.current;
      if (!el) return;
      if (reset) {
        el.style.height = `${minHeight}px`;
        return;
      }
      el.style.height = `${minHeight}px`;
      el.style.height = `${Math.min(Math.max(el.scrollHeight, minHeight), maxHeight)}px`;
    },
    [minHeight, maxHeight],
  );

  useEffect(() => {
    if (textareaRef.current)
      textareaRef.current.style.height = `${minHeight}px`;
  }, [minHeight]);

  return { textareaRef, adjustHeight };
}

const SUGGESTIONS = [
  "Resumir um documento",
  "Analisar uma planilha",
  "Redigir um email",
  "Buscar no conhecimento",
];

// Imagens que o Claude lê via visão (ferramenta Read no servidor).
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"] as const;
const IMAGE_MEDIA: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
// Extensão a partir do media type (nome amigável para prints colados sem nome).
const MEDIA_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const ACCEPT_ATTR = [...ACCEPTED_EXTENSIONS, ...IMAGE_EXTENSIONS].join(",");
const TEXT_SET = new Set<string>(ACCEPTED_EXTENSIONS);
const IMAGE_SET = new Set<string>(IMAGE_EXTENSIONS);

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("falha ao ler o arquivo"));
    reader.readAsDataURL(file);
  });
}

export function AiChatInput({
  onSend,
  placeholder = "Envie uma mensagem...",
  disabled = false,
  showSuggestions = true,
  agents = [],
  activeAgent = null,
  onSelectAgent,
}: {
  onSend?: (message: string, files?: FileUIPart[]) => void;
  placeholder?: string;
  disabled?: boolean;
  showSuggestions?: boolean;
  agents?: AgentOption[];
  activeAgent?: AgentOption | null;
  onSelectAgent?: (agent: AgentOption | null) => void;
}) {
  const [value, setValue] = useState("");
  // Menu de "/" para escolher um agente (estilo Claude).
  const [agentMenuDismissed, setAgentMenuDismissed] = useState(false);
  const [agentHighlight, setAgentHighlight] = useState(0);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [images, setImages] = useState<FileUIPart[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordingState, setRecordingState] = useState<
    "idle" | "recording" | "transcribing"
  >("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const { textareaRef, adjustHeight } = useAutoResizeTextarea(56, 200);

  const canSend =
    (value.trim().length > 0 || attachments.length > 0 || images.length > 0) &&
    !disabled &&
    !reading &&
    recordingState === "idle";

  // "/" no início abre o menu de agentes; o texto após a barra filtra por nome.
  const slashMatch = /^\/(\S*)$/.exec(value);
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : null;
  const filteredAgents =
    slashQuery !== null
      ? agents.filter((a) => a.name.toLowerCase().includes(slashQuery))
      : [];
  const showAgentMenu =
    slashQuery !== null && !agentMenuDismissed && filteredAgents.length > 0;

  function chooseAgent(agent: AgentOption) {
    onSelectAgent?.(agent);
    setValue("");
    setAgentMenuDismissed(true);
    requestAnimationFrame(() => {
      adjustHeight(true);
      textareaRef.current?.focus();
    });
  }

  // Para o microfone se o componente desmontar com uma gravação em andamento.
  useEffect(() => {
    return () => {
      if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordingTimeoutRef.current) {
          clearTimeout(recordingTimeoutRef.current);
          recordingTimeoutRef.current = null;
        }
        void transcribeRecording();
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingState("recording");
      recordingTimeoutRef.current = setTimeout(
        () => mediaRecorderRef.current?.stop(),
        MAX_RECORDING_MS,
      );
    } catch {
      setError("Não foi possível acessar o microfone");
    }
  }

  async function transcribeRecording() {
    setRecordingState("transcribing");
    try {
      const blob = new Blob(chunksRef.current, {
        type: mediaRecorderRef.current?.mimeType || "audio/webm",
      });
      const arrayBuffer = await blob.arrayBuffer();
      const audioContext = new AudioContext();
      const decoded = await audioContext.decodeAudioData(arrayBuffer);
      const mono16k = await resampleTo16k(decoded);
      await audioContext.close();
      const audioBase64 = encodeWavBase64(mono16k);

      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: audioBase64, mediaType: "audio/wav" }),
      });
      if (!response.ok) throw new Error("falha na transcrição");
      const { text } = (await response.json()) as { text: string };

      if (text) {
        const merged = value.trim() ? `${value.trim()} ${text}` : text;
        // Comporta como IA de voz: transcreveu, ENVIA direto (junto de qualquer
        // texto/anexos pendentes). Se o chat está ocupado (disabled), cai no
        // comportamento antigo — preenche o input para não perder a fala.
        if (onSend && !disabled) {
          setRecordingState("idle"); // libera o guard antes de despachar
          dispatchSend(merged, attachments, images);
          return;
        }
        setValue(merged);
        requestAnimationFrame(() => {
          adjustHeight();
          textareaRef.current?.focus();
        });
      } else {
        setError("Não entendi o áudio, tente novamente");
      }
    } catch {
      setError("Falha ao transcrever o áudio");
    } finally {
      setRecordingState("idle");
    }
  }

  function toggleRecording() {
    if (recordingState === "recording") {
      mediaRecorderRef.current?.stop();
    } else if (recordingState === "idle") {
      void startRecording();
    }
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    setReading(true);
    const addedText: ChatAttachment[] = [];
    const addedImages: FileUIPart[] = [];
    const errors: string[] = [];

    for (const file of Array.from(fileList)) {
      const ext = extensionOf(file.name);
      // Prints colados vêm sem extensão no nome → detecta imagem pelo MIME.
      const isImage = file.type.startsWith("image/") || IMAGE_SET.has(ext);
      const label = file.name || "arquivo";
      try {
        if (isImage) {
          if (file.size > MAX_IMAGE_BYTES) {
            errors.push(`${label}: imagem acima de 5 MB`);
            continue;
          }
          const mediaType = file.type || IMAGE_MEDIA[ext] || "image/png";
          const filename =
            file.name?.trim() ||
            `imagem-colada.${MEDIA_EXT[mediaType] ?? "png"}`;
          addedImages.push({
            type: "file",
            filename,
            mediaType,
            url: await fileToDataUrl(file),
          });
        } else if (TEXT_SET.has(ext)) {
          const { text, title, truncated } = await extractFileText(file);
          if (!text.trim()) {
            errors.push(`${label}: vazio ou sem texto legível`);
            continue;
          }
          addedText.push({ name: file.name || title, text, truncated });
        } else {
          errors.push(`${label}: tipo não suportado`);
        }
      } catch (e) {
        errors.push(`${label}: ${(e as Error).message}`);
      }
    }

    if (addedText.length) setAttachments((prev) => [...prev, ...addedText]);
    if (addedImages.length) setImages((prev) => [...prev, ...addedImages]);
    if (errors.length) setError(errors.join(" · "));
    setReading(false);
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  // Despacha a mensagem e limpa o input. Usado pelo botão de enviar e pela voz.
  function dispatchSend(
    text: string,
    atts: ChatAttachment[],
    imgs: FileUIPart[],
  ) {
    onSend?.(composeMessage(text, atts), imgs.length ? imgs : undefined);
    setValue("");
    setAttachments([]);
    setImages([]);
    setError(null);
    adjustHeight(true);
  }

  function submit() {
    if (!canSend) return;
    dispatchSend(value, attachments, images);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Com o menu de agentes aberto, as setas/Enter navegam e escolhem.
    if (showAgentMenu) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setAgentHighlight((h) => Math.min(h + 1, filteredAgents.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setAgentHighlight((h) => Math.max(h - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const agent = filteredAgents[Math.min(agentHighlight, filteredAgents.length - 1)];
        if (agent) chooseAgent(agent);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setAgentMenuDismissed(true);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  // Ctrl+V de um print: anexa a imagem do clipboard. Texto normal cola normal.
  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = event.clipboardData?.files;
    if (!files || files.length === 0) return;
    const hasImage = Array.from(files).some((f) => f.type.startsWith("image/"));
    if (!hasImage) return;
    event.preventDefault();
    void handleFiles(files);
  }

  const hasAttachments = attachments.length > 0 || images.length > 0;

  return (
    <div className="relative w-full max-w-2xl">
      {/* Menu de agentes ("/") — aparece acima do input */}
      {showAgentMenu ? (
        <div className="absolute bottom-full left-0 right-0 mb-2 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
          <div className="border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
            Agentes
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {filteredAgents.map((agent, i) => (
              <li key={agent.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    chooseAgent(agent);
                  }}
                  onMouseEnter={() => setAgentHighlight(i)}
                  className={`flex w-full flex-col items-start px-3 py-2 text-left ${
                    i === agentHighlight ? "bg-accent" : ""
                  }`}
                >
                  <span className="text-sm font-medium">{agent.name}</span>
                  {agent.description ? (
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {agent.description}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-2xl border border-input bg-card shadow-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30"
      >
        {/* Agente ativo da conversa */}
        {activeAgent ? (
          <div className="flex items-center gap-2 px-3 pt-3">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              {activeAgent.name}
              <button
                type="button"
                onClick={() => onSelectAgent?.(null)}
                aria-label="Remover agente"
                className="rounded p-0.5 hover:bg-primary/20"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </span>
          </div>
        ) : null}
        {/* Chips dos anexos (texto + imagens) */}
        {hasAttachments ? (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((a, i) => (
              <span
                key={`txt-${a.name}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/60 py-1 pr-1 pl-2 text-xs text-foreground"
              >
                <PaperclipIcon className="h-3.5 w-3.5 text-primary" />
                <span className="max-w-40 truncate">{a.name}</span>
                {a.truncated ? (
                  <span className="text-muted-foreground">(cortado)</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  aria-label={`Remover ${a.name}`}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {images.map((img, i) => (
              <span
                key={`img-${img.filename}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/60 py-1 pr-1 pl-1 text-xs text-foreground"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.filename ?? "imagem"}
                  className="h-7 w-7 rounded object-cover"
                />
                <span className="max-w-36 truncate">{img.filename}</span>
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  aria-label={`Remover ${img.filename}`}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            adjustHeight();
            // Reabre o menu ao (re)digitar "/" e reseta o realce.
            if (!event.target.value.startsWith("/")) setAgentMenuDismissed(false);
            setAgentHighlight(0);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="w-full resize-none bg-transparent px-4 pt-4 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />

        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={(event) => {
                void handleFiles(event.target.files);
                event.target.value = ""; // permite reanexar o mesmo arquivo
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Anexar arquivo"
              disabled={disabled || reading || recordingState !== "idle"}
              onClick={() => fileInputRef.current?.click()}
            >
              {reading ? (
                <LoaderIcon className="animate-spin" />
              ) : (
                <PaperclipIcon />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={
                recordingState === "recording"
                  ? "Parar gravação"
                  : recordingState === "transcribing"
                    ? "Transcrevendo áudio…"
                    : "Gravar áudio"
              }
              disabled={disabled || recordingState === "transcribing"}
              onClick={toggleRecording}
            >
              {recordingState === "transcribing" ? (
                <LoaderIcon className="animate-spin" />
              ) : recordingState === "recording" ? (
                <CircleStopIcon className="text-destructive animate-pulse" />
              ) : (
                <MicIcon />
              )}
            </Button>
          </div>

          <Button
            type="button"
            size="icon-sm"
            onClick={submit}
            disabled={!canSend}
            aria-label="Enviar mensagem"
          >
            <ArrowUpIcon />
          </Button>
        </div>
      </motion.div>

      {error ? (
        <p className="mt-2 px-1 text-xs text-destructive">{error}</p>
      ) : null}

      {showSuggestions ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <Button
              key={suggestion}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setValue(suggestion)}
              disabled={disabled}
              className="rounded-full text-muted-foreground"
            >
              <SparklesIcon data-icon="inline-start" className="text-primary" />
              {suggestion}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
