/**
 * Cache SWR (stale-while-revalidate) por processo para as leituras pesadas do
 * financeiro (varreduras do Conta Azul). Diferente de um cache TTL simples, o SWR
 * NUNCA faz o usuário esperar depois da 1ª computação: serve o valor em cache na
 * hora e, se estiver velho, dispara o recálculo EM SEGUNDO PLANO (o próximo load
 * já pega fresco). 1 réplica em prod → Map de processo basta.
 *
 * `force` recomputa na hora (botão "Atualizar"). `cacheIf` evita cachear resultado
 * de falha (ex.: CA desconectado) — assim um erro transitório não gruda por 10 min.
 */
import "server-only";

interface Entry<T> {
  at: number;
  data: T;
  revalidating: boolean;
}

const store = new Map<string, Entry<unknown>>();

export async function swr<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
  opts: { force?: boolean; cacheIf?: (d: T) => boolean } = {},
): Promise<T> {
  const now = Date.now();
  const keep = (d: T) => !opts.cacheIf || opts.cacheIf(d);

  // Atualizar: recomputa na hora e substitui o cache.
  if (opts.force) {
    const data = await compute();
    if (keep(data)) store.set(key, { at: Date.now(), data, revalidating: false });
    return data;
  }

  const hit = store.get(key) as Entry<T> | undefined;
  if (hit) {
    // Velho e ninguém revalidando → dispara recálculo em background (não espera).
    if (now - hit.at > ttlMs && !hit.revalidating) {
      hit.revalidating = true;
      void compute()
        .then((data) => {
          if (keep(data)) store.set(key, { at: Date.now(), data, revalidating: false });
          else hit.revalidating = false;
        })
        .catch(() => {
          hit.revalidating = false;
        });
    }
    return hit.data; // instantâneo (fresco ou velho)
  }

  // Cold: primeira vez — computa sincronamente.
  const data = await compute();
  if (keep(data)) store.set(key, { at: now, data, revalidating: false });
  return data;
}
