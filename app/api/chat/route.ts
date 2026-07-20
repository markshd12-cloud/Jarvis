import { after } from "next/server";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";

import {
  streamClaudeText,
  ClaudeCliError,
  type ClaudeChunk,
  type ClaudeImage,
} from "@/lib/ai/claude-cli";
import { streamCodexText, CodexError } from "@/lib/ai/codex";
import { CodexAuthError } from "@/lib/ai/codex-auth";
import { generateAndStoreImage } from "@/lib/ai/image";
import {
  detectImageRequest,
  prefersGpt,
  stripGptKeyword,
} from "@/lib/ai/image-intent";
import {
  buildFinanceiroBlock,
  isFinancialQuery,
} from "@/lib/ai/financeiro-context";
import {
  buildMarketingBlock,
  isMarketingQuery,
} from "@/lib/ai/marketing-context";
import { distillMemories } from "@/lib/ai/memory";
import { PRINCIPAL_PROVIDER } from "@/lib/ai/provider";
import {
  searchKnowledge,
  searchDocumentsByDate,
  searchRecentReportsByPerson,
  type DocHit,
} from "@/lib/ai/retrieval";
import { formatTasksBlock, isTaskQuery, searchTasks } from "@/lib/ai/tasks";
import { syncTasksIfStale } from "@/lib/notion/tasks";
import { chatModel } from "@/lib/ai/vertex";
import { parseMessage } from "@/lib/chat/attachments";
import { getAgent, getConversationAgentContext } from "@/lib/db/agents";
import { loadConversation, messageText, saveConversation } from "@/lib/db/chat";
import { getSessionContext } from "@/lib/db/permissions";
import { getConversationProjectContext } from "@/lib/db/projects";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

// Spawn do CLI do Claude + google-auth-library exigem o runtime Node.
export const runtime = "nodejs";
export const maxDuration = 120;

const BASE_SYSTEM =
  "Você é o Jarvis, assistente de IA corporativo. Responda em Português do Brasil, " +
  "de forma clara e objetiva.\n" +
  "As 'Fontes da empresa' são a FONTE DE VERDADE — baseie a resposta nelas. " +
  "Cada fonte vem com um TÍTULO (ex.: '### ICP CPPEM'). Use o título para escolher a fonte que " +
  "corresponde EXATAMENTE ao que o usuário pediu: há marcas/entidades irmãs com nomes parecidos " +
  "(ex.: 'CPPEM Concursos' ≠ 'Colégio CPPEM') — NÃO misture uma com a outra. Se o pedido for " +
  "ambíguo entre fontes, diga quais opções existem e responda pela mais provável.\n" +
  "As 'Memórias internas' são fatos que você aprendeu em conversas com o usuário. Ao cruzá-las com as 'Fontes da empresa':\n" +
  "• Memória CONCORDA com a fonte → responda normalmente.\n" +
  "• Memória responde algo que a fonte NÃO cobre (lacuna) → use a memória como resposta, não diga que não sabe.\n" +
  "• Memória DIVERGE da fonte → responda PRIMEIRO com o dado da fonte (Notion) e, logo abaixo, acrescente a ressalva: 'Obs.: na memória interna há divergência — <o que a memória diz>'.\n" +
  "Nunca use uma memória como prova de que algo NÃO existe.\n" +
  "NUNCA afirme que uma informação 'não existe' ou 'não foi encontrada' só porque não está no contexto. " +
  "Se faltar algo, CHAME a ferramenta buscarConhecimento (pode chamar mais de uma vez, com termos diferentes) ANTES de responder. " +
  "Não comente sobre buscas anteriores, sobre o sistema, nem sobre suas limitações. " +
  "Só depois de realmente buscar, se nada vier, responda 'Não encontrei nos dados disponíveis' — sem inventar.";

