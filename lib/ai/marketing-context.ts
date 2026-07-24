/**
 * Contexto de Marketing (Meta Ads) para o CHAT do Jarvis.
 *
 * Injeta um bloco ESTRUTURADO (não RAG) no system, a partir da MESMA fonte do
 * Dashboard (`marketing/metrics.ts`). Estratégia:
 *  - Tabela DIÁRIA dos últimos ~35 dias por marca → o modelo fatia sozinho
 *    "hoje", "ontem", "última semana", "últimos 30 dias".
 *  - Resumo do MÊS corrente (por marca + total) para respostas diretas.
 *  - Se a pergunta cita um mês fora dessa janela ("mês passado", "junho", ...),
 *    consulta o intervalo daquele mês e injeta um bloco específico.
 *
 * Tudo no fuso America/Sao_Paulo. GLOBAL: sem company_id; o chamador injeta só
 * quando `can(ctx, "marketing")`.
 */
import {
  daysAgo,
  getMetaDaily,
  getMetaMetrics,
  startOfMonth,
  today,
  type BrandMetrics,
  type MetaDailyRow,
  type MetaMetrics,
} from "@/lib/marketing/metrics";
import { getYoutubeOverview } from "@/lib/marketing/youtube";

// Termos que indicam pergunta de mídia paga / desempenho de anúncios. "meta"
// sozinho fica de fora (ambíguo com "meta/objetivo" em PT); exigimos "meta ads".
// Inclui também os termos de YouTube (canal orgânico), cujo bloco vai junto.
const MARKETING_RE =
  /(invest|gast|tr[aá]fego|an[uú]nci|m[ií]dia\s+paga|meta\s*ads|campanha|impress|clique|\bctr\b|\bcpc\b|\bcpm\b|\bcpl\b|alcance|aproveitamento|\blead|convers|whats|\broas\b|youtube|\byt\b|inscrit|v[ií]deo|shorts|visualiza|\bcanal\b)/i;

