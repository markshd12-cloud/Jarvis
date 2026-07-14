/**
 * Formatação compartilhada dos gráficos interativos (kit `components/charts`).
 * Client-safe: usa apenas `Intl` (embutido no runtime), então não adiciona peso
 * ao bundle. Espelha os helpers já usados nos metric components server-side, mas
 * vive aqui para poder ser importado pelos gráficos client sem cruzar a fronteira
 * server→client (funções não são serializáveis como props).
 */

export const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
export const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
export const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export const pct = (v: number | null): string =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
