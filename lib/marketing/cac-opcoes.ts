/**
 * Opções de período e regime do CAC.
 *
 * Módulo NEUTRO — sem `"use client"` e sem `server-only`. A página (Server
 * Component) valida `?cacJanela=` / `?cacRegime=` contra estas listas e os botões
 * (client) as renderizam.
 *
 * Constante compartilhada NÃO pode morar no módulo `"use client"`: lida pelo
 * servidor, ela chega como referência e perde os métodos de Array. Já quebrou
 * uma vez aqui (`JANELAS.some is not a function`).
 */
export const CAC_JANELAS = [
  { valor: "mes", rotulo: "Mês atual" },
  { valor: "3m", rotulo: "3 meses" },
  { valor: "6m", rotulo: "6 meses" },
  { valor: "ano", rotulo: "Ano" },
] as const;

export const CAC_JANELA_PADRAO = "ano";

/**
 * Não existe seletor de REGIME. Meta, Previsto e Realizado são calculados
 * sempre e aparecem os três como cartões no painel — alternar entre eles só
 * mudaria qual número fica grande, sem revelar nada. `CacRegime` continua no
 * `cac.ts` porque a função aceita o parâmetro; a tela é que não o oferece.
 */
