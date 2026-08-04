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

    // ?recurso=pagar inspeciona contas A PAGAR (onde vive o fornecedor/professor);
    // default = a receber (a investigação original, da data de recebimento).
    const recurso = req.nextUrl.searchParams.get("recurso") === "pagar" ? "pagar" : "receber";
    const path =
      recurso === "pagar"
        ? CONTA_AZUL_RESOURCES.contasAPagar.path!
        : CONTA_AZUL_RESOURCES.contasAReceber.path!;

    const resp = await caGet<{ itens?: Record<string, unknown>[] }>(
      companyId,
      path,
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

    /**
     * Estrutura do FORNECEDOR/CLIENTE (contas a pagar traz o professor aqui).
     * Só as CHAVES e um exemplo do nome — para saber se dá pra importar a pessoa
     * junto da despesa em vez de cadastrar à mão.
     */
    const pessoaDoExemplo = (() => {
      const p = (exemplo?.fornecedor ?? exemplo?.cliente) as
        | Record<string, unknown>
        | null
        | undefined;
      if (!p || typeof p !== "object") return { presente: false };
      return {
        presente: true,
        campo: exemplo?.fornecedor ? "fornecedor" : "cliente",
        chaves: Object.keys(p).sort(),
        exemplo: {
          nome: p.nome ?? p.name ?? p.razao_social ?? null,
          id: p.id ?? null,
        },
      };
    })();

    return NextResponse.json({
      recurso,
      janela: { de, ate },
      lidos: itens.length,
      pessoaDoExemplo,
      /**
       * Quantos eventos têm o NOME de fato preenchido — não basta o objeto
       * existir: o CA devolve `{id: null, nome: null}` quando a conta não tem
       * fornecedor vinculado, e isso é "verdadeiro" em JS.
       */
      pessoa: (() => {
        const p = (e: Record<string, unknown>) =>
          (e.fornecedor ?? e.cliente) as { id?: unknown; nome?: unknown } | null;
        const comNome = itens.filter((e) => p(e)?.nome);
        const comId = itens.filter((e) => p(e)?.id);
        return {
          total: itens.length,
          comNome: comNome.length,
          comId: comId.length,
          /** Nomes distintos encontrados — é o que viraria cadastro. */
          exemplos: [
            ...new Set(comNome.map((e) => String(p(e)!.nome))),
          ].slice(0, 15),
        };
      })(),
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
