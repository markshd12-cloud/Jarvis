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

// Termos que indicam pergunta financeira (receita/despesa/caixa/etc.).
const FINANCE_RE =
  /(despesa|receita|faturamen|fatur[ao]|contas?\s+a\s+(pagar|receber)|\ba\s+(pagar|receber)\b|inadimpl|vencid|\bcaixa\b|fluxo\s+de\s+caixa|\bdre\b|\bsaldo\b|financeir|\blucro\b|quanto\s+.*(receb|pag|fatur|entr|sa[ií]))/i;

export function isFinancialQuery(text: string): boolean {
  return FINANCE_RE.test(text);
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
export async function buildFinanceiroBlock(companyId: string): Promise<string> {
  const hoje = spToday();
  const inicioMes = `${hoje.slice(0, 7)}-01`;

  const [dia, mes, aberto] = await Promise.all([
    janela(companyId, hoje, hoje), // hoje
    janela(companyId, inicioMes, hoje), // mês corrente até hoje
    janela(companyId, addDays(hoje, -365), addDays(hoje, 365)), // aberto ±12m
  ]);

  const header =
    `## Conta Azul — financeiro (fonte de verdade; valores em BRL, fuso de São Paulo; hoje = ${hoje})\n` +
    `Use SEMPRE estes números para receita, despesa, faturamento, a receber, a pagar, vencidos e resultado. ` +
    `Não use o Notion nem estime esses valores — se a pergunta for financeira, responda com base neste bloco.`;

  const secHoje =
    `\n\n### Hoje (${hoje})\n` +
    `- Recebido hoje: ${brl.format(dia.r.pago)}\n` +
    `- Pago hoje: ${brl.format(dia.p.pago)}`;

  const resultadoMes = mes.r.pago - mes.p.pago;
  const secMes =
    `\n\n### Mês corrente (${inicioMes} a ${hoje})\n` +
    `- Faturamento recebido: ${brl.format(mes.r.pago)}\n` +
    `- Despesa paga: ${brl.format(mes.p.pago)}\n` +
    `- Resultado (recebido − pago): ${brl.format(resultadoMes)}`;

  const secAberto =
    `\n\n### Posição em aberto (vencimentos de ${addDays(hoje, -365)} a ${addDays(hoje, 365)})\n` +
    `- A receber (em aberto): ${brl.format(aberto.r.aberto)} — sendo ${brl.format(aberto.r.vencido)} vencido\n` +
    `- A pagar (em aberto): ${brl.format(aberto.p.aberto)} — sendo ${brl.format(aberto.p.vencido)} vencido`;

  return header + secHoje + secMes + secAberto;
}
