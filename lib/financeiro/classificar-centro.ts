/**
 * Classificador HEURÍSTICO: sugere o Centro de Custo de uma categoria de despesa
 * a partir do nome, usando as palavras-chave dos "exemplos" do arquivo
 * "Categorias de Despesas e Receitas.md". É um ASSISTENTE (humano confirma), não
 * um autopilot — devolve confiança (alta/media/baixa) e o motivo.
 *
 * Puro, sem I/O. Ordem das regras = prioridade (mais específico primeiro), para
 * termos ambíguos caírem no centro certo (ex.: "DAS" → Governo antes de qualquer
 * outra coisa). Ver `docs/financeiro-centros-ideal.md` (Fase 3).
 */

export type CentroNome =
  | "Administrativo"
  | "Marketing"
  | "Comercial"
  | "Cultura"
  | "Pedagógico"
  | "Tecnologia"
  | "Serviços Gerais"
  | "Financeiro"
  | "Governo"
  | "Mercadorias";

export type Confianca = "alta" | "media" | "baixa";

export interface SugestaoCentro {
  centro: CentroNome | null;
  confianca: Confianca;
  /** Palavra/termo que casou (para auditoria). */
  motivo: string;
}

/** Normaliza: minúsculo, sem acento, espaços colapsados. */
function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Regras em ORDEM DE PRIORIDADE. Cada regra tem termos e uma confiança: `alta`
 * quando o termo é inequívoco do centro; `media` quando é forte mas pode variar.
 * A primeira regra cujo termo aparecer no nome vence.
 */
const REGRAS: { centro: CentroNome; conf: Confianca; termos: string[] }[] = [
  // Tributos/obrigações — termos muito específicos, resolvem primeiro.
  // ⚠️ NÃO usar "iss" (casa "comISSão"/"admISSional"); "inss" cobre o INSS.
  { centro: "Governo", conf: "alta", termos: [
    "darf", "imposto", "simples nacional", "irpj", "irrf", "csll",
    "cofins", "inss", "fgts", "gps", "tributo", "tributaria", "guia fiscal",
  ] },
  // Mídia paga / marketing.
  { centro: "Marketing", conf: "alta", termos: [
    "meta ads", "google ads", "anuncio", "anuncios", "trafego", "influenciador",
    "podcast", "patrocinio", "outdoor", "push marketing", "social media",
    "manychat", "devzapp", "reportei", "meta verified", "marketing", "pixel",
  ] },
  { centro: "Marketing", conf: "media", termos: ["indicacoes", "indicacao"] },
  // Ferramentas / infra / IA / sistemas.
  // ⚠️ NÃO usar "ia" solto (casa energIA, férIAs, materIAl, bancárIA…). "Claude
  // IA" e "API …" já são cobertos por "claude"/"openai"/"api".
  { centro: "Tecnologia", conf: "alta", termos: [
    "hospedagem", "dominio", "vps", "hostboost", "servidor", "api ", "openai",
    "deepseek", "chatgpt", "claude", "software", "sistema",
    "google workspace", "notion", "onvox", "icode", "loja integrada",
    "checkout guru", "conta azul", "agenda edu", "activesoft", "alpaclass",
    "panda video", "tutory", "certificado digital", "automac", "integrac",
  ] },
  // Financeiro/bancário.
  { centro: "Financeiro", conf: "alta", termos: [
    "tarifa", "taxa banc", "taxa de cartao", "juros", "anuidade", "gateway",
    "boleto", "conciliac",
  ] },
  { centro: "Financeiro", conf: "media", termos: ["emprestimo", "cartao"] },
  // Mercadorias / produção física.
  { centro: "Mercadorias", conf: "alta", termos: [
    "fardamento", "revenda", "mercadoria", "apostila", "produtos fisicos",
    "vestuario", "material impresso", "embalagem",
  ] },
  { centro: "Mercadorias", conf: "media", termos: ["frete", "entrega", "devoluc", "estorno"] },
  // Pedagógico.
  { centro: "Pedagógico", conf: "alta", termos: [
    "professor", "hora aula", "pedagog", "didatic", "mentor", "supletivo",
    "coordenacao pedagog", "material escolar",
  ] },
  // Comercial.
  { centro: "Comercial", conf: "alta", termos: ["comissao", "comercial", "crm", "kentro", "vendedor"] },
  // Serviços gerais / estrutura física.
  { centro: "Serviços Gerais", conf: "alta", termos: [
    "limpeza", "higiene", "copa", "cozinha", "predial", "reparo", "agua mineral",
    "material de higiene",
  ] },
  { centro: "Serviços Gerais", conf: "media", termos: ["manutenc", "agua", "compesa"] },
  // Cultura / desenvolvimento do time.
  { centro: "Cultura", conf: "alta", termos: [
    "festividade", "comemorac", "festa", "trofeu", "confraterniz",
  ] },
  { centro: "Cultura", conf: "media", termos: [
    "curso", "treinamento", "brinde", "presente", "bonificac",
  ] },
  // Administrativo / pessoal (fallback amplo — folha, escritório, gestão).
  { centro: "Administrativo", conf: "alta", termos: [
    "honorario", "consultoria", "contabil", "juridico", "diretoria", "cartorio",
    "escritorio", "alvara", "aluguel", "iptu", "pro-labore", "prolabore",
  ] },
  { centro: "Administrativo", conf: "media", termos: [
    "salario", "13", "ferias", "rescisao", "ajuda de custo", "ciee", "aprendiz",
    "exame admissional", "terceirizado", "bens de pequeno valor", "equipamento",
    "energia", "internet", "chips", "recarga", "farmacia", "medicamento",
    "bombeiro", "seguranca do trabalho",
  ] },
];

/** Sugere o Centro de Custo de uma categoria pelo nome. */
export function sugerirCentro(nomeCategoria: string): SugestaoCentro {
  const n = norm(nomeCategoria);
  if (!n) return { centro: null, confianca: "baixa", motivo: "nome vazio" };
  for (const regra of REGRAS) {
    for (const termo of regra.termos) {
      if (n.includes(termo.trim())) {
        return { centro: regra.centro, confianca: regra.conf, motivo: termo.trim() };
      }
    }
  }
  return { centro: null, confianca: "baixa", motivo: "nenhum termo reconhecido" };
}
