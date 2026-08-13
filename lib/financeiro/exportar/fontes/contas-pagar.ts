/**
 * Extração de CONTAS A PAGAR.
 *
 * Usa `listParcelas` — o MESMO leitor da tela, inclusive a paginação (o
 * PostgREST corta em 1.000 linhas sem avisar, e as competências mais à frente
 * eram as que sumiam).
 *
 * Ver `docs/financeiro-exportacao.md`.
 */
import "server-only";

import { listParcelas } from "@/lib/financeiro/despesas";
import type { ParcelaRow } from "@/lib/financeiro/types";
import {
  competenciasEntre,
  dataBr,
  mesCorrenteSP,
  type Aviso,
  type Coluna,
  type Extracao,
} from "../tipos";

/**
 * Como o rateio entra na planilha. Decisão do requisitante (2026-08-13): os
 * dois formatos, com aviso no segundo.
 *
 * - `resumido`: 1 linha por parcela, rateio numa coluna de texto. A soma da
 *   coluna Previsto fecha com o total real.
 * - `por-bu`: a parcela rateada vira N linhas, uma por BU, com o valor da
 *   fatia. Tabela dinâmica por BU funciona — mas somar a coluna sem filtrar
 *   conta a mesma despesa mais de uma vez.
 */
export type FormatoRateio = "resumido" | "por-bu";

const COLUNAS_BASE: Coluna[] = [
  { chave: "competencia", titulo: "Competência", tipo: "texto", largura: 12 },
  { chave: "vencimento", titulo: "Vencimento", tipo: "data", largura: 12 },
  { chave: "situacao", titulo: "Situação", tipo: "texto", largura: 12 },
  { chave: "status", titulo: "Status", tipo: "texto", largura: 12 },
  { chave: "descricao", titulo: "Descrição", tipo: "texto", largura: 42 },
  { chave: "categoria", titulo: "Categoria", tipo: "texto", largura: 28 },
  { chave: "centro", titulo: "Centro de Custo", tipo: "texto", largura: 24 },
  { chave: "pessoa", titulo: "Fornecedor/Colaborador", tipo: "texto", largura: 26 },
  { chave: "tipo_pessoa", titulo: "Tipo", tipo: "texto", largura: 12 },
  { chave: "parcela", titulo: "Parcela", tipo: "texto", largura: 9 },
];

const COLUNAS_FIM: Coluna[] = [
  { chave: "pagamento", titulo: "Pagamento", tipo: "data", largura: 12 },
  { chave: "metodo", titulo: "Método", tipo: "texto", largura: 16 },
  { chave: "baixas", titulo: "Nº baixas", tipo: "inteiro", largura: 9 },
];

export interface OpcoesContasPagar {
  de: string;
  ate: string;
  formatoRateio?: FormatoRateio;
  /** `undefined` = todas as BUs. */
  buId?: string;
}

