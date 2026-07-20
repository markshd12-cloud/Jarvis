/**
 * Contexto FINANCEIRO (Conta Azul) para o CHAT do Jarvis.
 *
 * Injeta um bloco ESTRUTURADO (não RAG) no system quando a pergunta é financeira
 * e o usuário tem a permissão `financeiro`. Diferente do Dashboard (que pagina
 * tudo), aqui usamos consultas só de `totais` (agregados de toda a consulta —
 * 1 request por recurso, sem paginar) para 3 janelas: hoje, mês corrente e
 * posição em aberto (±12 meses). Leve e por empresa (recebe `companyId`).
 *
 * Tudo em BRL, fuso America/Sao_Paulo, sobre `data_vencimento`.
 */
import "server-only";

import { caGet } from "@/lib/contaazul/client";
import { CONTA_AZUL_RESOURCES } from "@/lib/contaazul/config";
import { getContaAzulDashboard } from "@/lib/contaazul/dashboard";
import { listarInadimplentes } from "@/lib/financeiro/inadimplentes";

// Termos que indicam pergunta financeira (receita/despesa/caixa/etc.).
const FINANCE_RE =
  /(despesa|receita|faturamen|fatur[ao]|contas?\s+a\s+(pagar|receber)|\ba\s+(pagar|receber)\b|inadimpl|vencid|\bcaixa\b|fluxo\s+de\s+caixa|\bdre\b|\bsaldo\b|financeir|\blucro\b|quanto\s+.*(receb|pag|fatur|entr|sa[ií]))/i;

export function isFinancialQuery(text: string): boolean {
  return FINANCE_RE.test(text);
}

// Intenção ESPECÍFICA de inadimplência → puxa a lista por cliente (custa ~10s,
// então só quando a pergunta pede mesmo: "quem são os inadimplentes", "quem deve").
const INADIMP_RE =
  /(inadimpl|caloteir|devend|\bem\s+atraso\b|atrasad[ao]s?|quem\s+(deve|est[áa]\s+deven|n[ãa]o\s+pag)|quanto\s+.*\bdeve\b|clientes?\s+.*vencid)/i;

