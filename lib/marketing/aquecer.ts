/**
 * Aquecimento dos caches de leitura do Marketing.
 *
 * O cron de sync escreve no nosso banco (`syncMeta`/`syncInstagram`/
 * `syncYoutube`). Isto aqui é o outro lado: força o recálculo dos leitores AO
 * VIVO, para a primeira visita do dia não pagar a conta das APIs externas.
 *
 * O raciocínio de TTL × intervalo do cron está em `cache-ttl.ts` — leia lá antes
 * de mudar qualquer um dos dois; são a mesma decisão.
 */
import "server-only";

import { getGa4Overview } from "./ga4";
import { getMetaBreakdowns, getMetaDetail } from "./meta-detail";
import { today } from "./metrics";
import { analyticsPorCompetencia } from "./youtube-analytics";

export interface ItemAquecido {
  chave: string;
  ok: boolean;
  ms: number;
  erro?: string;
}

export interface ResultadoAquecimento {
  itens: ItemAquecido[];
  totalMs: number;
}

/**
 * Aquece os leitores caros.
 *
 * # Só a variante "todas as marcas"
 *
 * `getMetaDetail`/`getMetaBreakdowns` cacheiam por (marca, período). Aquecer as
 * 4 marcas multiplicaria por 5 as chamadas à Graph API para servir telas que
 * quase ninguém abre primeiro — a aba entra sempre em "Todas as marcas". Quem
 * filtrar por marca paga o cálculo uma vez; é o caso raro.
 *
 * # O que NÃO é aquecido, e por quê
 *
 * - `detalheDoCanal` (YouTube): cacheia por canal × janela. São 2 canais × 5
 *   janelas = 10 entradas, cada uma com ~11 consultas à Analytics API. Aquecer
 *   tudo isso a cada 3h gasta muito mais do que economiza.
 * - `getGa4Realtime`: é tempo real por definição; cache quente seria o oposto
 *   do que ele serve.
 * - `getPainelMarketing`: não tem cache próprio. Aquecer as dependências dele
 *   (GA4 e YouTube, abaixo) já resolve a parte cara.
 *
 * # Sequencial, não paralelo
 *
 * De propósito. São APIs com rate limit (a Graph responde erro 17), e o
 * aquecimento não tem ninguém esperando — pode ser lento. Paralelizar aqui
 * trocaria segundos por risco de recusa.
 */
export async function aquecerCaches(): Promise<ResultadoAquecimento> {
  const inicio = Date.now();
  const competencia = today().slice(0, 7);

  /**
   * Cada tarefa precisa dizer se o resultado REALMENTE aqueceu.
   *
   * Sem isto o aquecimento mente. Os leitores deste módulo degradam por dentro:
   * `getMetaDetail` captura a falha da Graph API e devolve `hasData:false` +
   * `erro` em vez de lançar. Como nada chega aqui como exceção, um `try/catch`
   * puro marcaria `ok:true` — e, pior, o `cacheIf: d => d.hasData` teria
   * impedido a gravação, deixando o cache com o valor ANTIGO.
   *
   * Aconteceu no primeiro deploy: o cron logou `ok:true, ms:50112` enquanto o
   * log da aplicação registrava "Meta Graph API: An unknown error occurred" e a
   * entrada no `cache_kv` continuava com o carimbo de horas antes.
   */
  interface Tarefa {
    chave: string;
    run: () => Promise<unknown>;
    /** `null` quando aqueceu; texto do motivo quando não. */
    conferir: (r: unknown) => string | null;
  }

  /** Leitores com o par `hasData`/`erro` (Meta detail, breakdowns, GA4). */
  const conferirHasData = (r: unknown): string | null => {
    const d = r as { hasData?: boolean; erro?: string };
    if (d?.hasData) return null;
    return d?.erro ?? "leitor devolveu hasData:false (cache NÃO foi gravado)";
  };

  /** Leitores que devolvem lista — vazia significa desconectado/sem resposta. */
  const conferirLista = (r: unknown): string | null =>
    Array.isArray(r) && r.length > 0 ? null : "lista vazia (cache NÃO foi gravado)";

  const tarefas: Tarefa[] = [
    {
      chave: "meta-detail",
      run: () => getMetaDetail({ force: true }),
      conferir: conferirHasData,
    },
    {
      chave: "meta-breakdowns",
      run: () => getMetaBreakdowns({ force: true }),
      conferir: conferirHasData,
    },
    {
      chave: "ga4-overview",
      run: () => getGa4Overview({ force: true }),
      conferir: conferirHasData,
    },
    {
      chave: "youtube-analytics",
      run: () => analyticsPorCompetencia(competencia, { force: true }),
      conferir: conferirLista,
    },
  ];

  const itens: ItemAquecido[] = [];
  for (const t of tarefas) {
    const t0 = Date.now();
    try {
      const r = await t.run();
      const motivo = t.conferir(r);
      if (motivo) console.warn(`[aquecer] ${t.chave} NÃO aqueceu: ${motivo}`);
      itens.push({ chave: t.chave, ok: !motivo, ms: Date.now() - t0, erro: motivo ?? undefined });
    } catch (e) {
      // Uma fonte fora do ar não aborta as outras — mesma regra do Painel.
      const erro = (e as Error).message;
      console.error(`[aquecer] ${t.chave} lançou:`, erro);
      itens.push({ chave: t.chave, ok: false, ms: Date.now() - t0, erro });
    }
  }

  return { itens, totalMs: Date.now() - inicio };
}
