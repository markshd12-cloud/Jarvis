// Anexos do chat: o conteúdo do arquivo (já extraído para texto por
// `lib/sources/extract.ts`) é embutido na mensagem do usuário com marcadores.
// Assim o modelo (Claude via CLI ou Gemini) lê tudo como texto, sem mudar o
// backend — e a UI parseia os marcadores para exibir um "chip" em vez do dump.

export interface ChatAttachment {
  name: string;
  text: string;
  truncated: boolean;
}

// Marcadores distintos e legíveis (o modelo enxerga limites claros do arquivo).
const OPEN = "<<<ANEXO ";
const OPEN_END = ">>>";
const CLOSE = "<<<FIM ANEXO>>>";

const ATTACH_RE = /<<<ANEXO (.+?)>>>\n([\s\S]*?)\n<<<FIM ANEXO>>>/g;

/** Monta o texto da mensagem: pergunta digitada + blocos de cada anexo. */
export function composeMessage(
  text: string,
  attachments: ChatAttachment[],
): string {
  const parts: string[] = [];
  const typed = text.trim();
  if (typed) parts.push(typed);
  for (const a of attachments) {
    const suffix = a.truncated ? "\n[conteúdo truncado por tamanho]" : "";
    parts.push(`${OPEN}${a.name}${OPEN_END}\n${a.text}${suffix}\n${CLOSE}`);
  }
  return parts.join("\n\n");
}

/**
 * Separa a mensagem do usuário em corpo digitado + anexos, para a UI mostrar
 * chips. Robusto: se não houver marcadores, devolve o texto inteiro como corpo.
 */
export function parseMessage(content: string): {
  body: string;
  files: { name: string; text: string }[];
} {
  const files: { name: string; text: string }[] = [];
  const body = content
    .replace(ATTACH_RE, (_full, name: string, text: string) => {
      files.push({ name: name.trim(), text });
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { body, files };
}
