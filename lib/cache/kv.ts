/**
 * Cache SWR de DUAS CAMADAS, compartilhado e persistente.
 *
 * - **L1 (memória):** Map de processo — instantâneo, mas some no restart e não é
 *   compartilhado entre réplicas.
 * - **L2 (Supabase `cache_kv`):** persiste entre redeploys e é compartilhado.
 *
 * Semântica stale-while-revalidate (como `lib/financeiro/cache.ts`): NUNCA faz o
 * usuário esperar depois da 1ª computação — serve o valor em cache na hora e, se
 * estiver velho, recomputa EM SEGUNDO PLANO. Assim o cold load caro (ex.: ~24
 * requests à Graph API do Meta) roda no máximo 1× a cada `ttlMs`, globalmente.
 *
 * Degrada gracioso: se a tabela `cache_kv` não existir (migration 0026 ainda não
 * aplicada) ou o Supabase falhar, o L2 é ignorado e vale só o L1 — comportamento
 * idêntico ao cache em memória anterior. `cacheIf` evita gravar resultado de
 * falha (ex.: rate limit) — um erro transitório não gruda pelo TTL.
 */
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

interface L1Entry<T> {
  at: number;
  data: T;
  revalidating: boolean;
}

const l1 = new Map<string, L1Entry<unknown>>();

/** Aviso único por processo — não polui o log a cada leitura se o L2 estiver fora. */
let l2WarnedOnce = false;
function warnL2(scope: string, error: unknown): void {
  if (l2WarnedOnce) return;
  l2WarnedOnce = true;
  console.warn(`[cache-kv] L2 ${scope} indisponível (seguindo só com L1):`, (error as Error).message);
}

async function l2Read(key: string): Promise<{ at: number; value: unknown } | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("cache_kv")
      .select("value, updated_at")
      .eq("key", key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const at = new Date(data.updated_at as string).getTime();
    return { at: Number.isFinite(at) ? at : 0, value: data.value };
  } catch (error) {
    warnL2("read", error);
    return null;
  }
}

async function l2Write(key: string, value: unknown, ttlMs: number): Promise<void> {
  try {
    const admin = createAdminClient();
    const now = Date.now();
    const { error } = await admin.from("cache_kv").upsert(
      {
        key,
        value: value as never,
        updated_at: new Date(now).toISOString(),
        expires_at: new Date(now + ttlMs).toISOString(),
      },
      { onConflict: "key" },
    );
    if (error) throw new Error(error.message);
  } catch (error) {
    warnL2("write", error);
  }
}

/**
 * Retorna o valor de `key`, computando com `compute()` só quando necessário.
 * `force` recomputa na hora; `cacheIf` decide se um resultado é cacheável.
 */
export async function cachedSwr<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
  opts: { force?: boolean; cacheIf?: (d: T) => boolean } = {},
): Promise<T> {
  const keep = (d: T) => !opts.cacheIf || opts.cacheIf(d);

  const store = async (data: T): Promise<void> => {
    if (!keep(data)) return;
    l1.set(key, { at: Date.now(), data, revalidating: false });
    await l2Write(key, data, ttlMs);
  };

  // Recálculo em background (não bloqueia): atualiza L1 + L2 quando terminar.
  const revalidate = (entry: L1Entry<T>): void => {
    entry.revalidating = true;
    void compute()
      .then(async (data) => {
        if (keep(data)) await store(data);
        else entry.revalidating = false;
      })
      .catch(() => {
        entry.revalidating = false;
      });
  };

  if (opts.force) {
    const data = await compute();
    await store(data);
    return data;
  }

  const now = Date.now();

  // L1: instantâneo.
  const hit = l1.get(key) as L1Entry<T> | undefined;
  if (hit) {
    if (now - hit.at > ttlMs && !hit.revalidating) revalidate(hit);
    return hit.data;
  }

  // L1 miss → L2 (persistente/compartilhado). Popula o L1 e, se velho, revalida.
  const l2 = await l2Read(key);
  if (l2) {
    const data = l2.value as T;
    const entry: L1Entry<T> = { at: l2.at, data, revalidating: false };
    l1.set(key, entry);
    if (now - l2.at > ttlMs) revalidate(entry);
    return data;
  }

  // Cold em todo lugar → computa sincronamente (1ª vez global).
  const data = await compute();
  await store(data);
  return data;
}
