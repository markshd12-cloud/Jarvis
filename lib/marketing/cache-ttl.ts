/**
 * TTLs dos leitores caros do Marketing — e a razão de serem longos.
 *
 * # A inversão
 *
 * O TTL costuma responder "de quanto em quanto tempo recalcular". Aqui ele
 * responde outra coisa: **quanto o dado pode envelhecer**. Quem recalcula é o
 * cron (`POST /api/marketing/aquecer`), não o visitante.
 *
 * ```
 *        ANTES                                DEPOIS
 *   TTL 10min, sem aquecimento           TTL 6h, cron de 3/3h
 *   ─────────────────────────            ─────────────────────
 *   o usuário paga o cálculo             o cron paga o cálculo
 *   frio quase sempre                    sempre quente
 * ```
 *
 * # Por que aquecer sozinho NÃO resolveria
 *
 * Com TTL de 10 minutos e cron de 6 horas, o cache passaria **97% do tempo
 * frio** — o aquecimento gastaria chamada de API para servir os poucos minutos
 * seguintes. Aumentar o TTL é o que dá sentido ao cron, e vice-versa: são a
 * mesma decisão, não duas.
 *
 * # Por que 6h não deteriora o dado
 *
 * Nada aqui muda de minuto em minuto:
 * - Insights do Meta consolidam ao longo do dia e são lidos como leitura diária.
 * - A YouTube Analytics API **já entrega com ~2 dias de atraso**; um TTL de 10
 *   minutos servia o mesmo número, mais caro.
 * - O relatório do GA4 é diário.
 *
 * O que É tempo real (`getGa4Realtime`, TTL de 60s) fica de fora deste arquivo
 * de propósito — ali o valor está justamente em ser instantâneo.
 *
 * # A margem
 *
 * Cron de 3/3h com TTL de 6h dá **duas** janelas: uma execução que falhe não
 * deixa o cache expirar antes da próxima tentativa. TTL igual ao intervalo do
 * cron deixaria a tela fria a cada falha.
 */

/** Leitores ao vivo do Marketing (Graph, GA4, YouTube Analytics). */
export const TTL_LEITURA_CARA = 6 * 60 * 60_000; // 6 h

/**
 * Competência FECHADA — o passado não muda.
 *
 * Julho de 2026 terá para sempre os mesmos inscritos ganhos e perdidos. Reler
 * isso da API a cada 6 horas é gastar chamada para receber o mesmo número.
 *
 * Serve à média histórica da régua de metas e ao histórico por competência
 * (`marketing-metas-plano.md` §2.6), que olham vários meses passados de uma vez
 * — sem isto, abrir a aba Metas dispararia uma consulta à Analytics API por mês
 * exibido.
 */
export const TTL_MES_FECHADO = 30 * 24 * 60 * 60_000; // 30 dias

/**
 * Intervalo esperado do cron de aquecimento. Não agenda nada — é documentação
 * executável: se este número passar de metade do TTL, o cache volta a esfriar.
 */
export const INTERVALO_AQUECIMENTO_MS = 3 * 60 * 60_000; // 3 h