// Ferramenta de busca só é usável no caminho do AI SDK (Gemini). No caminho do
// Claude (CLI) o RAG já entra injetado no system, então a busca sob demanda não
// se aplica — por isso o system do Claude não menciona a ferramenta.
const CLAUDE_SYSTEM_SUFFIX =
  "\n\nResponda diretamente, sem prefixar seu próprio nome. " +
  "Baseie-se apenas no contexto recuperado acima e no histórico da conversa.\n\n" +
  "FORMATAÇÃO (a interface renderiza Markdown/GFM): use títulos (##/###), listas, " +
  "**negrito** e tabelas para organizar. Para respostas que ficam melhores em " +
  "blocos visuais, você tem um vocabulário de CARDS via diretivas — use com " +
  "moderação, só quando facilita de verdade a leitura (ex.: apresentar um ICP com " +
  "'Dores', 'Motivações', 'Objeções'; comparar opções; um resumo em destaque). " +
  "NÃO use em respostas curtas/conversa comum.\n" +
  "REGRA DOS DOIS-PONTOS: o container externo precisa de MAIS dois-pontos que o " +
  "interno. A grade '::::cards' usa QUATRO (::::), e cada ':::card' dentro usa TRÊS " +
  "(:::). Feche cada bloco com a MESMA quantidade em linha própria. Exemplo exato:\n" +
  "::::cards\n:::card\n### Título do card\n- item\n- item\n:::\n:::card\n### Outro\n" +
  "Texto do card.\n:::\n::::\n" +
  "E para um destaque/resumo (três dois-pontos):\n:::callout\nTexto importante.\n:::\n" +
  "Dentro dos cards/callout use Markdown normal (listas, negrito). Não escreva HTML cru " +
  "— apenas Markdown e essas diretivas. Todo o conteúdo em Português do Brasil.";

/**
 * Extrai termos-chave (datas DD/MM[/AAAA] e nomes próprios) da pergunta para
 * uma segunda busca, mais focada. A busca principal usa a frase inteira —
 * numa pergunta longa, nome e data ficam diluídos entre palavras de encheção
 * e podem não render entre os melhores trechos. Uma query curta só com os
 * termos-chave (ex.: "Maria Clara 01/07 19/06") tende a casar melhor.
 */
function extractKeyTerms(text: string): string | null {
  const terms = new Set<string>();

  for (const m of text.matchAll(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g)) {
    terms.add(m[0]);
  }
  // Nome próprio: 1ª palavra maiúscula (heurística de nome), seguida de 1-2
  // palavras em QUALQUER caixa (uso casual tipo "Maria clara" não pode falhar
  // aqui), desde que não sejam preposições/palavras de encheção comuns.
  const NAME_STOP =
    "de|da|do|das|dos|e|ou|o|a|os|as|um|uma|para|com|seu|sua|que|no|na|em|dia|hoje|relat[oó]rio|relat[oó]rios";
  const nameRe = new RegExp(
    `\\b[A-ZÀ-Ý][a-zà-ÿ]+(?:\\s+(?!(?:${NAME_STOP})\\b)[A-Za-zÀ-ÿ]{2,})+\\b`,
    "g",
  );
  for (const m of text.matchAll(nameRe)) {
    terms.add(m[0]);
  }

  return terms.size ? [...terms].join(" ") : null;
}

/** Mescla dois conjuntos de documentos (buscas diferentes), sem duplicar por id. */
function mergeDocuments(a: DocHit[], b: DocHit[], limit: number): DocHit[] {
  const byId = new Map<string, DocHit>();
  for (const d of [...a, ...b]) {
    const existing = byId.get(d.id);
    if (!existing || d.score > existing.score) byId.set(d.id, d);
  }
  return [...byId.values()].sort((x, y) => y.score - x.score).slice(0, limit);
}

const NAME_STOP =
  "de|da|do|das|dos|e|ou|o|a|os|as|um|uma|para|com|seu|sua|que|no|na|em|dia|dias|hoje|ontem|relat[oó]rio|relat[oó]rios";

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 45; // intervalos maiores viram lista de datas soltas

