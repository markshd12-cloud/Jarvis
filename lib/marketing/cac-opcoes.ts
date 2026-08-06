/**
 * Limites do seletor de mês do CAC.
 *
 * Módulo NEUTRO — sem `"use client"` e sem `server-only`. A página (Server
 * Component) valida `?cacMes=` contra estes limites e o seletor (client) os usa
 * como `min`/`max` do campo.
 *
 * Constante compartilhada NÃO pode morar no módulo `"use client"`: lida pelo
 * servidor, ela chega como referência e perde os métodos de Array. Já quebrou
 * uma vez aqui (`JANELAS.some is not a function`).
 */

/**
 * Primeiro mês com dado de custo. Antes disso o Conta Azul não tem histórico de
 * centros de Marketing/Comercial, e a tela mostraria zero como se fosse fato.
 */
export const CAC_MES_MIN = "2026-01";

/**
 * Quantos meses o gráfico "CAC por mês" cobre, terminando no mês escolhido.
 *
 * O seletor escolhe UM mês para os números do topo, mas um gráfico de uma barra
 * só não é gráfico. Doze meses dão a leitura de tendência e ainda cabem na
 * largura sem rolagem.
 */
export const CAC_MESES_SERIE = 12;

/** Mês corrente em São Paulo — o servidor é UTC e viraria o mês antes da hora. */
export function cacMesCorrente(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

/**
 * `AAAA-MM` válido e dentro dos limites?
 *
 * O teto é o mês corrente: meses futuros já têm custo lançado (as recorrências
 * vão até jul/2027), mas nenhuma venda — o CAC daria indefinido e pareceria
 * defeito.
 */
export function cacMesValido(m: string | undefined): boolean {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return false;
  return m >= CAC_MES_MIN && m <= cacMesCorrente();
}

/** Desloca 'AAAA-MM' em `delta` meses. */
export function cacDeslocaMes(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
