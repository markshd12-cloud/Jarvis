/**
 * Import de despesas do Conta Azul para as NOSSAS tabelas (Passo 11). Espelha o
 * snapshot de receita, mas grava em `fin_despesas` + `fin_parcelas` com
 * `fonte='ca_import'` e `ca_evento_id` (dedup pela unique de 0023).
 *
 * INSERT-ONLY: nunca sobrescreve um evento já importado — preserva baixa,
 * edição e reatribuição de BU feitas na aba Contas a Pagar. Re-rodar só traz
 * eventos NOVOS. Assim, importar → cortar (cutover) é seguro e idempotente, e o
 * DRE nunca conta uma despesa duas vezes (a competência cortada lê SÓ daqui).
 *
 * Cada evento de contas-a-pagar do CA vira 1 despesa à vista (1 parcela). Sem BU
 * mapeada na categoria → cai na BU "Geral" (reatribuível depois). Sem de-para de
 * categoria → é pulado (fin_despesas.categoria_id é obrigatória). Server-only.
 */
import "server-only";

import { caGet, ContaAzulError } from "@/lib/contaazul/client";
import { CONTA_AZUL_RESOURCES } from "@/lib/contaazul/config";
import { createAdminClient } from "@/lib/supabase/admin";

interface EventoPagar {
  id?: string | null;
  descricao?: string | null;
  total?: unknown;
  data_competencia?: string | null;
  data_vencimento?: string | null;
  data_pagamento?: string | null;
  status?: string | null;
  situacao?: string | null;
  categorias?: Array<{ id?: string | null }> | null;
  /** Pessoa da conta — os professores vivem aqui. Vem `{id:null,nome:null}` quando não há. */
  fornecedor?: { id?: string | null; nome?: string | null } | null;
}

/**
 * Normaliza nome p/ comparação: maiúsculas, sem acento, sem pontuação e sem o
 * prefixo "PROF."/"PROFESSOR". Serve só para RECONHECER alguém que já existe —
 * nunca para renomear (o nome do CA é preservado como veio).
 */
function chaveNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/^PROF(ESSOR[AO]?)?\.?\s+/, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
interface BuscaResp {
  itens?: EventoPagar[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 'AAAA-MM-DD' de hoje + delta meses (dia 1). */
function ymdAddMonths(delta: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + delta, 1));
  return d.toISOString().slice(0, 10);
}

const foiPago = (e: EventoPagar): boolean =>
  !!e.data_pagamento || /pag|quit|liquid/i.test(`${e.status ?? ""} ${e.situacao ?? ""}`);

async function fetchPagar(companyId: string, de: string, ate: string): Promise<EventoPagar[]> {
  const path = CONTA_AZUL_RESOURCES.contasAPagar.path!;
  const out: EventoPagar[] = [];
  for (let pagina = 1; pagina <= 60; pagina++) {
    const resp = await caGet<BuscaResp>(companyId, path, {
      data_vencimento_de: de,
      data_vencimento_ate: ate,
      pagina,
      tamanho_pagina: 100,
    });
    const itens = resp.itens ?? [];
    out.push(...itens);
    if (itens.length < 100) break;
  }
  return out;
}

/**
 * Resolve o `colaborador_id` de cada fornecedor que aparece nos eventos —
 * criando os que faltam como `tipo='fornecedor'`.
 *
 * Dedup em duas camadas, da mais forte para a mais fraca:
 *  1. `ca_pessoa_id` — exato e estável, é o id da pessoa no próprio CA.
 *  2. Nome normalizado — só para ADOTAR alguém que já existe sem o de-para (ex.:
 *     um sócio importado dos usuários do Jarvis que também paga por fora). Nesse
 *     caso apenas gravamos o `ca_pessoa_id` nele, sem duplicar nem renomear.
 *
 * Retorna Map<ca_pessoa_id, colaborador_id>.
 */
