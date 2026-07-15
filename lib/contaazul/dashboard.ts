/**
 * Agregação dos dados financeiros da Conta Azul (API v2) para o DASHBOARD.
 *
 * Compõe, para o período escolhido, KPIs + fluxo de caixa mensal + composição
 * por categoria + um DRE simplificado, a partir de três fontes validadas:
 *   - contas-a-receber (receitas)  → `/financeiro/.../contas-a-receber/buscar`
 *   - contas-a-pagar   (despesas)  → `/financeiro/.../contas-a-pagar/buscar`
 *   - vendas (bônus, top clientes) → `/venda/busca`
 *
 * Server-only. Degrada graciosamente: sem conexão / erro de token → devolve um
 * shape "desconectado" que o componente sabe renderizar (sem quebrar a página).
 */
import "server-only";

import { caGet, ContaAzulError, markSynced } from "@/lib/contaazul/client";
import { CONTA_AZUL_RESOURCES } from "@/lib/contaazul/config";

/** Presets de período. `data_vencimento` é o eixo dos eventos financeiros. */
export type CaRangeKey = "mes" | "3m" | "6m" | "ano";
const RANGE_KEYS: readonly CaRangeKey[] = ["mes", "3m", "6m", "ano"];

export interface CategoriaValor {
  nome: string;
  valor: number;
}

/** Um mês do fluxo de caixa (recebido vs. pago). `month` = 'AAAA-MM'. */
export interface MonthPoint {
  month: string;
  receita: number;
  despesa: number;
}

export interface DreLinha {
  label: string;
  valor: number;
  tipo: "receita" | "despesa" | "resultado";
}

export interface TopCliente {
  nome: string;
  total: number;
}

export interface ContaAzulKpis {
  receitaRecebida: number;
  receitaAberta: number;
  receitaVencida: number;
  despesaPaga: number;
  despesaAberta: number;
  despesaVencida: number;
  /** Recebido − pago no período (resultado de caixa realizado). */
  resultado: number;
  /** Previsto: (recebido+aberto) − (pago+aberto). */
  saldoPrevisto: number;
}

export interface ContaAzulDashboard {
  connected: boolean;
  /** Mensagem amigável quando desconectado ou em erro (para a UI). */
  notice: string | null;
  range: CaRangeKey;
  since: string;
  until: string;
  /** Categoria em foco (filtro ativo) ou null. */
  cat: string | null;
  lastSyncedAt: string | null;
  kpis: ContaAzulKpis;
  fluxo: MonthPoint[];
  /** Detalhe por mês (drill-down): top categorias de recebido e pago.
   *  Alinhado a `fluxo` pela ordem dos meses. Compacto (pré-computado). */
  fluxoDetalhe: FluxoMes[];
  receitaPorCategoria: CategoriaValor[];
  despesaPorCategoria: CategoriaValor[];
  dre: DreLinha[];
  topClientes: TopCliente[];
  vendasAprovadas: number | null;
}

export interface FluxoMes {
  month: string;
  receita: CategoriaValor[];
  despesa: CategoriaValor[];
}

export interface ContaAzulQuery {
  range?: string;
  /** Filtra todo o painel por uma categoria (nome exato). */
  cat?: string;
}

// ----------------------------- Datas (fuso SP) -----------------------------

/** 'AAAA-MM-DD' de hoje no fuso America/Sao_Paulo (en-CA já vem ISO). */
function spToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

/** Primeiro dia do mês, `monthsBack` meses atrás de `refIso` (AAAA-MM-DD). */
function firstOfMonthBack(refIso: string, monthsBack: number): string {
  const [y, m] = refIso.split("-").map(Number);
  const idx = y * 12 + (m - 1) - monthsBack;
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  return `${yy}-${String(mm).padStart(2, "0")}-01`;
}

/** Resolve o preset em `[since, until]` (datas de vencimento, fuso SP). */
function resolveRange(q: ContaAzulQuery): {
  range: CaRangeKey;
  since: string;
  until: string;
} {
  const until = spToday();
  const range: CaRangeKey = RANGE_KEYS.includes(q.range as CaRangeKey)
    ? (q.range as CaRangeKey)
    : "6m";

  if (range === "ano") return { range, since: `${until.slice(0, 4)}-01-01`, until };
  const back = range === "mes" ? 0 : range === "3m" ? 2 : 5;
  return { range, since: firstOfMonthBack(until, back), until };
}

// --------------------------- Parsing defensivo -----------------------------

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