export function isMarketingQuery(text: string): boolean {
  return MARKETING_RE.test(text);
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** 'AAAA-MM-DD' → 'DD/MM'. */
function ddmm(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

interface Period {
  since: string;
  until: string;
  label: string;
}

/** Intervalo de um mês (SP), sem passar de hoje. `month0` é 0–11. */
function monthRange(year: number, month0: number): Period {
  const first = `${year}-${String(month0 + 1).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month0 + 1, 0)).toISOString().slice(0, 10);
  const t = today();
  return {
    since: first,
    until: last > t ? t : last,
    label: `${MESES[month0]}/${year}`,
  };
}

/**
 * Detecta um mês explícito na pergunta ("mês passado", "junho", "junho de 2025").
 * Retorna null se não houver — aí o modelo usa a tabela diária/mês injetados.
 */
function parsePeriodPt(question: string): Period | null {
  const t = question.toLowerCase();
  const now = new Date(`${today()}T12:00:00Z`);

  if (/m[eê]s\s+(passad|anterior)/.test(t)) {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return monthRange(d.getUTCFullYear(), d.getUTCMonth());
  }

  for (let i = 0; i < MESES.length; i++) {
    if (!t.includes(MESES[i])) continue;
    const yMatch = t.match(/\b(20\d{2})\b/);
    let year = yMatch ? Number(yMatch[1]) : now.getUTCFullYear();
    // Sem ano explícito e mês ainda não chegou este ano → assume ano passado.
    if (!yMatch && i > now.getUTCMonth()) year -= 1;
    return monthRange(year, i);
  }
  return null;
}

/** Linha compacta de métricas agregadas de uma marca (ou total). */
function metricLine(name: string, m: BrandMetrics): string {
  const ctr = m.ctr != null ? `, CTR ${m.ctr.toFixed(2)}%` : "";
  const cpc = m.cpc != null ? `, CPC ${brl.format(m.cpc)}` : "";
  const cpl = m.cpl != null ? ` (CPL ${brl.format(m.cpl)})` : "";
  return (
    `- ${name}: investimento ${brl.format(m.spend)}, ${int.format(m.leads)} leads${cpl}, ` +
    `${int.format(m.conversations)} conversas WhatsApp, ${int.format(m.impressions)} impressões, ` +
    `${int.format(m.clicks)} cliques, ${int.format(m.reach)} de alcance${ctr}${cpc}`
  );
}

/** Bloco de um período agregado (usado no mês corrente e nos meses históricos). */
function periodBlock(title: string, m: MetaMetrics): string {
  const rows = m.brands.map((b) => metricLine(b.brand ?? "?", b)).join("\n");
  return `${title}\n${rows}\n${metricLine("Total (todas as marcas)", m.total)}`;
}

/** Tabela diária compacta: uma linha por dia (mais recente primeiro). */
function dailyTable(rows: MetaDailyRow[]): string {
  const byDate = new Map<string, MetaDailyRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }
  const lines: string[] = [];
  for (const date of [...byDate.keys()].sort().reverse()) {
    const list = byDate.get(date)!;
    let s = 0;
    let imp = 0;
    let cl = 0;
    const parts = list
      .sort((a, b) => b.spend - a.spend)
      .map((r) => {
        s += r.spend;
        imp += r.impressions;
        cl += r.clicks;
        return `${r.brand} ${brl.format(r.spend)}/${int.format(r.impressions)}/${int.format(r.clicks)}`;
      });
    lines.push(
      `${ddmm(date)} — Total ${brl.format(s)}/${int.format(imp)}/${int.format(cl)} | ${parts.join(" · ")}`,
    );
  }
  return lines.join("\n");
}

/**
 * Bloco do YouTube (canal orgânico) para o system do chat. Compacto de
 * propósito — o orçamento de tokens é compartilhado com o bloco do Meta.
 * Retorna "" se ainda não houve sync.
 */
async function buildYoutubeSection(): Promise<string> {
  const yt = await getYoutubeOverview({ topLimit: 5 }).catch(() => null);
  if (!yt?.hasData) return "";

  const canais = yt.channels
    .map(
      (c) =>
        `- ${c.brand}: ${int.format(c.subscribers)} inscritos, ` +
        `${int.format(c.views)} visualizações totais, ${int.format(c.videoCount)} vídeos`,
    )
    .join("\n");

  const videos = yt.topVideos
    .map(
      (v) =>
        `- "${v.title}" (${v.brand}, ${v.isShort ? "Shorts" : "vídeo"}, ` +
        `${int.format(v.views)} views, ${int.format(v.likes)} likes, ${int.format(v.comments)} comentários)`,
    )
    .join("\n");

  const formato = yt.byFormat
    .map((f) => `${f.format}: ${int.format(Math.round(f.avgViews))} views/vídeo (${f.count} vídeos)`)
    .join(" · ");

  return (
    `## YouTube — canal orgânico (fonte de verdade)\n` +
    `Use para inscritos, visualizações, vídeos e Shorts. "Visualizações totais" é o ACUMULADO ` +
    `do canal (vitalício), não do período.\n` +
    `Total: ${int.format(yt.totalSubscribers)} inscritos, ${int.format(yt.totalViews)} visualizações.\n` +
    `${canais}\n` +
    (formato ? `\nDesempenho por formato (entre os vídeos recentes): ${formato}\n` : "") +
    (videos ? `\nVídeos recentes mais vistos:\n${videos}` : "")
  );
}

/**
 * Monta o bloco de Meta Ads para o system do chat. Retorna "" se não houver
 * dados. `question` guia a detecção de período histórico.
 */
export async function buildMarketingBlock(question: string): Promise<string> {
  const until = today();
  const dailySince = daysAgo(34); // últimos 35 dias

  const [daily, month] = await Promise.all([
    getMetaDaily({ since: dailySince, until }),
    getMetaMetrics({ since: startOfMonth(), until }),
  ]);

  // Bloco histórico opcional (mês citado que esteja fora da janela diária).
  let historic = "";
  const period = parsePeriodPt(question);
  if (period && period.since < dailySince) {
    const m = await getMetaMetrics({
      since: period.since,
      until: period.until,
    }).catch(() => null);
    if (m?.hasData) {
      historic =
        "\n\n" +
        periodBlock(
          `## Meta Ads — ${period.label} (${ddmm(period.since)} a ${ddmm(period.until)})`,
          m,
        );
    }
  }

  // YouTube (orgânico) — bloco compacto e independente do Meta.
  const youtubeSection = await buildYoutubeSection();

  if (!daily.length && !month.hasData && !historic && !youtubeSection) return "";

  const header =
    `## Meta Ads — mídia paga (fonte de verdade; valores em BRL, fuso de São Paulo; hoje = ${ddmm(until)})\n` +
    `Use estes números para investimento/gasto em anúncios, tráfego, leads, conversas de WhatsApp, CPL, impressões, cliques, CTR, CPC e alcance. ` +
    `"CPPEM" refere-se a "CPPEM Concursos".`;

  const dailySection = daily.length
    ? `\n\n### Diário dos últimos 35 dias (some os dias do período pedido — hoje, últimos 7, últimos 30, etc.)\n` +
      `Formato por marca: investimento/impressões/cliques.\n` +
      dailyTable(daily)
    : "";

  const monthSection = month.hasData
    ? "\n\n" + periodBlock(`### Mês corrente (${ddmm(startOfMonth())} a ${ddmm(until)})`, month)
    : "";

  // Só monta o cabeçalho do Meta se houver dado de Meta — senão o bloco do
  // YouTube sairia sob um título "Meta Ads" enganoso.
  const temMeta = daily.length > 0 || month.hasData || !!historic;
  const metaPart = temMeta ? header + dailySection + monthSection + historic : "";

  return [metaPart, youtubeSection].filter(Boolean).join("\n\n");
}