async function resolverFornecedores(
  companyId: string,
  eventos: EventoPagar[],
): Promise<{ mapa: Map<string, string>; criados: number }> {
  const admin = createAdminClient();

  // Fornecedores distintos presentes nos eventos (id + nome preenchidos).
  const distintos = new Map<string, string>(); // ca_pessoa_id -> nome
  for (const e of eventos) {
    const id = e.fornecedor?.id;
    const nome = e.fornecedor?.nome?.trim();
    if (id && nome) distintos.set(id, nome);
  }
  if (distintos.size === 0) return { mapa: new Map(), criados: 0 };

  const { data: existentes, error } = await admin
    .from("fin_colaboradores")
    .select("id, nome, ca_pessoa_id")
    .eq("company_id", companyId);
  if (error) throw new Error(`resolverFornecedores: ${error.message}`);

  const porCaId = new Map<string, string>();
  const porNome = new Map<string, { id: string; temCaId: boolean }>();
  for (const c of existentes ?? []) {
    const caId = c.ca_pessoa_id as string | null;
    if (caId) porCaId.set(caId, c.id as string);
    const k = chaveNome(c.nome as string);
    if (k && !porNome.has(k))
      porNome.set(k, { id: c.id as string, temCaId: !!caId });
  }

  const mapa = new Map<string, string>();
  const novos: { company_id: string; nome: string; tipo: string; ca_pessoa_id: string }[] = [];

  for (const [caId, nome] of distintos) {
    const jaPorId = porCaId.get(caId);
    if (jaPorId) {
      mapa.set(caId, jaPorId);
      continue;
    }
    const porNomeHit = porNome.get(chaveNome(nome));
    if (porNomeHit && !porNomeHit.temCaId) {
      // Mesma pessoa já cadastrada sem de-para: adota o vínculo, não duplica.
      await admin
        .from("fin_colaboradores")
        .update({ ca_pessoa_id: caId })
        .eq("company_id", companyId)
        .eq("id", porNomeHit.id);
      mapa.set(caId, porNomeHit.id);
      porCaId.set(caId, porNomeHit.id);
      continue;
    }
    novos.push({ company_id: companyId, nome, tipo: "fornecedor", ca_pessoa_id: caId });
  }

  if (novos.length > 0) {
    const { data: inseridos, error: eIns } = await admin
      .from("fin_colaboradores")
      .insert(novos)
      .select("id, ca_pessoa_id");
    if (eIns) throw new Error(`resolverFornecedores (criar): ${eIns.message}`);
    for (const c of inseridos ?? [])
      mapa.set(c.ca_pessoa_id as string, c.id as string);
  }

  return { mapa, criados: novos.length };
}

export interface ImportDespesasResult {
  connected: boolean;
  janela: { de: string; ate: string };
  lidos: number;
  /** Despesas inseridas nesta rodada. */
  novos: number;
  /** Eventos do CA já presentes (pulados — nunca sobrescrevemos). */
  jaImportados: number;
  /** Eventos sem id do CA (impossível deduplicar → pulados). */
  semId: number;
  /** Eventos sem de-para de categoria (obrigatória → pulados). */
  semCategoria: number;
  /** Eventos ignorados por serem de competência posterior ao teto pedido. */
  foraDoTeto: number;
  /** Fornecedores (professores etc.) criados a partir do campo `fornecedor` do CA. */
  fornecedoresCriados: number;
  /** Despesas que ficaram vinculadas a um fornecedor. */
  comFornecedor: number;
  /** Teto de competência aplicado nesta rodada ('AAAA-MM'), ou null. */
  ateCompetencia: string | null;
  /** Houve despesa sem BU e sem BU "Geral" p/ ancorar → rode o seed. */
  buGeralFaltando: boolean;
  erro?: string;
}

/**
 * Importa as despesas do CA da janela (default: últimos 12 meses até +1 mês, por
 * vencimento). Insert-only por `ca_evento_id`. Degrada em erro do CA.
 *
 * `ateCompetencia` ('AAAA-MM', opcional): **teto de competência** — eventos de
 * competência POSTERIOR são ignorados e nem chegam a ser gravados. Serve para
 * recuperar histórico sem invadir os meses que já estão sendo lançados à mão no
 * Jarvis (ex.: importar só até 07/2026 porque agosto em diante é digitado). O
 * filtro é por COMPETÊNCIA (não vencimento): a janela de busca continua ampla,
 * porque uma competência antiga pode ter vencimento à frente.
 */
