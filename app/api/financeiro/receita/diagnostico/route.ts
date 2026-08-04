import { NextResponse, type NextRequest } from "next/server";

import { caGet } from "@/lib/contaazul/client";
import { CONTA_AZUL_RESOURCES } from "@/lib/contaazul/config";
import { finContext } from "@/lib/financeiro/context";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DIAGNÓSTICO (somente leitura): mostra os campos CRUS que o Conta Azul devolve
 * num recebível já pago.
 *
 * Motivo: `fin_receita_snapshot.data_pagamento` está NULO em 100% dos 5.109
 * recebíveis marcados como recebidos — sabemos o quê e quanto, mas não QUANDO.
 * Isso deixa o lado da receita do Fluxo de Caixa em regime de VENCIMENTO (cai no
 * fallback), não de caixa. Antes de mudar o sync, é preciso descobrir se a data
 * existe com OUTRO nome de campo (data_baixa, data_liquidacao, aninhada…) — ou se
 * a API simplesmente não expõe.
 *
 * Só lê (`caGet`), nunca escreve nem renova token por fora do fluxo normal.
 * Gated por `financeiro`. Não devolve dado de cliente: só nomes de campos e as
 * datas encontradas.
 */
export async function GET(req: NextRequest) {
  // Cron-secret além da sessão: permite rodar o diagnóstico de dentro do
  // servidor (onde não há login), que é como ele será executado na prática.
  const isCron =
    !!process.env.CRON_SECRET &&
    req.headers.get("x-cron-secret") === process.env.CRON_SECRET;

  let companyId: string;
  if (isCron) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("contaazul_connections")
      .select("company_id")
      .not("refresh_token", "is", null)
      .limit(1)
      .maybeSingle();
    if (!data?.company_id)
      return NextResponse.json({ erro: "nenhuma empresa com CA conectado" }, { status: 400 });
    companyId = data.company_id as string;
  } else {
    const gate = await finContext();
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
    companyId = gate.companyId;
  }

  try {
    const hoje = new Date();
    const de = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 3, 1))
      .toISOString()
      .slice(0, 10);
    const ate = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);

    const resp = await caGet<{ itens?: Record<string, unknown>[] }>(
      companyId,
      CONTA_AZUL_RESOURCES.contasAReceber.path!,
      { data_vencimento_de: de, data_vencimento_ate: ate, pagina: 1, tamanho_pagina: 100 },
    );
    const itens = resp.itens ?? [];

    /** Parece pago? (mesma heurística do sync, sem depender do nome da data) */
    const pago = (e: Record<string, unknown>) =>
      /receb|pag|quit|liquid/i.test(
        `${String(e.status ?? "")} ${String(e.situacao ?? "")}`,
      );

    const exemplo = itens.find(pago) ?? itens[0] ?? null;

    /** Só os campos que CHEIRAM a data (não vaza nome/documento de cliente). */
    const camposDeData = (e: Record<string, unknown> | null) =>
      e
        ? Object.fromEntries(
            Object.entries(e).filter(
              ([k, v]) =>
                /data|dt_|date|baixa|liquid|receb|pag|quit/i.test(k) &&
                (v === null || typeof v === "string" || typeof v === "number"),
            ),
          )
        : {};

    return NextResponse.json({
      janela: { de, ate },
      lidos: itens.length,
      comCaraDePago: itens.filter(pago).length,
      // TODAS as chaves do objeto — é aqui que se descobre um nome inesperado.
      chavesDoEvento: exemplo ? Object.keys(exemplo).sort() : [],
      // Os campos de data do exemplo, com os valores.
      camposDeDataDoExemplo: camposDeData(exemplo),
      // Quantos eventos "pagos" têm CADA campo de data preenchido — mostra qual
      // (se algum) serve como data de recebimento de verdade.
      preenchimentoNosPagos: (() => {
        const pagos = itens.filter(pago);
        const cont: Record<string, number> = {};
        for (const e of pagos)
          for (const [k, v] of Object.entries(e))
            if (/data|dt_|date|baixa|liquid|receb|quit/i.test(k) && v)
              cont[k] = (cont[k] ?? 0) + 1;
        return { totalPagos: pagos.length, porCampo: cont };
      })(),
    });
  } catch (e) {
    return NextResponse.json(
      { erro: (e as Error).message },
      { status: 502 },
    );
  }
}
