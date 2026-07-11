import { createAdminClient } from "@/lib/supabase/admin";

// Consulta estruturada da tabela-espelho `tasks` para injetar no contexto do chat.
// Diferente do RAG (similaridade), aqui a pergunta vira FILTRO SQL — é o certo para
// "em andamento do Mark", "tarefas atrasadas", "atribuição da tarefa X".

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Status canônicos do board (para casar sinônimos da pergunta).
const STATUS_SYNONYMS: Record<string, string> = {
  "em andamento": "Em andamento",
  andamento: "Em andamento",
  fazendo: "Em andamento",
  "nao iniciada": "Não iniciada",
  "nao iniciado": "Não iniciada",
  pendente: "Não iniciada",
  parada: "Pausada",
  pausada: "Pausada",
  concluida: "Concluída",
  concluido: "Concluída",
  finalizada: "Concluída",
  feita: "Concluída",
  cancelada: "Cancelada",
  cancelado: "Cancelada",
};

const TASK_HINTS =
  /\b(tarefas?|task|atribui|respons[aá]vel|em andamento|pend[êe]nte|prazo|atrasad|kanban|afazer|a fazer|okr|objetivo)\b/i;

/** A pergunta é sobre tarefas? Heurística leve (palavras-chave). */
export function isTaskQuery(text: string): boolean {
  return TASK_HINTS.test(text);
}

export interface TaskHit {
  title: string;
  status: string | null;
  priority: string | null;
  due_date: string | null;
  assignees: string[];
  attribution: string[];
  okr: string | null;
  objetivo: string | null;
  url: string | null;
}

/** Status pedido na frase (primeiro sinônimo que aparecer). */
function statusFromQuery(text: string): string | null {
  const n = norm(text);
  for (const [syn, canonical] of Object.entries(STATUS_SYNONYMS)) {
    if (n.includes(syn)) return canonical;
  }
  return null;
}

/** Menciona atraso/vencido? */
function wantsOverdue(text: string): boolean {
  return /\b(atrasad|vencid|passou do prazo|em atraso)\b/i.test(norm(text));
}

/**
 * Busca tarefas relevantes à pergunta. Estratégia em camadas:
 *  1) por TÍTULO (ILIKE) — "qual a atribuição da tarefa X";
 *  2) por RESPONSÁVEL + STATUS/atraso — "o que o Mark tem em andamento";
 *  3) fallback: em andamento mais recentes (visão geral).
 * Retorna poucos itens (o contexto do chat é injetado, não paginado).
 */
export async function searchTasks(
  companyId: string,
  query: string,
  assigneeHint: string | null,
  limit = 25,
): Promise<TaskHit[]> {
  const admin = createAdminClient();
  const cols =
    "title, status, priority, due_date, assignees, attribution, okr, objetivo, url";

  const status = statusFromQuery(query);
  const overdue = wantsOverdue(query);

  // 1) Tarefa específica citada pelo título — pega o "miolo" da pergunta.
  //    Usa trechos de 3+ palavras significativas para o ILIKE não casar tudo.
  const titleTerm = extractTitleTerm(query);
  if (titleTerm) {
    const { data } = await admin
      .from("tasks")
      .select(cols)
      .eq("company_id", companyId)
      .ilike("title", `%${titleTerm}%`)
      .limit(limit);
    if (data && data.length) return data as TaskHit[];
  }

  // 2) Filtro estruturado. Status/atraso vão no banco; o RESPONSÁVEL é filtrado
  //    em JS por substring normalizada — nomes do Notion vêm com espaços/sobrenome
  //    ("Mark ", "Giovana Mirela"), então match exato de array falharia.
  let q = admin.from("tasks").select(cols).eq("company_id", companyId);
  if (status) q = q.eq("status", status);
  if (overdue) {
    const today = new Date().toISOString().slice(0, 10);
    q = q
      .lt("due_date", today)
      .not("status", "in", '("Concluída","Cancelada")');
  }
  q = q.order("due_date", { ascending: true, nullsFirst: false });
  // Com filtro de responsável, pega mais candidatos (o corte real é no JS).
  q = q.limit(assigneeHint ? 500 : limit);
  const { data } = await q;
  let rows = (data ?? []) as TaskHit[];
  if (assigneeHint) {
    const hint = norm(assigneeHint);
    rows = rows
      .filter((t) => t.assignees.some((a) => norm(a).includes(hint)))
      .slice(0, limit);
  }
  if (rows.length) return rows;

  // 3) Fallback: se pediu status/atraso e nada casou, devolve vazio (a resposta
  //    dirá que não há). Se foi pergunta genérica de tarefa, mostra as em andamento.
  if (status || overdue || assigneeHint) return [];
  const { data: fallback } = await admin
    .from("tasks")
    .select(cols)
    .eq("company_id", companyId)
    .eq("status", "Em andamento")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(limit);
  return (fallback ?? []) as TaskHit[];
}

// Palavras muito comuns que não ajudam a casar um título de tarefa.
const TITLE_STOP = new Set(
  "a o e de da do das dos que qual quais quanto quantas qual e a atribuicao atribuição tarefa tarefas task status prazo responsavel responsável em para com no na os as um uma como esta está e"
    .split(/\s+/),
);

/**
 * Extrai um trecho do título citado na pergunta (para o ILIKE). Pega a sequência
 * mais longa de palavras significativas — evita casar o board inteiro.
 */
function extractTitleTerm(text: string): string | null {
  // Aspas explícitas ganham prioridade: 'tarefa "Desenvolver JARVIS"'.
  const quoted = /["“']([^"”']{4,})["”']/.exec(text);
  if (quoted) return quoted[1].trim();

  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? [];
  const significant = words.filter(
    (w) => w.length >= 4 && !TITLE_STOP.has(norm(w)),
  );
  // Precisa de pelo menos 2 palavras significativas para virar um termo de título.
  if (significant.length < 2) return null;
  // Usa as 4 primeiras significativas como âncora (cobre a maioria dos títulos).
  return significant.slice(0, 4).join(" ");
}

/** Bloco de contexto (markdown) com as tarefas encontradas, para o system prompt. */
export function formatTasksBlock(tasks: TaskHit[]): string {
  if (!tasks.length) return "";
  const lines = tasks.map((t) => {
    const parts: string[] = [`**${t.title || "(sem título)"}**`];
    if (t.status) parts.push(`status: ${t.status}`);
    if (t.priority) parts.push(`prioridade: ${t.priority}`);
    if (t.assignees.length) parts.push(`responsável: ${t.assignees.join(", ")}`);
    if (t.due_date) parts.push(`prazo: ${t.due_date}`);
    if (t.attribution.length)
      parts.push(`atribuição: ${t.attribution.join("/")}`);
    if (t.okr) parts.push(`OKR: ${t.okr}`);
    if (t.objetivo) parts.push(`objetivo: ${t.objetivo}`);
    return `- ${parts.join(" · ")}`;
  });
  return (
    "## Tarefas (fonte de verdade — dados estruturados do Notion)\n" +
    "Responda com base APENAS nestas tarefas quando a pergunta for sobre tarefas.\n" +
    lines.join("\n")
  );
}