function isoFromUTC(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Datas citadas na pergunta → 'AAAA-MM-DD' (formato BR: DD/MM). Sem ano, assume
 * o ano corrente. Se a pergunta indica INTERVALO ("de X até Y", "entre X e Y",
 * "X a Y"), expande todos os dias entre a menor e a maior data.
 */
function parseQueryDates(text: string): string[] {
  const currentYear = new Date().getFullYear();
  const parsed: number[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/g)) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (day < 1 || day > 31 || month < 1 || month > 12) continue;
    let year = currentYear;
    if (m[3]) {
      year = Number(m[3]);
      if (year < 100) year += 2000;
    }
    parsed.push(Date.UTC(year, month - 1, day));
  }
  if (!parsed.length) return [];

  // "até" acentuado quebra o \b final (acentos não são \w em JS) → lookahead.
  const isRange =
    /\bat[eé](?![a-zà-ÿ])/i.test(text) ||
    /\bentre\b/i.test(text) ||
    /\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\s+a\s+\d{1,2}[/-]\d{1,2}/i.test(text);
  if (isRange && parsed.length >= 2) {
    const lo = Math.min(...parsed);
    const hi = Math.max(...parsed);
    if ((hi - lo) / DAY_MS <= MAX_RANGE_DAYS) {
      const out: string[] = [];
      for (let t = lo; t <= hi; t += DAY_MS) out.push(isoFromUTC(t));
      return out;
    }
  }
  return [...new Set(parsed.map(isoFromUTC))];
}

/**
 * Nome da pessoa citado após "de/da/do" (ex.: "relatório de Maria Clara" →
 * "Maria Clara"). Serve de filtro (ilike) na busca por data exata. Primeiro
 * nome já basta — o ilike casa o título completo.
 */
function parseQueryName(text: string): string | null {
  const re = new RegExp(
    `\\b(?:de|da|do)\\s+([A-ZÀ-Ý][a-zà-ÿ]+(?:\\s+(?!(?:${NAME_STOP})\\b)[A-Za-zÀ-ÿ]{2,})*)`,
  );
  const m = re.exec(text);
  return m ? m[1] : null;
}

/** A pergunta é sobre relatório(s) de atividades? */
function isReportQuery(text: string): boolean {
  return /relat[óo]rios?/i.test(text);
}

/**
 * Quantidade pedida em "últimos N relatórios de X". Sem número explícito mas com
 * "últimos", assume 5. Retorna null quando não é um pedido de "últimos".
 */
function parseReportCount(text: string): number | null {
  const m = /[uú]ltim[oa]s?\s+(\d{1,2})/i.exec(text);
  if (m) return Math.min(Number(m[1]), 12);
  return /[uú]ltim[oa]s?\b/i.test(text) ? 5 : null;
}

/**
 * Dias soltos num follow-up ("cade os dias 15, 14, 13, 10") sem mês/barra →
 * 'AAAA-MM-DD' usando o mês/ano de referência (do contexto anterior ou o
 * corrente). Só dispara com "dia(s)", SEM nenhuma data DD/MM (aí parseQueryDates
 * já resolve) e com 2+ números (evita casar "os 5 relatórios" como dia 5).
 */