export async function importarDespesas(
  companyId: string,
  meses = 12,
  ateCompetencia?: string,
): Promise<ImportDespesasResult> {
  const teto =
    ateCompetencia && /^\d{4}-\d{2}$/.test(ateCompetencia) ? ateCompetencia : null;
  // Janela por VENCIMENTO. Precisa ser SUPERSET da janela que cada competência do
  // DRE usa (a reconciliação/DRE buscam vencimento em [C-2, C+3]); senão o import
  // fica com MENOS eventos que o DRE mostra — ex.: despesa de competência C com
  // vencimento 2 meses à frente — e a reconciliação nunca zera. -2 no passado e
  // +4 no futuro cobrem qualquer competência dos últimos `meses` meses.
  const de = ymdAddMonths(-(meses + 2));
  const ate = ymdAddMonths(4);
  const janela = { de, ate };

  let eventos: EventoPagar[];
  try {
    eventos = await fetchPagar(companyId, de, ate);
  } catch (e) {
    const erro =
      e instanceof ContaAzulError
        ? e.message
        : `Falha ao ler o Conta Azul: ${(e as Error).message}`;
    return {
      connected: false,
      janela,
      lidos: 0,
      novos: 0,
      jaImportados: 0,
      semId: 0,
      semCategoria: 0,
      foraDoTeto: 0,
      fornecedoresCriados: 0,
      comFornecedor: 0,
      ateCompetencia: teto,
      buGeralFaltando: false,
      erro,
    };
  }

  const admin = createAdminClient();

  // de-para: ca_categoria_id → { fin_categoria_id, bu_id }
  const { data: cats, error: eCat } = await admin
    .from("fin_categorias")
    .select("id, ca_categoria_id, bu_id")
    .eq("company_id", companyId)
    .not("ca_categoria_id", "is", null);
  if (eCat) throw new Error(`importarDespesas (categorias): ${eCat.message}`);
  const porCaCat = new Map<string, { id: string; bu_id: string | null }>();
  for (const c of cats ?? [])
    porCaCat.set(c.ca_categoria_id as string, {
      id: c.id as string,
      bu_id: (c.bu_id as string | null) ?? null,
    });

  // BU default p/ despesa sem BU mapeada: "Geral" (criada no seed).
  const { data: buGeral } = await admin
    .from("business_units")
    .select("id")
    .eq("company_id", companyId)
    .eq("slug", "geral")
    .maybeSingle();
  const buGeralId = (buGeral?.id as string | undefined) ?? null;

  // Eventos já importados (dedup) — INSERT-ONLY. Buscamos os ca_evento_id JÁ
  // gravados desta empresa (poucos na 1ª vez), paginando — em vez de um `.in()`
  // com os milhares de ids buscados do CA, que monta uma URL gigante e faz o
  // PostgREST responder 400 Bad Request. O select capa em 1000 linhas → paginar.
  const LOTE = 500; // tamanho dos lotes de INSERT/DELETE
  const jaSet = new Set<string>();
  for (let pagina = 0; ; pagina++) {
    const { data: exist, error: eEx } = await admin
      .from("fin_despesas")
      .select("ca_evento_id")
      .eq("company_id", companyId)
      .not("ca_evento_id", "is", null)
      .range(pagina * 1000, pagina * 1000 + 999);
    if (eEx) throw new Error(`importarDespesas (existentes): ${eEx.message}`);
    for (const r of exist ?? []) jaSet.add(r.ca_evento_id as string);
    if (!exist || exist.length < 1000) break;
  }

  let semId = 0;
  let semCategoria = 0;
  let jaImportados = 0;
  let foraDoTeto = 0;
  let buGeralFaltando = false;

  // Monta as linhas em memória; grava em 2 statements (batch) no fim.
  const pend: {
    ca_evento_id: string;
    despesa: Record<string, unknown>;
    parcela: Record<string, unknown>;
  }[] = [];
  const visto = new Set<string>(); // evita evento repetido dentro do MESMO fetch

  /**
   * Fornecedores (professores, prestadores) resolvidos ANTES de montar as
   * despesas: o CA traz a pessoa no evento, e cadastrá-la à mão era inviável.
   * Falha aqui não derruba o import — a despesa entra sem vínculo.
   */
  let fornecedores = new Map<string, string>();
  let fornecedoresCriados = 0;
  try {
    const r = await resolverFornecedores(companyId, eventos);
    fornecedores = r.mapa;
    fornecedoresCriados = r.criados;
  } catch (e) {
    console.error("[import] fornecedores:", (e as Error).message);
  }
  let comFornecedor = 0;

  for (const e of eventos) {
    if (!e.id) {
      semId++;
      continue;
    }
    if (jaSet.has(e.id) || visto.has(e.id)) {
      jaImportados++;
      continue;
    }
    // Teto de competência: nada acima dele é gravado (mesma regra de competência
    // que o DRE usa — `data_competencia` com fallback pro vencimento).
    if (teto) {
      const comp = (e.data_competencia ?? e.data_vencimento ?? "").slice(0, 7);
      if (!comp || comp > teto) {
        foraDoTeto++;
        continue;
      }
    }
    const caCat = e.categorias?.[0]?.id ?? null;
    const map = caCat ? porCaCat.get(caCat) : undefined;
    if (!map) {
      semCategoria++;
      continue;
    }
    const bu_id = map.bu_id ?? buGeralId;
    if (!bu_id) {
      buGeralFaltando = true;
      continue; // parcela exige BU; sem Geral não há como ancorar
    }

    const valor = Math.abs(num(e.total));
    const comp = (e.data_competencia ?? e.data_vencimento ?? "").slice(0, 10) || ymdAddMonths(0);
    const venc = (e.data_vencimento ?? e.data_competencia ?? "").slice(0, 10) || comp;
    const pago = foiPago(e);

    // Vincula a pessoa da conta (professor/prestador), quando o CA a informa.
    const colaboradorId = e.fornecedor?.id
      ? fornecedores.get(e.fornecedor.id) ?? null
      : null;
    if (colaboradorId) comFornecedor++;

    visto.add(e.id);
    pend.push({
      ca_evento_id: e.id,
      despesa: {
        company_id: companyId,
        descricao: (e.descricao ?? "").trim() || "Despesa (Conta Azul)",
        categoria_id: map.id,
        colaborador_id: colaboradorId,
        valor_total: valor,
        num_parcelas: 1,
        fonte: "ca_import",
        ca_evento_id: e.id,
      },
      parcela: {
        company_id: companyId,
        numero: 1,
        bu_id,
        valor_previsto: valor,
        valor_realizado: pago ? valor : null,
        data_competencia: comp,
        data_vencimento: venc,
        data_pagamento: pago ? (e.data_pagamento ?? venc) : null,
        status: pago ? "paga" : "a_pagar",
      },
    });
  }

  // Grava em LOTES (despesas → parcelas). Lotes evitam payloads gigantes e
  // deixam o import resiliente: um lote que colida na unique (corrida/dup) é
  // pulado sem abortar o resto.
  let novos = 0;
  for (let i = 0; i < pend.length; i += LOTE) {
    const lote = pend.slice(i, i + LOTE);
    const { data: inserted, error: e1 } = await admin
      .from("fin_despesas")
      .insert(lote.map((p) => p.despesa))
      .select("id, ca_evento_id");
    if (e1) {
      // Unique (company_id, ca_evento_id): já existe → conta como já importado.
      if ((e1 as { code?: string }).code === "23505") {
        jaImportados += lote.length;
        continue;
      }
      throw new Error(`importarDespesas (despesas): ${e1.message}`);
    }
    const idByEvento = new Map<string, string>();
    for (const r of inserted ?? [])
      idByEvento.set(r.ca_evento_id as string, r.id as string);

    const parcelas = lote.map((p) => ({
      ...p.parcela,
      despesa_id: idByEvento.get(p.ca_evento_id),
    }));
    const { error: e2 } = await admin.from("fin_parcelas").insert(parcelas);
    if (e2) {
      // Compensating delete: despesa não pode existir sem sua parcela. Sub-lotes
      // de 150 no `.in()` p/ não estourar a URL do PostgREST.
      const criados = [...idByEvento.values()];
      for (let j = 0; j < criados.length; j += 150)
        await admin
          .from("fin_despesas")
          .delete()
          .eq("company_id", companyId)
          .in("id", criados.slice(j, j + 150));
      throw new Error(`importarDespesas (parcelas): ${e2.message}`);
    }
    novos += lote.length;
  }

  return {
    connected: true,
    janela,
    lidos: eventos.length,
    novos,
    jaImportados,
    semId,
    semCategoria,
    foraDoTeto,
    fornecedoresCriados,
    comFornecedor,
    ateCompetencia: teto,
    buGeralFaltando,
  };
}
