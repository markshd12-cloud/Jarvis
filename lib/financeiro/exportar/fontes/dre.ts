/**
 * Extração do DRE por competência.
 *
 * Usa `getDre` — o MESMO leitor da tela, inclusive o cache. Uma competência por
 * bloco de linhas, com a estrutura inteira (totais, grupos e categorias filhas).
 *
 * Ver `docs/financeiro-exportacao.md`.
 */
import "server-only";

import { getDre, type DreRegime, type DreResult } from "@/lib/contaazul/dre";
import {
  competenciasEntre,
  mesCorrenteSP,
  type Aviso,
  type Coluna,
  type Extracao,
} from "../tipos";

const COLUNAS: Coluna[] = [
  { chave: "competencia", titulo: "Competência", tipo: "texto", largura: 12 },
  { chave: "nivel", titulo: "Nível", tipo: "texto", largura: 11 },
  { chave: "codigo", titulo: "Código", tipo: "texto", largura: 10 },
  { chave: "linha", titulo: "Linha", tipo: "texto", largura: 44 },
  { chave: "previsto", titulo: "Previsto (R$)", tipo: "dinheiro", largura: 15 },
  { chave: "av_prev", titulo: "AV Previsto", tipo: "percentual", largura: 12 },
  { chave: "realizado", titulo: "Realizado (R$)", tipo: "dinheiro", largura: 15 },
  { chave: "av_real", titulo: "AV Realizado", tipo: "percentual", largura: 12 },
  { chave: "meta", titulo: "Meta (R$)", tipo: "dinheiro", largura: 14 },
  { chave: "av_meta", titulo: "AV Meta", tipo: "percentual", largura: 11 },
  { chave: "desvio", titulo: "Desvio (Real − Meta)", tipo: "dinheiro", largura: 18 },
];

/** Linha do DRE como a estrutura devolve (o tipo público é uma união larga). */
interface Linha {
  kind?: string;
  codigo?: string;
  label?: string;
  valor?: number;
  av?: number;
  previsto?: number;
  avPrev?: number;
  orcado?: number;
  avOrc?: number;
  temMeta?: boolean;
  children?: Linha[];
}

export interface OpcoesDre {
  de: string;
  ate: string;
  regime?: DreRegime;
  /** `null`/ausente = consolidado. `"sem"` = receita sem BU. */
  buId?: string | null;
  /** Só para o subtítulo — o nome não vem do `getDre`. */
  buNome?: string;
}

export async function extrairDre(
  companyId: string,
  opts: OpcoesDre,
): Promise<Extracao> {
  const comps = competenciasEntre(opts.de, opts.ate);
  const regime: DreRegime = opts.regime ?? "previsto-realizado";
  const avisos: Aviso[] = [];

  const tituloBase = "DRE";
  const sub =
    `${opts.de} a ${opts.ate} · ` +
    (regime === "previsto-realizado" ? "previsto × realizado" : "competência") +
    (opts.buNome ? ` · BU ${opts.buNome}` : " · consolidado");

  if (comps.length === 0) {
    return {
      titulo: tituloBase,
      subtitulo: sub,
      colunas: COLUNAS,
      linhas: [],
      avisos: [
        { nivel: "critico", texto: "Período inválido: verifique as competências (AAAA-MM) e se o início vem antes do fim." },
      ],
    };
  }

  const linhas: (string | number | null)[][] = [];
  const semReceita: string[] = [];
  let semConexao = false;
  let algumDado = false;

  for (const comp of comps) {
    const d: DreResult = await getDre(companyId, comp, opts.buId ?? null, regime);
    if (!d.connected) {
      semConexao = true;
      continue;
    }
    algumDado = true;

    const push = (r: Linha, nivel: string) =>
      linhas.push([
        comp,
        nivel,
        r.codigo ?? "",
        r.label ?? "",
        r.previsto ?? 0,
        r.avPrev ?? 0,
        r.valor ?? 0,
        r.av ?? 0,
        r.temMeta ? (r.orcado ?? 0) : null,
        r.temMeta ? (r.avOrc ?? 0) : null,
        r.temMeta ? (r.valor ?? 0) - (r.orcado ?? 0) : null,
      ]);

    for (const r of (d.rows ?? []) as Linha[]) {
      // `kind: "total"` são as linhas somadas (RECEITA BRUTA, EBITDA…).
      push(r, r.kind === "total" ? "TOTAL" : "grupo");
      for (const c of r.children ?? []) push(c, "categoria");
    }

    /**
     * Receita ZERO no previsto E no realizado = mês sem faturamento emitido.
     *
     * É o aviso mais importante desta extração. A receita do DRE vem do Conta
     * Azul (nota emitida); a despesa vem das nossas parcelas, que já estão
     * lançadas meses à frente. Um mês futuro portanto mostra despesa sem
     * receita — e "prejuízo" de seis dígitos que NÃO existe.
     */
    if ((d.receitaBruta ?? 0) === 0) semReceita.push(comp);
  }

  // --- avisos -------------------------------------------------------------- //
  if (semConexao) {
    avisos.push({
      nivel: "critico",
      texto: "Conta Azul não conectado em uma ou mais competências: a receita não pôde ser lida.",
    });
  }

  if (!algumDado || linhas.length === 0) {
    avisos.push({
      nivel: "critico",
      texto: `Nenhum dado de DRE entre ${comps[0]} e ${comps[comps.length - 1]}.`,
    });
  }

  if (semReceita.length) {
    const lista =
      semReceita.length > 6
        ? `${semReceita.slice(0, 6).join(", ")} … (+${semReceita.length - 6})`
        : semReceita.join(", ");
    avisos.push({
      nivel: "critico",
      texto:
        `SEM FATURAMENTO EMITIDO em: ${lista}. Nesses meses o DRE mostra DESPESA SEM RECEITA — ` +
        `o resultado negativo NÃO é previsão de prejuízo, é custo já lançado contra receita que ainda ` +
        `não foi faturada no Conta Azul. Não apresente esses meses como projeção de resultado.`,
    });
  }

  const mesAtual = mesCorrenteSP();
  if (comps.includes(mesAtual)) {
    avisos.push({
      nivel: "atencao",
      texto:
        `Mês corrente (${mesAtual}): a coluna Realizado conta apenas o que já foi baixado como pago. ` +
        `Contas em aberto não aparecem, então o resultado realizado do mês em curso sempre parece melhor que a realidade.`,
    });
  }

  if (regime === "competencia") {
    avisos.push({
      nivel: "atencao",
      texto:
        'Regime "competência": na coluna Previsto, o FATURAMENTO BRUTO (e suas categorias) e o ' +
        "LUCRO LÍQUIDO trazem o valor PLANEJADO (a meta), não o apurado — receita não tem " +
        '"previsto" de verdade, a nota é emitida conforme acontece. As demais linhas seguem com o ' +
        "apurado, então a coluna Previsto NÃO fecha de cima para baixo nessas duas linhas.",
    });
  }

  if (regime === "previsto-realizado") {
    avisos.push({
      nivel: "nota",
      texto: 'Regime "previsto × realizado": as linhas são agrupadas pelo VENCIMENTO (as contas do mês).',
    });
  }

  avisos.push({
    nivel: "nota",
    texto: "AV = análise vertical sobre a Receita Bruta da própria competência. Nível: TOTAL (somadas), grupo, categoria.",
  });

  return {
    titulo: tituloBase,
    subtitulo: sub,
    colunas: COLUNAS,
    linhas,
    avisos,
  };
}