function parseBareDays(text: string, refMonth: number, refYear: number): string[] {
  if (!/\bdias?\b/i.test(text)) return [];
  if (/\b\d{1,2}[/-]\d{1,2}\b/.test(text)) return [];
  const days: number[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})\b/g)) {
    const day = Number(m[1]);
    if (day >= 1 && day <= 31) days.push(day);
  }
  if (days.length < 2) return [];
  return [
    ...new Set(
      days.map(
        (d) =>
          `${refYear}-${String(refMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      ),
    ),
  ];
}

/** Monta o bloco de conhecimento (RAG) a partir da pergunta atual. */
async function buildKnowledge(
  question: string,
  priorUserText?: string,
  companyId?: string | null,
  canMarketing = false,
  canFinanceiro = false,
): Promise<string> {
  const keyTerms = extractKeyTerms(question);
  let isoDates = parseQueryDates(question);
  let nameFilter = parseQueryName(question);

  // Tarefas: consulta ESTRUTURADA (não similaridade). Só quando a pergunta é de
  // tarefa e há empresa — o resultado entra como bloco próprio no contexto.
  const tasksBlock =
    companyId && isTaskQuery(question)
      ? await searchTasks(companyId, question, nameFilter)
          .then(formatTasksBlock)
          .catch(() => "")
      : "";

  // Marketing (Meta Ads): dados ESTRUTURADOS e GLOBAIS (mesma fonte do Dashboard).
  // Só quando a pergunta é de mídia paga e o usuário tem a permissão `marketing`.
  const marketingBlock =
    canMarketing && isMarketingQuery(question)
      ? await buildMarketingBlock(question).catch(() => "")
      : "";

  const financeiroBlock =
    companyId && canFinanceiro && isFinancialQuery(question)
      ? await buildFinanceiroBlock(companyId).catch(() => "")
      : "";

  // Relatórios são texto quase idêntico entre pessoas/dias → a busca vetorial
  // dilui e "perde" dias inteiros. Por isso os pedidos de relatório vão por
  // caminhos ESTRUTURADOS (report_date / título por pessoa), não por similaridade.
  const reportQuery = isReportQuery(question) || isReportQuery(priorUserText ?? "");

  // Follow-up de relatório sem repetir o nome ("e do dia 16/07", "cade os dias
  // 15, 14, 13") herda a pessoa em foco do turno anterior.
  if (!nameFilter && reportQuery && priorUserText) {
    nameFilter = parseQueryName(priorUserText);
  }

  // "últimos N relatórios de [pessoa]" (ou "relatórios de X" sem data): busca os
  // mais recentes DA PESSOA por report_date, decidido só pela pergunta atual —
  // antes de qualquer herança de data, que atropelaria o "últimos N".
  const recentCount =
    reportQuery && nameFilter && !isoDates.length
      ? (parseReportCount(question) ?? 8)
      : null;

  // Dias soltos num follow-up de relatório → expande com o mês/ano de referência
  // (contexto anterior ou corrente). Complementa parseQueryDates (que exige DD/MM).
  if (reportQuery && !recentCount) {
    const ref = isoDates[0] ?? parseQueryDates(priorUserText ?? "")[0];
    const now = new Date();
    const refMonth = ref ? Number(ref.slice(5, 7)) : now.getMonth() + 1;
    const refYear = ref ? Number(ref.slice(0, 4)) : now.getFullYear();
    const bare = parseBareDays(question, refMonth, refYear);
    if (bare.length) isoDates = [...new Set([...isoDates, ...bare])];
  }

  // Follow-up: "e de Giovana?" (tem nome, mas sem data) herda o intervalo/datas
  // da pergunta anterior. Restrito a esse caso para não colar datas velhas em
  // um assunto novo — e nunca quando é um pedido de "últimos N".
  if (!recentCount && !isoDates.length && nameFilter && priorUserText) {
    isoDates = parseQueryDates(priorUserText);
  }

  const [primary, focused, byDate, byPerson] = await Promise.all([
    searchKnowledge(question),
    keyTerms ? searchKnowledge(keyTerms) : null,
    isoDates.length ? searchDocumentsByDate(isoDates, nameFilter) : null,
    recentCount && nameFilter
      ? searchRecentReportsByPerson(nameFilter, recentCount)
      : null,
  ]);

  const memories = primary.memories;
  let documents = focused
    ? mergeDocuments(primary.documents, focused.documents, 6)
    : primary.documents;
  // Matches estruturados (data exata / por pessoa) entram primeiro (score
  // sentinela) e ampliam o teto para caber todos junto dos melhores da difusa.
  if (byDate?.length) {
    documents = mergeDocuments(byDate, documents, byDate.length + 4);
  }
  if (byPerson?.length) {
    documents = mergeDocuments(byPerson, documents, byPerson.length + 4);
  }

  // Não injeta memórias negativas/meta (evita o modelo repetir "não encontrado").
  const NEGATIVE =
    /(n[ãa]o\s+(foi|foram|h[áa]|t[eê]m|possui|encontr|exist|consig)|busca[s]?\s+anterior|n[ãa]o\s+encontr|sem\s+informa)/i;
  const usefulMemories = memories.filter((m) => !NEGATIVE.test(m.content));

  const blocks: string[] = [];
  if (tasksBlock) blocks.push(tasksBlock);
  if (marketingBlock) blocks.push(marketingBlock);
  if (financeiroBlock) blocks.push(financeiroBlock);
  if (documents.length) {
    blocks.push(
      "## Fontes da empresa (verdade)\n" +
        documents
          .map((d) => `### ${d.title ?? "Fonte"}\n${d.content}`)
          .join("\n\n"),
    );
  }
  if (usefulMemories.length) {
    blocks.push(
      "## Memórias internas (fatos aprendidos em conversas com o usuário)\n" +
        usefulMemories.map((m) => `- [${m.kind}] ${m.content}`).join("\n"),
    );
  }
  return blocks.length
    ? "\n\nContexto recuperado:\n" + blocks.join("\n\n")
    : "";
}