/** `{valor}` aninhado dos blocos de `totais` da API. */
function valorDe(bloco: unknown): number {
  if (bloco && typeof bloco === "object" && "valor" in bloco) {
    return num((bloco as { valor: unknown }).valor);
  }
  return num(bloco);
}

interface EventoTotais {
  pago?: unknown;
  vencido?: unknown;
  vence_hoje?: unknown;
  pendente?: unknown;
  aberto?: unknown;
}

interface EventoItem {
  total?: unknown;
  pago?: unknown;
  nao_pago?: unknown;
  data_competencia?: string | null;
  data_vencimento?: string | null;
  categorias?: Array<{ nome?: string; descricao?: string; valor?: unknown }> | null;
  cliente?: { nome?: string } | null;
}

interface BuscarResp {
  itens_totais?: number;
  itens?: EventoItem[];
  totais?: EventoTotais;
}

/** Nome da 1ª categoria do item (ou "Sem categoria"). */
function categoriaNome(item: EventoItem): string {
  const c = item.categorias?.[0];
  return (c?.nome ?? c?.descricao ?? "").trim() || "Sem categoria";
}

/** Mês ('AAAA-MM') do item pela competência (fallback: vencimento). */
function mesDoItem(item: EventoItem): string | null {
  const d = item.data_competencia ?? item.data_vencimento;
  return d ? d.slice(0, 7) : null;
}

/**
 * Busca TODOS os itens de um endpoint financeiro paginando; retorna também os
 * `totais` (agregados de toda a consulta, vêm iguais em cada página).
 */
async function buscarEventos(
  companyId: string,
  path: string,
  since: string,
  until: string,
): Promise<{ itens: EventoItem[]; totais: EventoTotais }> {
  const TAM = 100;
  const MAX_PAGINAS = 60; // trava anti-runaway (~6000 itens)
  const LOTE = 6; // páginas simultâneas (equilíbrio latência × rate limit)

  const buscarPagina = (pagina: number) =>
    caGet<BuscarResp>(companyId, path, {
      data_vencimento_de: since,
      data_vencimento_ate: until,
      pagina,
      tamanho_pagina: TAM,
    });

  // Página 1 já traz os `totais` (agregados de toda a consulta) e o itens_totais.
  const primeira = await buscarPagina(1);
  const totais = primeira.totais ?? {};
  const itens: EventoItem[] = [...(primeira.itens ?? [])];

  const total = primeira.itens_totais ?? itens.length;
  const totalPaginas = Math.min(MAX_PAGINAS, Math.ceil(total / TAM));

  // Páginas 2..N em lotes paralelos (a 1 já foi).
  for (let inicio = 2; inicio <= totalPaginas; inicio += LOTE) {
    const fim = Math.min(inicio + LOTE - 1, totalPaginas);
    const paginas = [];
    for (let p = inicio; p <= fim; p++) paginas.push(buscarPagina(p));
    const resps = await Promise.all(paginas);
    for (const r of resps) itens.push(...(r.itens ?? []));
  }

  return { itens, totais };
}

/** Soma valores por categoria e devolve as maiores (resto agrupado em "Outros"). */
function porCategoria(itens: EventoItem[], topN = 6): CategoriaValor[] {
  const mapa = new Map<string, number>();
  for (const item of itens) {
    const nome = categoriaNome(item);
    mapa.set(nome, (mapa.get(nome) ?? 0) + num(item.total));
  }
  const ordenado = [...mapa.entries()]
    .map(([nome, valor]) => ({ nome, valor }))
    .filter((c) => c.valor > 0)
    .sort((a, b) => b.valor - a.valor);
  if (ordenado.length <= topN) return ordenado;
  const cabeca = ordenado.slice(0, topN - 1);
  const resto = ordenado.slice(topN - 1).reduce((s, c) => s + c.valor, 0);
  return [...cabeca, { nome: "Outros", valor: resto }];
}

