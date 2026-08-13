/**
 * Contrato comum de EXPORTAÇÃO do Financeiro.
 *
 * Toda fonte (DRE, contas a pagar, …) devolve uma `Extracao`. É esse contrato
 * que faz o aviso, o nome do arquivo e a formatação saírem iguais em todas —
 * e que permitirá o XLSX (v2) entrar sem tocar em nenhuma fonte.
 *
 * # A regra inegociável
 *
 * Toda fonte chama o **mesmo leitor que a tela** (`getDre`, `listParcelas`, …).
 * Nunca reimplementar a consulta: exportação com query própria diverge da tela
 * mais cedo ou mais tarde, e aí a planilha impressa contradiz o sistema no meio
 * de uma reunião — quando ninguém tem como conferir.
 *
 * Ver `docs/financeiro-exportacao.md`.
 */
import "server-only";

/** Como a coluna é formatada. No CSV decide a máscara; no XLSX (v2) vira formato de célula. */
export type TipoColuna = "texto" | "dinheiro" | "data" | "percentual" | "inteiro";

export interface Coluna {
  chave: string;
  titulo: string;
  tipo: TipoColuna;
  /** Largura sugerida — ignorada no CSV, usada no XLSX (v2). */
  largura?: number;
}

/**
 * Aviso que VIAJA COM O DADO.
 *
 * O arquivo sai do Jarvis e circula sozinho — e-mail, WhatsApp, projetor. Quem
 * abre não tem o contexto de quem gerou. Por isso o aviso aparece em três
 * lugares: na tela antes de baixar, no cabeçalho do arquivo, e (v2) numa aba
 * própria.
 *
 * `critico` exige confirmação do usuário antes do download.
 */
export interface Aviso {
  nivel: "critico" | "atencao" | "nota";
  texto: string;
}

export interface Extracao {
  /** Vira o nome do arquivo e o título dentro dele. */
  titulo: string;
  /** Subtítulo: período, BU, regime — o recorte, em texto. */
  subtitulo?: string;
  colunas: Coluna[];
  linhas: (string | number | null)[][];
  avisos: Aviso[];
  /** Rodapé: `{ "Previsto": 326473.16 }` → "Previsto: R$ 326.473,16". */
  totais?: Record<string, number>;
}

// --------------------------------------------------------------------------- //

/** Competência 'AAAA-MM'. */
export const EH_COMPETENCIA = /^\d{4}-\d{2}$/;

/**
 * Teto de meses por extração.
 *
 * 24 cobre "este ano + o que vem", que foi o pedido real, com folga. Acima
 * disso o custo cresce rápido: o DRE faz uma leitura por competência × BU, e
 * 17 meses × 4 BUs já foram 68 chamadas na extração manual de hoje.
 */
export const TETO_MESES = 24;

/** Lista as competências de `de` até `ate`, inclusive. Vazio se invertido. */
export function competenciasEntre(de: string, ate: string): string[] {
  if (!EH_COMPETENCIA.test(de) || !EH_COMPETENCIA.test(ate)) return [];
  const out: string[] = [];
  const [a1, m1] = de.split("-").map(Number);
  const [a2, m2] = ate.split("-").map(Number);
  let ano = a1;
  let mes = m1;
  while ((ano < a2 || (ano === a2 && mes <= m2)) && out.length < TETO_MESES) {
    out.push(`${ano}-${String(mes).padStart(2, "0")}`);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return out;
}

/** Mês corrente 'AAAA-MM' no fuso da operação (o servidor é UTC). */
export function mesCorrenteSP(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. Vazio vira "". */
export const dataBr = (iso: string | null | undefined): string =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