/** Transcrição compacta da conversa para alimentar o prompt do Claude (stdin). */
function renderTranscript(messages: UIMessage[]): string {
  return messages
    .slice(-20)
    .map(
      (m) =>
        `${m.role === "assistant" ? "Jarvis" : "Usuário"}: ${messageText(m)}`,
    )
    .join("\n\n");
}

/**
 * Deltas de texto do provider PRINCIPAL (Claude via CLI ou GPT via backend Codex)
 * com FALLBACK para o Gemini/Vertex. Só cai para o Gemini se o principal falhar
 * ANTES de emitir qualquer texto (ex.: não logado / limite de uso) — nunca no
 * meio da resposta.
 */
async function* principalWithGeminiFallback(params: {
  system: string;
  prompt: string;
  messages: UIMessage[];
  images?: ClaudeImage[];
  signal?: AbortSignal;
}): AsyncGenerator<ClaudeChunk> {
  let startedText = false;
  try {
    const principal =
      PRINCIPAL_PROVIDER === "codex"
        ? streamCodexText({
            system: params.system + CLAUDE_SYSTEM_SUFFIX,
            prompt: params.prompt,
            images: params.images,
            signal: params.signal,
          })
        : streamClaudeText({
            system: params.system + CLAUDE_SYSTEM_SUFFIX,
            prompt: params.prompt,
            images: params.images,
            signal: params.signal,
          });
    for await (const chunk of principal) {
      if (chunk.type === "text") startedText = true;
      yield chunk;
    }
    return;
  } catch (error) {
    if (startedText) throw error; // já emitiu texto: não dá para trocar de motor
    const recoverable =
      error instanceof ClaudeCliError ||
      error instanceof CodexError ||
      error instanceof CodexAuthError;
    if (!recoverable) throw error;
    console.warn(
      `[chat] provider principal (${PRINCIPAL_PROVIDER}) indisponível, ` +
        "usando Gemini como fallback:",
      (error as Error).message,
      (error as { detail?: string }).detail ?? "",
    );
  }

  yield { type: "status", label: "Pensando…" };
  const result = streamText({
    model: chatModel,
    system: params.system,
    messages: await convertToModelMessages(params.messages),
    abortSignal: params.signal,
  });
  for await (const delta of result.textStream) yield { type: "text", delta };
}

/** System do modo busca web: o modelo DEVE usar a WebSearch (o botão foi ligado
 *  de propósito). Recebe a transcrição da conversa para dar conta de follow-ups,
 *  mas a resposta em si vem da web (não do contexto interno do Notion). */
