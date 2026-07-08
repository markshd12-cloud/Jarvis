// Extração de texto de arquivos externos para indexar como fonte estática.
// Parsers leves e sem dependências — o objetivo é texto pesquisável, não fidelidade.

export const ACCEPTED_EXTENSIONS = [
  ".html",
  ".htm",
  ".csv",
  ".tsv",
  ".txt",
  ".md",
  ".markdown",
  ".json",
] as const;

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_TEXT_CHARS = 200_000; // teto do texto indexado (o chunker fatia depois)

export interface ExtractResult {
  text: string;
  /** Título sugerido (nome do arquivo sem extensão). */
  title: string;
  /** true se o texto foi cortado por exceder MAX_TEXT_CHARS. */
  truncated: boolean;
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

/** Extrai texto de um arquivo enviado, escolhendo o parser pela extensão. */
export async function extractFileText(file: File): Promise<ExtractResult> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Arquivo muito grande (máximo 5 MB).");
  }
  const name = file.name || "arquivo";
  const ext = extensionOf(name);
  const raw = await file.text();

  let text: string;
  switch (ext) {
    case ".csv":
      text = csvToText(raw);
      break;
    case ".tsv":
      text = csvToText(raw, "\t");
      break;
    case ".html":
    case ".htm":
      text = htmlToText(raw);
      break;
    case ".json":
      text = jsonToText(raw);
      break;
    default:
      text = raw; // txt, md, markdown ou desconhecido → texto puro
  }

  text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const truncated = text.length > MAX_TEXT_CHARS;
  if (truncated) text = text.slice(0, MAX_TEXT_CHARS);

  return { text, title: name.replace(/\.[^.]+$/, ""), truncated };
}

// ---- CSV / TSV --------------------------------------------------------------

function detectDelimiter(raw: string): string {
  const firstLine = raw.split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of firstLine) {
    if (ch in counts) counts[ch]++;
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",") as string;
}

/** Parser de CSV com aspas (campos com vírgula/aspas/quebra de linha). */
function parseCsv(raw: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuotes) {
      if (c === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Converte CSV em texto pesquisável: usa a 1ª linha como cabeçalho e representa
 * cada linha como "Coluna: valor | Coluna: valor" (assim cada linha vira contexto
 * semanticamente útil para o RAG).
 */
function csvToText(raw: string, forcedDelimiter?: string): string {
  const delimiter = forcedDelimiter ?? detectDelimiter(raw);
  const rows = parseCsv(raw, delimiter).filter((r) => r.some((c) => c.trim() !== ""));
  if (rows.length === 0) return "";

  const headers = rows[0].map((h) => h.trim());
  if (rows.length === 1) return headers.join(" | ");

  const lines: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const parts: string[] = [];
    for (let j = 0; j < cells.length; j++) {
      const value = (cells[j] ?? "").trim();
      if (!value) continue;
      const key = headers[j]?.trim();
      parts.push(key ? `${key}: ${value}` : value);
    }
    if (parts.length) lines.push(parts.join(" | "));
  }
  return lines.join("\n");
}

// ---- HTML -------------------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => safeChar(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeChar(parseInt(n, 16)));
}

function safeChar(code: number): string {
  try {
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  } catch {
    return "";
  }
}

/** Remove script/style/tags do HTML e devolve o texto legível. */
function htmlToText(html: string): string {
  let t = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|li|tr|section|article|h[1-6]|ul|ol)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  t = decodeEntities(t);
  return t
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

// ---- JSON -------------------------------------------------------------------

function jsonToText(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw; // JSON inválido → indexa como texto puro
  }
}
