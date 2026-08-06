/**
 * Janelas do painel de dados do dono do canal.
 *
 * Módulo NEUTRO de propósito — sem `"use client"` e sem `server-only`. A página
 * (Server Component) valida `?ytDias=` contra esta lista e os botões (client)
 * a renderizam; um único lugar define as opções.
 *
 * Por que não fica junto do componente: export de um módulo `"use client"` vira
 * uma REFERÊNCIA quando lido pelo servidor, não o valor. Ao importar o array de
 * lá, a página quebrava com `JANELAS.some is not a function` — o proxy não tem
 * os métodos de Array. Constante compartilhada pelos dois lados mora fora da
 * fronteira.
 *
 * Os valores espelham o YouTube Studio, para o número bater quando alguém
 * comparar as duas telas.
 */
export const JANELAS = [
  { dias: 7, rotulo: "7 dias" },
  { dias: 28, rotulo: "28 dias" },
  { dias: 90, rotulo: "90 dias" },
  { dias: 365, rotulo: "12 meses" },
] as const;

export const JANELA_PADRAO = 28;