const WEB_SEARCH_SYSTEM =
  "Você é o Jarvis, assistente corporativo. O usuário ativou a BUSCA NA WEB. " +
  "Você recebe a TRANSCRIÇÃO da conversa (linhas 'Usuário:' e 'Jarvis:'); a última " +
  "linha 'Usuário:' é a mensagem ATUAL. Responda a ela usando SEMPRE a ferramenta " +
  "WebSearch para pesquisar na internet — tratando as mensagens anteriores como " +
  "CONTEXTO (perguntas de continuidade como 'e o passo 2?' se referem ao que já foi " +
  "dito). Baseie a resposta nos resultados da busca e cite as fontes (títulos e/ou " +
  "links) ao final. Se a busca não retornar nada útil, diga que não encontrou. Não " +
  "prefixe seu próprio nome nem comente sobre o sistema. Responda em Português do " +
  "Brasil, de forma clara e objetiva. Markdown.";

/**
 * Modo BUSCA WEB (botão do chat): responde direto da web via ferramenta WebSearch
 * do Claude, ignorando o Notion e demais fontes internas. Nunca lança — em falha,
 * degrada com uma mensagem curta. Timeout maior: buscas encadeadas passam de 120s.
 */
async function* streamWebSearch(params: {
  transcript: string;
  signal?: AbortSignal;
}): AsyncGenerator<ClaudeChunk> {
  yield { type: "status", label: "Pesquisando na web…" };
  try {
    for await (const chunk of streamClaudeText({
      system: WEB_SEARCH_SYSTEM,
      prompt: params.transcript,
      allowWebSearch: true,
      timeoutMs: 180_000,
      signal: params.signal,
    })) {
      yield chunk;
    }
  } catch (error) {
    console.error("[chat] busca web falhou:", error);
    yield {
      type: "text",
      delta:
        "Não consegui completar a busca na web agora. Tente novamente em instantes.",
    };
  }
}

/** Alt de markdown seguro: sem quebras, sem colchetes que quebrem o `![...]`. */
function toAltText(prompt: string): string {
  return prompt.replace(/[\[\]\r\n]+/g, " ").trim().slice(0, 120);
}

/**
 * Turno de imagem: gera (Imagen por padrão; GPT via OAuth quando `preferGpt`),
 * hospeda no Storage e transmite a imagem como markdown `![](url)` — reaproveita
 * streaming/persistência/render do texto.
 */
function imageTurn(params: {
  id: string;
  messages: UIMessage[];
  prompt: string;
  companyId: string | null;
  preferGpt: boolean;
}): Response {
  const stream = createUIMessageStream<UIMessage>({
    originalMessages: params.messages,
    onError: () =>
      "Não consegui gerar a imagem agora. Tente novamente em instantes.",
    execute: async ({ writer }) => {
      const assistantId = crypto.randomUUID();
      writer.write({
        type: "data-status",
        // GPT-imagem é mais lento (~47s) — avisa no status.
        data: {
          label: params.preferGpt
            ? "Gerando imagem com o GPT… (pode levar alguns segundos)"
            : "Gerando imagem…",
        },
        transient: true,
      });

      let text: string;
      try {
        const { url } = await generateAndStoreImage(params.prompt, {
          companyId: params.companyId,
          conversationId: params.id,
          preferGpt: params.preferGpt,
        });
        text = `![${toAltText(params.prompt)}](${url})`;
      } catch (error) {
        console.error("[chat] geração de imagem falhou:", error);
        text =
          "Não consegui gerar a imagem. Verifique se o modelo Imagen está " +
          "habilitado no projeto do Google Cloud e tente novamente.";
      }

      writer.write({ type: "text-start", id: assistantId });
      writer.write({ type: "text-delta", id: assistantId, delta: text });
      writer.write({ type: "text-end", id: assistantId });

      const assistant: UIMessage = {
        id: assistantId,
        role: "assistant",
        parts: [{ type: "text", text }],
      };
      after(async () => {
        try {
          await saveConversation(params.id, [...params.messages, assistant]);
        } catch (error) {
          console.error("[chat] persistência da imagem falhou:", error);
        }
      });
    },
  });

  return createUIMessageStreamResponse({ stream });
}