export async function extrairContasPagar(
  companyId: string,
  opts: OpcoesContasPagar,
): Promise<Extracao> {
  const comps = competenciasEntre(opts.de, opts.ate);
  const formato = opts.formatoRateio ?? "resumido";
  const avisos: Aviso[] = [];

  if (comps.length === 0) {
    return {
      titulo: "Contas a pagar",
      subtitulo: `${opts.de} a ${opts.ate}`,
      colunas: COLUNAS_BASE,
      linhas: [],
      avisos: [
        { nivel: "critico", texto: "Período inválido: verifique as competências (formato AAAA-MM) e se o início vem antes do fim." },
      ],
    };
  }

  const todas: { comp: string; p: ParcelaRow }[] = [];
  for (const comp of comps) {
    const ps = await listParcelas(companyId, { competencia: comp, bu_id: opts.buId });
    for (const p of ps) todas.push({ comp, p });
  }

  // --- linhas ------------------------------------------------------------- //
  const colunas: Coluna[] =
    formato === "por-bu"
      ? [
          ...COLUNAS_BASE,
          { chave: "bu", titulo: "BU", tipo: "texto", largura: 16 },
          { chave: "percentual", titulo: "% da BU", tipo: "percentual", largura: 10 },
          { chave: "valor_bu", titulo: "Valor da BU (R$)", tipo: "dinheiro", largura: 16 },
          { chave: "previsto", titulo: "Previsto TOTAL (R$)", tipo: "dinheiro", largura: 18 },
          { chave: "realizado", titulo: "Realizado (R$)", tipo: "dinheiro", largura: 16 },
          ...COLUNAS_FIM,
        ]
      : [
          ...COLUNAS_BASE,
          { chave: "bu", titulo: "BU", tipo: "texto", largura: 16 },
          { chave: "previsto", titulo: "Previsto (R$)", tipo: "dinheiro", largura: 15 },
          { chave: "realizado", titulo: "Realizado (R$)", tipo: "dinheiro", largura: 15 },
          { chave: "saldo", titulo: "Saldo (R$)", tipo: "dinheiro", largura: 14 },
          { chave: "rateio", titulo: "Rateio por BU", tipo: "texto", largura: 46 },
          ...COLUNAS_FIM,
        ];

  const base = (comp: string, p: ParcelaRow) => [
    comp,
    dataBr(p.data_vencimento),
    p.situacao,
    p.status,
    p.descricao,
    p.categoria_nome ?? "",
    p.centro_nome ?? "",
    p.colaborador_nome ?? "",
    p.colaborador_tipo ?? "",
    `${p.numero}/${p.num_parcelas}`,
  ];
  const fim = (p: ParcelaRow) => [
    dataBr(p.data_pagamento),
    p.metodo_pagamento ?? "",
    (p.baixas ?? []).length,
  ];

  const linhas: (string | number | null)[][] = [];
  let somaPrevisto = 0;
  let somaRealizado = 0;
  let comRateio = 0;

  for (const { comp, p } of todas) {
    somaPrevisto += p.valor_previsto;
    somaRealizado += p.valor_realizado ?? 0;
    const fatias = p.rateio ?? [];
    if (fatias.length) comRateio += 1;

    if (formato === "por-bu") {
      // Sem rateio a parcela é 100% da BU principal — uma linha só, 100%.
      const partes = fatias.length
        ? fatias
        : [{ bu_nome: p.bu_nome ?? "—", percentual: 100, valor: p.valor_previsto }];
      for (const f of partes) {
        linhas.push([
          ...base(comp, p),
          f.bu_nome,
          f.percentual,
          f.valor,
          p.valor_previsto,
          p.valor_realizado ?? 0,
          ...fim(p),
        ]);
      }
    } else {
      linhas.push([
        ...base(comp, p),
        p.bu_nome ?? "",
        p.valor_previsto,
        p.valor_realizado ?? 0,
        p.valor_previsto - (p.valor_realizado ?? 0),
        fatias.map((f) => `${f.bu_nome} ${f.percentual}% = ${f.valor.toFixed(2)}`).join(" | "),
        ...fim(p),
      ]);
    }
  }

  // --- avisos -------------------------------------------------------------- //
  if (todas.length === 0) {
    avisos.push({
      nivel: "critico",
      texto: `Nenhuma conta a pagar entre ${comps[0]} e ${comps[comps.length - 1]}. Verifique o período e o filtro de BU.`,
    });
  }

  if (formato === "por-bu" && comRateio > 0) {
    avisos.push({
      nivel: "critico",
      texto:
        `Formato "detalhado por BU": ${comRateio} parcela(s) com rateio aparecem em MAIS DE UMA LINHA. ` +
        `NÃO some a coluna "Valor da BU" junto com "Previsto TOTAL" — para o total real, use o formato resumido ` +
        `ou some "Valor da BU" filtrando uma BU por vez.`,
    });
  }

  /**
   * Meses SEM NENHUMA parcela dentro de um intervalo que tem dados.
   *
   * Quase sempre é o horizonte de materialização das recorrências (12 meses à
   * frente): o mês não está vazio porque não há despesa, e sim porque as
   * parcelas ainda não foram geradas. Sem este aviso, um orçamento anual sairia
   * com metade do ano zerada.
   */
  const porComp = new Map<string, number>();
  for (const { comp } of todas) porComp.set(comp, (porComp.get(comp) ?? 0) + 1);
  const vazios = comps.filter((c) => !porComp.has(c));
  if (vazios.length && todas.length > 0) {
    avisos.push({
      nivel: "atencao",
      texto:
        `Sem parcelas em: ${vazios.join(", ")}. As recorrências são materializadas 12 meses à frente — ` +
        `mês vazio aqui significa "ainda não gerado", não "sem despesa".`,
    });
  }

  const mesAtual = mesCorrenteSP();
  if (comps.includes(mesAtual)) {
    const doMes = todas.filter((t) => t.comp === mesAtual);
    const vencidasSemBaixa = doMes.filter(
      (t) => t.p.situacao === "vencida" && (t.p.valor_realizado ?? 0) === 0,
    ).length;
    if (vencidasSemBaixa > 0) {
      avisos.push({
        nivel: "atencao",
        texto: `Mês corrente (${mesAtual}): ${vencidasSemBaixa} conta(s) já vencida(s) sem baixa lançada. A coluna Realizado está subestimada.`,
      });
    }
  }

  avisos.push({
    nivel: "nota",
    texto: "Despesas canceladas ficam de fora, igual à tela de Contas a Pagar.",
  });

  return {
    titulo: "Contas a pagar",
    subtitulo:
      `${comps[0]} a ${comps[comps.length - 1]}` +
      (formato === "por-bu" ? " · detalhado por BU" : "") +
      (opts.buId ? " · BU filtrada" : ""),
    colunas,
    linhas,
    avisos,
    totais: {
      "Previsto (total real, sem duplicar rateio)": somaPrevisto,
      "Realizado": somaRealizado,
      "Saldo": somaPrevisto - somaRealizado,
    },
  };
}