/** Fluxo de caixa mensal: recebido vs. pago por mês, no intervalo. */
function fluxoMensal(
  receber: EventoItem[],
  pagar: EventoItem[],
  since: string,
  until: string,
): MonthPoint[] {
  const meses = new Map<string, MonthPoint>();
  // Sementeia todos os meses do intervalo (para não pular meses zerados).
  let cursor = since.slice(0, 7);
  const fim = until.slice(0, 7);
  for (let i = 0; i < 36 && cursor <= fim; i++) {
    meses.set(cursor, { month: cursor, receita: 0, despesa: 0 });
    const [y, m] = cursor.split("-").map(Number);
    const nextIdx = y * 12 + (m - 1) + 1;
    cursor = `${Math.floor(nextIdx / 12)}-${String((nextIdx % 12) + 1).padStart(2, "0")}`;
  }
  const acumula = (itens: EventoItem[], campo: "receita" | "despesa") => {
    for (const item of itens) {
      const mes = mesDoItem(item);
      if (!mes) continue;
      const p = meses.get(mes);
      if (p) p[campo] += num(item.pago);
    }
  };
  acumula(receber, "receita");
  acumula(pagar, "despesa");
  return [...meses.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Detalhe do fluxo por mês (drill-down): top-5 categorias de recebido e pago,
 * por `item.pago` (mesma base das barras). Alinhado à lista de `meses`.
 * Compacto — cabe no payload sem peso (≤ ~10 objetos por mês).
 */
function fluxoDetalhado(
  receber: EventoItem[],
  pagar: EventoItem[],
  meses: string[],
): FluxoMes[] {
  const agrupaPorMes = (itens: EventoItem[]) => {
    const m = new Map<string, Map<string, number>>();
    for (const it of itens) {
      const mes = mesDoItem(it);
      if (!mes) continue;
      const cat = categoriaNome(it);
      const porCat = m.get(mes) ?? new Map<string, number>();
      porCat.set(cat, (porCat.get(cat) ?? 0) + num(it.pago));
      m.set(mes, porCat);
    }
    return m;
  };
  const top5 = (porCat: Map<string, number> | undefined): CategoriaValor[] =>
    porCat
      ? [...porCat.entries()]
          .map(([nome, valor]) => ({ nome, valor }))
          .filter((c) => c.valor > 0)
          .sort((a, b) => b.valor - a.valor)
          .slice(0, 5)
      : [];
  const r = agrupaPorMes(receber);
  const p = agrupaPorMes(pagar);
  return meses.map((month) => ({
    month,
    receita: top5(r.get(month)),
    despesa: top5(p.get(month)),
  }));
}

/** KPIs a partir dos `totais` agregados da API (caminho sem filtro). */
function kpisDosTotais(
  receberT: EventoTotais,
  pagarT: EventoTotais,
): ContaAzulKpis {
  const rPago = valorDe(receberT.pago);
  const rAberto = valorDe(receberT.aberto);
  const pPago = valorDe(pagarT.pago);
  const pAberto = valorDe(pagarT.aberto);
  return {
    receitaRecebida: rPago,
    receitaAberta: rAberto,
    receitaVencida: valorDe(receberT.vencido),
    despesaPaga: pPago,
    despesaAberta: pAberto,
    despesaVencida: valorDe(pagarT.vencido),
    resultado: rPago - pPago,
    saldoPrevisto: rPago + rAberto - (pPago + pAberto),
  };
}

/**
 * KPIs recalculados a partir dos ITENS (caminho filtrado por categoria).
 * `aberto` = tudo não pago; `vencido` = não pago com vencimento anterior a hoje.
 */
function kpisDosItens(
  receber: EventoItem[],
  pagar: EventoItem[],
  hojeIso: string,
): ContaAzulKpis {
  const agg = (itens: EventoItem[]) => {
    let pago = 0;
    let aberto = 0;
    let vencido = 0;
    for (const it of itens) {
      pago += num(it.pago);
      const naoPago = num(it.nao_pago);
      aberto += naoPago;
      if (naoPago > 0 && it.data_vencimento && it.data_vencimento < hojeIso) {
        vencido += naoPago;
      }
    }
    return { pago, aberto, vencido };
  };
  const r = agg(receber);
  const p = agg(pagar);
  return {
    receitaRecebida: r.pago,
    receitaAberta: r.aberto,
    receitaVencida: r.vencido,
    despesaPaga: p.pago,
    despesaAberta: p.aberto,
    despesaVencida: p.vencido,
    resultado: r.pago - p.pago,
    saldoPrevisto: r.pago + r.aberto - (p.pago + p.aberto),
  };
}

/** DRE simplificado (cascata): receita → grupos de despesa → resultado. */
function montarDre(
  receitaRecebida: number,
  despesaPorCat: CategoriaValor[],
): DreLinha[] {
  const linhas: DreLinha[] = [
    { label: "Receita recebida", valor: receitaRecebida, tipo: "receita" },
  ];
  for (const c of despesaPorCat) {
    linhas.push({ label: c.nome, valor: -c.valor, tipo: "despesa" });
  }
  const resultado =
    receitaRecebida - despesaPorCat.reduce((s, c) => s + c.valor, 0);
  linhas.push({ label: "Resultado", valor: resultado, tipo: "resultado" });
  return linhas;
}

// ------------------------------- Vendas ------------------------------------

interface VendaItem {
  total?: unknown;
  cliente?: { nome?: string } | null;
}
interface VendaResp {
  totais?: { aprovado?: unknown };
  itens?: VendaItem[];
}

/** Top clientes por valor de venda (best-effort; falha silenciosa). */
async function topClientes(
  companyId: string,
): Promise<{ vendasAprovadas: number | null; top: TopCliente[] }> {
  try {
    const resp = await caGet<VendaResp>(companyId, CONTA_AZUL_RESOURCES.vendas.path!, {
      pagina: 1,
      tamanho_pagina: 100,
    });
    const mapa = new Map<string, number>();
    for (const v of resp.itens ?? []) {
      const nome = (v.cliente?.nome ?? "").trim() || "Sem cliente";
      mapa.set(nome, (mapa.get(nome) ?? 0) + num(v.total));
    }
    const top = [...mapa.entries()]
      .map(([nome, total]) => ({ nome, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
    return { vendasAprovadas: valorDe(resp.totais?.aprovado), top };
  } catch {
    return { vendasAprovadas: null, top: [] };
  }
}

// ------------------------------ Entrypoint ---------------------------------

function desconectado(
  range: CaRangeKey,
  since: string,
  until: string,
  notice: string,
): ContaAzulDashboard {
  return {
    connected: false,
    notice,
    range,
    since,
    until,
    cat: null,
    lastSyncedAt: null,
    kpis: {
      receitaRecebida: 0,
      receitaAberta: 0,
      receitaVencida: 0,
      despesaPaga: 0,
      despesaAberta: 0,
      despesaVencida: 0,
      resultado: 0,
      saldoPrevisto: 0,
    },
    fluxo: [],
    fluxoDetalhe: [],
    receitaPorCategoria: [],
    despesaPorCategoria: [],
    dre: [],
    topClientes: [],
    vendasAprovadas: null,
  };
}

// ------------------------------ Cache (SWR) --------------------------------

/** Janela "fresca": serve direto sem recalcular. */
const TTL_MS = (Number(process.env.CONTA_AZUL_CACHE_TTL_SECONDS) || 600) * 1000;
/** Teto do "velho servível": além disso, recalcula bloqueando. */
const MAX_AGE_MS = Math.max(TTL_MS * 6, 60 * 60 * 1000);

interface RawEventos {
  receber: Awaited<ReturnType<typeof buscarEventos>>;
  pagar: Awaited<ReturnType<typeof buscarEventos>>;
  vendas: Awaited<ReturnType<typeof topClientes>>;
}
interface RawCacheEntry {
  data: RawEventos;
  at: number;
  refreshing: boolean;
}
/**
 * Cache por processo dos EVENTOS BRUTOS (receber/pagar/vendas) por empresa+período.
 * A chave NÃO inclui a categoria: o filtro `cat` é só um recorte em memória dos
 * mesmos itens (ver computeContaAzulDashboard). Assim, trocar de categoria (clicar
 * numa fatia do donut) reaproveita o cache e responde na hora, em vez de refazer a
 * busca paginada (~5s, dezenas de chamadas throttled à API) a cada categoria.
 * (server standalone, 1 réplica no Swarm.)
 */
const rawCache = new Map<string, RawCacheEntry>();

/** Busca crua (paginada) dos eventos do período. Lança em erro de API. */
async function fetchRawEventos(
  companyId: string,
  since: string,
  until: string,
): Promise<RawEventos> {
  const [receber, pagar, vendas] = await Promise.all([
    buscarEventos(companyId, CONTA_AZUL_RESOURCES.contasAReceber.path!, since, until),
    buscarEventos(companyId, CONTA_AZUL_RESOURCES.contasAPagar.path!, since, until),
    topClientes(companyId),
  ]);
  return { receber, pagar, vendas };
}

/**
 * Eventos brutos com stale-while-revalidate (chave empresa:período, sem `cat`):
 * dentro do TTL serve o cache; passado o TTL mas dentro do teto, serve o VELHO na
 * hora e dispara refresh em background; só bloqueia em miss (ou muito velho).
 */
async function getRawEventosCached(
  companyId: string,
  range: string,
  since: string,
  until: string,
): Promise<RawEventos> {
  const key = `${companyId}:${range}`;
  const now = Date.now();
  const hit = rawCache.get(key);

  if (hit) {
    const age = now - hit.at;
    if (age < TTL_MS) return hit.data; // fresco
    if (age < MAX_AGE_MS) {
      // Velho porém servível: refresh em background (só um por vez) e serve o velho.
      if (!hit.refreshing) {
        hit.refreshing = true;
        void fetchRawEventos(companyId, since, until)
          .then((fresh) => {
            rawCache.set(key, { data: fresh, at: Date.now(), refreshing: false });
          })
          .catch(() => {
            hit.refreshing = false;
          });
      }
      return hit.data;
    }
  }

  // Miss (ou muito velho): busca na hora e cacheia.
  const fresh = await fetchRawEventos(companyId, since, until);
  rawCache.set(key, { data: fresh, at: now, refreshing: false });
  return fresh;
}

/**
 * Painel financeiro da Conta Azul para a empresa/período. O trabalho caro (busca
 * paginada na API) é cacheado por empresa+período em `getRawEventosCached`; aqui só
 * recortamos por categoria e agregamos em memória — então filtrar por categoria é
 * instantâneo depois que o período está aquecido. Nunca lança (degrada para
 * "desconectado"); erro/desconectado nunca entram no cache de eventos.
 */
export async function getContaAzulDashboard(
  companyId: string | null,
  q: ContaAzulQuery = {},
): Promise<ContaAzulDashboard> {
  return computeContaAzulDashboard(companyId, q);
}

/**
 * Cálculo real (SEM cache) do painel financeiro. Requer `companyId` (resolvido
 * na página). Nunca lança: erros viram estado "desconectado" com aviso.
 */
async function computeContaAzulDashboard(
  companyId: string | null,
  q: ContaAzulQuery = {},
): Promise<ContaAzulDashboard> {
  const { range, since, until } = resolveRange(q);

  if (!companyId) {
    return desconectado(range, since, until, "Sessão sem empresa vinculada.");
  }

  try {
    // Eventos brutos cacheados por empresa+período (chave sem `cat`): trocar de
    // categoria reaproveita esta busca em vez de refazer a paginação na API.
    const { receber, pagar, vendas } = await getRawEventosCached(
      companyId,
      range,
      since,
      until,
    );

    // Filtro por categoria: recorta os itens JÁ paginados (mesmo passe, sem
    // chamadas extras à API → não fura o spike arrest de 10 req/s).
    const cat = (q.cat ?? "").trim() || null;
    const receberItens = cat
      ? receber.itens.filter((i) => categoriaNome(i) === cat)
      : receber.itens;
    const pagarItens = cat
      ? pagar.itens.filter((i) => categoriaNome(i) === cat)
      : pagar.itens;

    // Sem filtro: KPIs vêm dos `totais` agregados da API (autoritativos).
    // Com filtro: recalculados dos itens (o `totais` cobre todas as categorias).
    const kpis = cat
      ? kpisDosItens(receberItens, pagarItens, until)
      : kpisDosTotais(receber.totais, pagar.totais);

    const fluxo = fluxoMensal(receberItens, pagarItens, since, until);
    const receitaPorCategoria = porCategoria(receberItens);
    const despesaPorCategoria = porCategoria(pagarItens);

    // Marca a sincronização (não bloqueia a resposta em caso de falha).
    void markSynced(companyId).catch(() => {});

    return {
      connected: true,
      notice: null,
      range,
      since,
      until,
      cat,
      lastSyncedAt: new Date().toISOString(),
      kpis,
      fluxo,
      fluxoDetalhe: fluxoDetalhado(
        receberItens,
        pagarItens,
        fluxo.map((f) => f.month),
      ),
      receitaPorCategoria,
      despesaPorCategoria,
      dre: montarDre(kpis.receitaRecebida, despesaPorCategoria),
      topClientes: vendas.top,
      vendasAprovadas: vendas.vendasAprovadas,
    };
  } catch (err) {
    // Erro fica visível nos logs do container (antes era engolido silenciosamente).
    console.error("[contaazul] getContaAzulDashboard falhou:", err);
    const notice =
      err instanceof ContaAzulError && err.kind === "no-connection"
        ? "Conta Azul ainda não conectada. Conecte em Configurações → Conexões."
        : err instanceof ContaAzulError && err.kind === "auth"
          ? "Token da Conta Azul expirado. Reconecte em Configurações → Conexões."
          : "Não foi possível carregar os dados da Conta Azul agora.";
    return desconectado(range, since, until, notice);
  }
}