export async function POST(req: Request) {
  // Defesa em profundidade: só usuários autenticados (além do proxy).
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Permissão de uso do chat (a UI já esconde, mas a API também barra).
  const ctx = await getSessionContext();
  if (!can(ctx, "chat")) {
    return new Response("Forbidden", { status: 403 });
  }

  const {
    id,
    message,
    agentId,
    webSearch,
  }: {
    id: string;
    message: UIMessage;
    agentId?: string | null;
    webSearch?: boolean;
  } = await req.json();

  // Histórico persistido + a nova mensagem do usuário.
  const previous = await loadConversation(id);
  const messages = [...previous, message];

  // ---- Geração de IMAGEM ---------------------------------------------------
  // Se o pedido é para CRIAR uma imagem, este turno vai para o gerador de imagem
  // (o bridge do Claude roda sem ferramentas). Padrão = Imagen (rápido); se o
  // pedido menciona "GPT" ("com o gpt", "pelo gpt"…), aquela imagem vai para o
  // GPT via OAuth (sem API key). Devolve a imagem como markdown `![](url)`.
  const imagePrompt = detectImageRequest(parseMessage(messageText(message)).body);
  if (imagePrompt) {
    const useGpt = prefersGpt(imagePrompt);
    return imageTurn({
      id,
      messages,
      // Tira a frase de roteamento ("com o gpt") do prompt da imagem.
      prompt: useGpt ? stripGptKeyword(imagePrompt) : imagePrompt,
      companyId: ctx.companyId,
      preferGpt: useGpt,
    });
  }

  // Tarefa: mantém o espelho fresco em segundo plano (não bloqueia a resposta;
  // o próximo turno já vê os dados novos). O primeiro sync ainda é manual/cron.
  if (ctx.companyId && isTaskQuery(messageText(message))) {
    const companyId = ctx.companyId;
    after(() => syncTasksIfStale(companyId));
  }

  // Última fala do usuário (para o follow-up herdar datas do turno anterior).
  const priorUser = [...previous].reverse().find((m) => m.role === "user");

  // Persona do agente (tri-state do body): string = usa esse agente (menu "/");
  // null = sem agente; undefined = usa o vínculo persistido da conversa.
  const agentCtxPromise =
    agentId === undefined
      ? getConversationAgentContext(id)
      : agentId
        ? getAgent(agentId).then((a) =>
            a ? { name: a.name, systemPrompt: a.systemPrompt } : null,
          )
        : Promise.resolve(null);
  const [agentCtx, projectCtx, knowledge] = await Promise.all([
    agentCtxPromise,
    getConversationProjectContext(id),
    // Modo busca web (botão ligado): pula TODO o contexto interno (Notion,
    // financeiro, marketing, tarefas) — a resposta vem só da web.
    webSearch
      ? Promise.resolve("")
      : buildKnowledge(
          messageText(message),
          priorUser ? messageText(priorUser) : undefined,
          ctx.companyId,
          can(ctx, "marketing"),
          can(ctx, "financeiro"),
        ),
  ]);
  // A persona vem PRIMEIRO e domina o comportamento; as regras de formatação do
  // BASE_SYSTEM seguem valendo. O RAG da empresa continua injetado.
  const agentBlock = agentCtx
    ? `# Persona: você é o agente "${agentCtx.name}"\nAja estritamente conforme esta persona em TODAS as respostas:\n${agentCtx.systemPrompt}\n\n`
    : "";
  const projectBlock = projectCtx
    ? `\n\n## Contexto do projeto "${projectCtx.name}" (instruções do usuário — priorize)\n${projectCtx.instructions}`
    : "";
  const system = agentBlock + BASE_SYSTEM + projectBlock + knowledge;

  // Imagens anexadas (file parts) → Claude lê via ferramenta Read confinada.
  const images: ClaudeImage[] = [];
  for (const part of message.parts ?? []) {
    if (part.type === "file" && part.mediaType.startsWith("image/")) {
      images.push({ mediaType: part.mediaType, dataUrl: part.url });
    }
  }

  // ---- Caminho PRINCIPAL: Claude (CLI) ou GPT (backend Codex), ambos com
  // sessão OAuth e SEM API key. -------
  if (PRINCIPAL_PROVIDER === "claude" || PRINCIPAL_PROVIDER === "codex") {
    const stream = createUIMessageStream<UIMessage>({
      originalMessages: messages,
      onError: (error) => {
        console.error("[chat] erro no stream:", error);
        return "Desculpe, tive um problema para responder agora. Tente novamente.";
      },
      execute: async ({ writer }) => {
        const assistantId = crypto.randomUUID();
        let started = false;
        let text = "";

        // Botão de busca web ligado → resposta direta da web (só no Claude, que
        // tem a ferramenta WebSearch). Caso contrário, caminho normal.
        const source =
          webSearch && PRINCIPAL_PROVIDER === "claude"
            ? streamWebSearch({
                transcript: renderTranscript(messages),
                signal: req.signal,
              })
            : principalWithGeminiFallback({
                system,
                prompt: renderTranscript(messages),
                messages,
                images,
                signal: req.signal,
              });
        for await (const chunk of source) {
          if (chunk.type === "status") {
            // Transiente: alimenta o feedback ao vivo, não vira parte da mensagem.
            writer.write({
              type: "data-status",
              data: { label: chunk.label },
              transient: true,
            });
            continue;
          }
          if (!started) {
            writer.write({ type: "text-start", id: assistantId });
            started = true;
          }
          text += chunk.delta;
          writer.write({
            type: "text-delta",
            id: assistantId,
            delta: chunk.delta,
          });
        }

        if (started) writer.write({ type: "text-end", id: assistantId });
        if (!text) return;

        const assistant: UIMessage = {
          id: assistantId,
          role: "assistant",
          parts: [{ type: "text", text }],
        };
        const finalMessages = [...messages, assistant];

        // Persiste (grava o vínculo do agente se veio no body) e destila memória.
        after(async () => {
          try {
            await saveConversation(id, finalMessages, agentId);
            await distillMemories(id, finalMessages);
          } catch (error) {
            console.error("[chat] pós-processamento falhou:", error);
          }
        });
      },
    });

    return createUIMessageStreamResponse({ stream });
  }

  // ---- Caminho alternativo: Gemini via Vertex (AI SDK, com ferramentas) ----
  const result = streamText({
    model: chatModel,
    system,
    messages: await convertToModelMessages(messages),
    // Híbrido: ferramenta para o modelo buscar mais conhecimento sob demanda.
    tools: {
      buscarConhecimento: tool({
        description:
          "Busca, por similaridade semântica, conhecimento da empresa (memórias e " +
          "documentos do Notion). Use quando precisar de contexto que não está na " +
          "conversa nem no que já foi fornecido.",
        inputSchema: z.object({
          consulta: z.string().describe("o que buscar, em linguagem natural"),
        }),
        execute: async ({ consulta }) => {
          const found = await searchKnowledge(consulta, {
            count: 8,
            memThreshold: 0.35,
          });
          return [
            ...found.memories.map((m) => ({ tipo: m.kind, texto: m.content })),
            ...found.documents.map((d) => ({
              tipo: "notion",
              fonte: d.title ?? undefined,
              texto: d.content,
            })),
          ];
        },
      }),
    },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: ({ messages }) => {
      // Persiste (grava o vínculo do agente se veio no body) e destila memória.
      after(async () => {
        try {
          await saveConversation(id, messages, agentId);
          await distillMemories(id, messages);
        } catch (error) {
          console.error("[chat] pós-processamento falhou:", error);
        }
      });
    },
  });
}
