// Detecção (heurística, PT-BR) de pedido de GERAÇÃO de imagem no chat. Como o
// bridge do Claude roda sem ferramentas, roteamos por intenção: se a fala pede
// para criar/desenhar uma imagem, o turno vai para o gerador de imagem em vez do
// texto. Conservador de propósito — "imagem" sozinha (ex.: "imagem da empresa" =
// reputação) NÃO dispara; exige um VERBO de criação perto de um substantivo visual.

const CREATE_VERB =
  "(?:ger[ae]r?|cri[ae]r?|desenh[ae]r?|fa[çc]a|faz[ae]r?|ilustr[ae]r?|produz[ae]r?|mont[ae]r?|desenvolv[ae]r?|elabor[ae]r?|imagin[ae]r?)";
const VISUAL_NOUN =
  "(?:imagem|imagens|ilustra[çc][ãa]o|ilustra[çc][õo]es|desenho|desenhos|figura|figuras|foto|fotos|arte|artes|logo|logotipo|banner|ícone|icone|p[oô]ster|poster|wallpaper|papel de parede|pintura)";

// Verbo de criação … substantivo visual (em qualquer ordem próxima).
const VERB_THEN_NOUN = new RegExp(`\\b${CREATE_VERB}\\b[^.?!]{0,40}\\b${VISUAL_NOUN}\\b`, "i");
const NOUN_THEN_VERB = new RegExp(`\\b${VISUAL_NOUN}\\b[^.?!]{0,20}\\b${CREATE_VERB}\\b`, "i");
const CREATE_VERB_RE = new RegExp(`\\b${CREATE_VERB}\\b`, "i");

// Roteamento "sob demanda": Imagen é o padrão; se o pedido menciona GPT, aquela
// imagem vai para o GPT (via OAuth, sem API key). Ex.: "com o GPT", "pelo gpt",
// "usando gpt", "gpt-5". Espelha os keywords de modelo do EVO-NEXUS.
const GPT_KEYWORD = /\b(?:chat\s?gpt|gpt-?5(?:\.\d)?|gpt)\b/i;
const GPT_ROUTING_PHRASE =
  /\b(?:(?:com|usando|utilizando|via|pelo|pela|no|na|use|usar)\s+(?:o\s+|a\s+)?)?(?:chat\s?gpt|gpt-?5(?:\.\d)?|gpt)\b/gi;

// Substantivos de tarefa TEXTUAL — se o pedido é claramente de texto, NÃO tratar
// como imagem mesmo com verbo de criação + "gpt" (ex.: "faça um resumo com o gpt").
const TEXT_TASK_NOUN =
  /\b(?:texto|resumo|resumos|c[óo]digo|lista|listas|tabela|tabelas|e-?mail|mensagem|resposta|artigo|post|planilha|documento|relat[óo]rio|relat[óo]rios|tradu[çc][ãa]o|script|fun[çc][ãa]o|par[áa]grafo|frase|frases|legenda|roteiro|discurso|carta|plano|estrat[ée]gia|an[áa]lise)\b/i;

/**
 * Se a mensagem pede para GERAR uma imagem, devolve o prompt (o próprio texto,
 * que o gerador interpreta bem); senão, `null`.
 *
 * Dispara quando há verbo de criação perto de substantivo visual, OU quando o
 * pedido menciona **GPT** explicitamente com verbo de criação e sem indício de
 * tarefa textual (ex.: "crie um cachorro de muleta com o gpt" → imagem; mas
 * "faça um resumo com o gpt" → NÃO).
 */
export function detectImageRequest(text: string): string | null {
  const t = text.trim();
  if (!t || t.length > 1000) return null;
  if (VERB_THEN_NOUN.test(t) || NOUN_THEN_VERB.test(t)) return t;
  if (prefersGpt(t) && CREATE_VERB_RE.test(t) && !TEXT_TASK_NOUN.test(t)) return t;
  return null;
}

/** A imagem deve ser gerada pelo GPT (palavra-chave no pedido)? */
export function prefersGpt(text: string): boolean {
  return GPT_KEYWORD.test(text);
}

/**
 * Remove a frase de roteamento ("com o gpt", "pelo gpt"…) do prompt para não
 * poluir a imagem, mantendo o resto intacto. Colapsa espaços sobrando.
 */
export function stripGptKeyword(text: string): string {
  return text
    .replace(GPT_ROUTING_PHRASE, " ")
    .replace(/\s+([,.;])/g, "$1") // espaço antes de pontuação
    .replace(/([,;])\s*([,;])/g, "$1") // pontuação duplicada (", ," → ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}
