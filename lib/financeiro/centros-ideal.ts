/**
 * Metas ideais por Centro de Custo — benchmark do arquivo "Categorias de Despesas
 * e Receitas.md" (diretriz da liderança). A empresa é MLG (Marketing-Led Growth):
 * o crescimento é liderado pelo marketing, por isso as faixas.
 *
 * Uso: comparar o **% real** de cada centro (que o painel já calcula do Conta Azul
 * ao vivo) com a **faixa ideal**, sinalizando dentro/abaixo/acima. As faixas de %
 * valem para QUALQUER período (é participação no total de despesa); os valores em
 * R$ são metas ANUAIS (referência do documento — base de ~R$ 2,49 mi/ano).
 *
 * ⚠️ As faixas se sobrepõem de propósito ("ajustadas") — a soma dos máximos passa
 * de 100%. É um intervalo-guia por centro, não um orçamento fechado.
 *
 * Puro (sem I/O), usável no client e no server.
 */

export interface CentroIdeal {
  /** Nome canônico (como no documento). */
  nome: string;
  /** Faixa ideal de participação no total de despesa (%). */
  minPct: number;
  maxPct: number;
  /** Meta ANUAL em R$ (referência do documento). */
  anualMin: number;
  anualMax: number;
  /** Pergunta prática que define se a despesa entra neste centro. */
  pergunta: string;
  /** Exemplos de despesas que entram (ajuda de classificação). */
  exemplos: string;
}

/** Base anual de referência do documento (soma das metas). */
export const BASE_ANUAL_REFERENCIA = 2_487_391.18;

export const CENTROS_IDEAIS: CentroIdeal[] = [
  {
    nome: "Administrativo",
    minPct: 22.6, maxPct: 25.9, anualMin: 562_150.41, anualMax: 644_234.32,
    pergunta: "Essa despesa existe para gerir a empresa internamente?",
    exemplos: "Diretoria, RH, jurídico, contabilidade, material/equipamentos de escritório, documentação, cartório, consultorias administrativas.",
  },
  {
    nome: "Marketing",
    minPct: 16, maxPct: 31, anualMin: 497_478.24, anualMax: 547_226.06,
    pergunta: "Essa despesa serve para atrair novos alunos ou gerar leads?",
    exemplos: "Tráfego pago, agência, social media, coordenação de marketing.",
  },
  {
    nome: "Comercial",
    minPct: 12.6, maxPct: 14.9, anualMin: 313_411.29, anualMax: 370_621.29,
    pergunta: "Essa despesa serve para vender, atender leads ou converter matrículas?",
    exemplos: "Equipe comercial, comissões, CRM de vendas, WhatsApp comercial, premiações, treinamento de vendedores.",
  },
  {
    nome: "Cultura",
    minPct: 0.2, maxPct: 0.8, anualMin: 4_974.78, anualMax: 19_899.13,
    pergunta: "Essa despesa existe para fortalecer cultura e desenvolver o time?",
    exemplos: "Cursos para o time, eventos e festas com colaboradores, troféus, certificados, brindes.",
  },
  {
    nome: "Pedagógico",
    minPct: 18, maxPct: 21, anualMin: 447_730.41, anualMax: 522_352.15,
    pergunta: "Essa despesa entrega aula, conteúdo, material didático ou suporte acadêmico?",
    exemplos: "Professores, coordenadores pedagógicos, equipe pedagógica.",
  },
  {
    nome: "Tecnologia",
    minPct: 2, maxPct: 3, anualMin: 62_184.78, anualMax: 87_058.69,
    pergunta: "Essa despesa mantém sistemas, plataforma ou estrutura digital funcionando?",
    exemplos: "Hospedagem, domínio, sistema, automações, integrações, suporte técnico, IAs.",
  },
  {
    nome: "Serviços Gerais",
    minPct: 1, maxPct: 1.5, anualMin: 24_873.91, anualMax: 37_310.87,
    pergunta: "Essa despesa mantém a estrutura física funcionando?",
    exemplos: "Limpeza, manutenção, copa, pequenos reparos, material de limpeza, apoio operacional.",
  },
  {
    nome: "Financeiro",
    minPct: 1, maxPct: 1.5, anualMin: 24_873.91, anualMax: 37_310.87,
    pergunta: "Essa despesa é taxa bancária, cartão, boleto, juros ou cobrança?",
    exemplos: "Tarifas bancárias, taxas de cartão, boleto, gateway, juros, multas, sistema financeiro.",
  },
  {
    nome: "Governo",
    minPct: 8, maxPct: 10, anualMin: 198_991.29, anualMax: 248_739.12,
    pergunta: "Essa despesa é imposto, guia fiscal ou obrigação tributária?",
    exemplos: "DAS, ISS, PIS, COFINS, IRPJ, CSLL, INSS patronal, FGTS, parcelamentos tributários.",
  },
  {
    nome: "Mercadorias",
    minPct: 3, maxPct: 6, anualMin: 124_369.56, anualMax: 198_991.29,
    pergunta: "Essa despesa é compra ou produção de produto físico para vender?",
    exemplos: "Camisas para revenda, fardamentos vendidos, produtos físicos revendidos, impressão de apostilas.",
  },
];

/** Normaliza nome de centro p/ casar (sem acento, minúsculo, sem espaços extras). */
function norm(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Índice por nome normalizado + apelidos (o Conta Azul tem "Mercadoria" no singular).
const PORNOME = new Map<string, CentroIdeal>();
for (const c of CENTROS_IDEAIS) PORNOME.set(norm(c.nome), c);
PORNOME.set("mercadoria", PORNOME.get("mercadorias")!); // singular do CA

/**
 * Casa um nome de centro do Conta Azul com a meta ideal. Retorna null quando o
 * centro não tem meta definida (ex.: "Sem centro", ou um centro fora do padrão).
 */
export function matchCentroIdeal(nomeCentro: string): CentroIdeal | null {
  const k = norm(nomeCentro);
  if (PORNOME.has(k)) return PORNOME.get(k)!;
  // Casamento por prefixo/contains (nomes compostos tipo "Marketing Colégio").
  for (const c of CENTROS_IDEAIS) {
    const cn = norm(c.nome);
    if (k.startsWith(cn) || k.includes(cn)) return c;
  }
  return null;
}

export type SituacaoIdeal = "dentro" | "abaixo" | "acima";

/** Classifica o % real vs a faixa ideal. `deltaPp` = pontos % até a borda violada. */
export function avaliarIdeal(
  pctReal: number,
  ideal: CentroIdeal,
): { situacao: SituacaoIdeal; deltaPp: number } {
  if (pctReal > ideal.maxPct) return { situacao: "acima", deltaPp: pctReal - ideal.maxPct };
  if (pctReal < ideal.minPct) return { situacao: "abaixo", deltaPp: ideal.minPct - pctReal };
  return { situacao: "dentro", deltaPp: 0 };
}