function isInadimplenciaQuery(text: string): boolean {
  return INADIMP_RE.test(text);
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

/** `{valor}` aninhado dos blocos de `totais` da API (ou número direto). */
function valorDe(bloco: unknown): number {
  if (bloco && typeof bloco === "object" && "valor" in bloco) {
    return num((bloco as { valor: unknown }).valor);
  }
  return num(bloco);
}

/** Hoje em 'AAAA-MM-DD', fuso de São Paulo. */
function spToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

/** Soma `days` a uma data ISO (pode ser negativo). */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** 'AAAA-MM' → 'junho/2026'. */
function nomeMes(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MESES[(m - 1) % 12]}/${y}`;
}

interface Totais {
  pago?: unknown;
  vencido?: unknown;
  vence_hoje?: unknown;
  pendente?: unknown;
  aberto?: unknown;
}
interface BuscarResp {
  totais?: Totais;
}

const RECEBER = CONTA_AZUL_RESOURCES.contasAReceber.path!;
const PAGAR = CONTA_AZUL_RESOURCES.contasAPagar.path!;

/** Totais de um endpoint financeiro num intervalo de vencimento (sem paginar). */
async function totaisDe(
  companyId: string,
  path: string,
  de: string,
  ate: string,
): Promise<{ pago: number; aberto: number; vencido: number }> {
  const resp = await caGet<BuscarResp>(companyId, path, {
    data_vencimento_de: de,
    data_vencimento_ate: ate,
    pagina: 1,
    tamanho_pagina: 10,
  });
  const t = resp.totais ?? {};
  return {
    pago: valorDe(t.pago),
    aberto: valorDe(t.aberto),
    vencido: valorDe(t.vencido),
  };
}

/** Recebidos e pagos de uma janela (receber + pagar em paralelo). */
async function janela(companyId: string, de: string, ate: string) {
  const [r, p] = await Promise.all([
    totaisDe(companyId, RECEBER, de, ate),
    totaisDe(companyId, PAGAR, de, ate),
  ]);
  return { r, p };
}

/**
 * Monta o bloco financeiro para o system do chat. Retorna "" em falha (o chat
 * degrada graciosamente). `companyId` é obrigatório (dado é por empresa).
 */
export async function buildFinanceiroBlock(
  companyId: string,
  question?: string,
): Promise<string> {
  const hoje = spToday();
  const mesAtual = hoje.slice(0, 7);

  const [dia, aberto, dash] = await Promise.all([
    janela(companyId, hoje, hoje), // hoje (recebido/pago do dia)
    janela(companyId, addDays(hoje, -365), addDays(hoje, 365)), // aberto ±12m
    // Série mensal dos últimos 6 meses — reusa o dashboard (JÁ cacheado em prod).
    getContaAzulDashboard(companyId, { range: "6m" }).catch(() => null),
  ]);

  const header =
    `## Conta Azul — financeiro (fonte de verdade; valores em BRL, fuso de São Paulo; hoje = ${hoje})\n` +
    `Use SEMPRE estes números para receita, despesa, faturamento, a receber, a pagar, vencidos e resultado. ` +
    `Não use o Notion nem estime esses valores. Para períodos ("últimos 2 meses", "junho", "mês passado", "trimestre"), ` +
    `selecione/some as linhas da tabela mensal abaixo.`;

  const secHoje =
    `\n\n### Hoje (${hoje})\n` +
    `- Recebido hoje: ${brl.format(dia.r.pago)}\n` +
    `- Pago hoje: ${brl.format(dia.p.pago)}`;

  let secMensal = "";
  if (dash?.connected && dash.fluxo.length) {
    const linhas = dash.fluxo
      .map((p) => {
        const parcial = p.month === mesAtual ? " — PARCIAL (mês em curso)" : "";
        return (
          `- ${nomeMes(p.month)}: recebido ${brl.format(p.receita)}, ` +
          `despesa ${brl.format(p.despesa)}, ` +
          `resultado ${brl.format(p.receita - p.despesa)}${parcial}`
        );
      })
      .join("\n");
    secMensal =
      `\n\n### Faturamento mês a mês (últimos 6 meses; recebido = pago que entrou no mês, despesa = pago no mês)\n${linhas}`;
  }

  const secAberto =
    `\n\n### Posição em aberto (vencimentos de ${addDays(hoje, -365)} a ${addDays(hoje, 365)})\n` +
    `- A receber (em aberto): ${brl.format(aberto.r.aberto)} — sendo ${brl.format(aberto.r.vencido)} vencido\n` +
    `- A pagar (em aberto): ${brl.format(aberto.p.aberto)} — sendo ${brl.format(aberto.p.vencido)} vencido`;

  // Inadimplentes por cliente — só quando a pergunta pede (varredura ~10s, cacheada).
  let secInadimplentes = "";
  if (question && isInadimplenciaQuery(question)) {
    const inad = await listarInadimplentes(companyId).catch(() => null);
    if (inad?.connected && inad.registros > 0) {
      const linhas = inad.clientes
        .slice(0, 200)
        .map(
          (c) =>
            `- ${c.cliente}: ${brl.format(c.total)} (${c.itens.length} lançamento(s) vencido(s))`,
        )
        .join("\n");
      secInadimplentes =
        `\n\n### Inadimplentes (contas a receber VENCIDAS e em aberto — fonte de verdade p/ "quem deve"/"quanto Fulano deve"; hoje = ${hoje})\n` +
        `Total vencido: ${brl.format(inad.total)} · ${inad.registros} lançamento(s) · ${inad.clientes.length} cliente(s).\n` +
        `${linhas}` +
        (inad.clientes.length > 200
          ? `\n… e mais ${inad.clientes.length - 200} cliente(s).`
          : "");
    } else if (inad?.connected) {
      secInadimplentes = `\n\n### Inadimplentes\nNenhum cliente inadimplente no momento.`;
    }
  }

  return header + secHoje + secMensal + secAberto + secInadimplentes;
}
