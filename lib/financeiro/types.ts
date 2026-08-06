/**
 * Tipos do domínio financeiro (espelham as tabelas do 0023). Compartilhados
 * entre a camada de acesso (`lib/financeiro/*`), as rotas e a UI. Não fazem I/O.
 */

export type FinTipo =
  | "receita"
  | "deducao"
  | "custo"
  | "despesa"
  | "imposto"
  | "financeira";

export type Natureza = "fixa" | "variavel";

export type TipoPessoa = "colaborador" | "fornecedor";
export const TIPOS_PESSOA: TipoPessoa[] = ["colaborador", "fornecedor"];

export type Periodicidade =
  | "mensal"
  | "bimestral"
  | "trimestral"
  | "semestral"
  | "anual";
/** Em ordem de ciclo — é a ordem que aparece no seletor. */
export const PERIODICIDADES: Periodicidade[] = [
  "mensal",
  "bimestral",
  "trimestral",
  "semestral",
  "anual",
];

/**
 * Meses entre uma ocorrência e a seguinte. É a única regra de geração: a
 * recorrência gera quando (meses desde `inicio_competencia`) % passo == 0.
 * Para 'anual' (12) isso equivale ao "mesmo mês do início" de antes.
 */
export const PASSO_MESES: Record<Periodicidade, number> = {
  mensal: 1,
  bimestral: 2,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};

/** Rótulo para o usuário — diz o ciclo em vez de só nomeá-lo. */
export const PERIODICIDADE_LABEL: Record<Periodicidade, string> = {
  mensal: "mensal (todo mês)",
  bimestral: "bimestral (a cada 2 meses)",
  trimestral: "trimestral (a cada 3 meses)",
  semestral: "semestral (a cada 6 meses)",
  anual: "anual (1x por ano)",
};

/** Despesa fixa que se materializa em despesa+parcela por competência. */
export interface FinRecorrencia {
  id: string;
  company_id: string;
  descricao: string;
  categoria_id: string;
  bu_id: string;
  /** Centro de custo repassado à despesa gerada; null = sem centro. */
  centro_custo_id: string | null;
  colaborador_id: string | null;
  valor_previsto: number;
  dia_vencimento: number;
  periodicidade: Periodicidade;
  /** Rateio por BU da despesa gerada ({bu_id, percentual}[], Σ=100%); null = 100% na bu_id. */
  rateio: { bu_id: string; percentual: number }[] | null;
  /** 1ª competência a gerar ('AAAA-MM'); null = sem restrição. */
  inicio_competencia: string | null;
  /** Meses entre competência e vencimento. 0 = mesmo mês; 1 = paga no seguinte. */
  defasagem_meses: number;
  /** Método repassado à parcela gerada (pix/boleto/…); null = não informado. */
  metodo_pagamento: string | null;
  ativo: boolean;
  created_at: string;
}

export const FIN_TIPOS: FinTipo[] = [
  "receita",
  "deducao",
  "custo",
  "despesa",
  "imposto",
  "financeira",
];

/** Grupos do DRE (01…08). É também a hierarquia da aba Cadastros. */
export const GRUPOS_DRE = ["01", "02", "03", "04", "05", "06", "07", "08"] as const;
export type GrupoDre = (typeof GRUPOS_DRE)[number];

export interface BusinessUnit {
  id: string;
  company_id: string;
  nome: string;
  slug: string;
  cnpj: string | null;
  cor: string | null;
  ativo: boolean;
  ordem: number;
}

export interface FinCentro {
  id: string;
  company_id: string;
  codigo: string | null;
  nome: string;
  ca_centro_id: string | null;
  ativo: boolean;
  ordem: number;
}

/**
 * Traduz erro do Supabase numa mensagem amigável. `23503` = foreign_key_violation
 * (dimensão em uso por um lançamento) → orienta a inativar em vez de excluir.
 */
export function fkFriendly(
  error: { code?: string; message: string },
  rotulo: string,
): string {
  if (error.code === "23503")
    return `${rotulo} em uso por lançamentos — inative em vez de excluir.`;
  return error.message;
}

export interface FinCategoria {
  id: string;
  company_id: string;
  parent_id: string | null;
  codigo: string | null;
  nome: string;
  tipo: FinTipo;
  grupo_dre: GrupoDre | null;
  natureza: Natureza | null;
  bu_id: string | null;
  ca_categoria_id: string | null;
  ativo: boolean;
  ordem: number;
}

export interface FinColaborador {
  id: string;
  company_id: string;
  nome: string;
  cpf_cnpj: string | null;
  tipo: TipoPessoa;
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  chave_pix: string | null;
  cargo: string | null;
  salario_base: number | null;
  bu_id: string | null;
  ca_pessoa_id: string | null;
  profile_id: string | null;
  ativo: boolean;
}

/** Usuário da empresa (profile) — origem de identidade p/ importar/vincular colaborador. */
export interface MembroEmpresa {
  id: string;
  nome: string;
  email: string | null;
  /** Empresa a que o usuário pertence. O grupo tem 3 (CPPEM/UNICIVE/COLEGIO) e o
   *  financeiro roda em uma só, mas a mesma pessoa pode ser cadastrada em outra. */
  empresa: string;
  /** `true` quando o usuário é de OUTRA empresa que não a do financeiro. */
  externa: boolean;
}

export type StatusParcela =
  | "prevista"
  | "a_pagar"
  | "paga"
  | "atrasada"
  | "cancelada";

/** Situação derivada (venc × hoje × pagamento) — usada p/ agrupar Contas a Pagar. */
export type SituacaoParcela = "paga" | "vencida" | "a_vencer";

/** Grupo do filtro de Contas a Pagar (note "pagas", plural — não é a situação). */
export type GrupoParcela = "a_vencer" | "vencida" | "pagas" | "todas";

/** Sugestões de método de pagamento (campo é texto livre — evolui sem migration). */
export const METODOS_PAGAMENTO = [
  "pix",
  "boleto",
  "cartao",
  "transferencia",
  "dinheiro",
  "debito_automatico",
  "guru",
  "stone",
] as const;

/** Linha da lista de Contas a Pagar: parcela + contexto da despesa (achatado). */
export interface ParcelaRow {
  id: string;
  despesa_id: string;
  numero: number;
  num_parcelas: number;
  descricao: string;
  categoria_nome: string | null;
  centro_nome: string | null;
  /**
   * Fornecedor OU colaborador da despesa — os dois vivem em `fin_colaboradores`,
   * distinguidos por `colaborador_tipo`. `null` quando a despesa não tem ninguém
   * vinculado (é a maioria das compras avulsas).
   */
  colaborador_nome: string | null;
  colaborador_tipo: "colaborador" | "fornecedor" | null;
  bu_id: string;
  bu_nome: string | null;
  valor_previsto: number;
  valor_realizado: number | null;
  data_competencia: string;
  data_vencimento: string;
  data_pagamento: string | null;
  status: StatusParcela;
  metodo_pagamento: string | null;
  situacao: SituacaoParcela;
  /**
   * Rateio por BU desta parcela, já com o valor de cada fatia em reais. Vazio =
   * sem rateio (100% na `bu_id`). Havendo rateio, ELE manda — a `bu_id` é só a
   * BU principal (maior %), usada como âncora/fallback.
   */
  rateio: { bu_id: string; bu_nome: string; percentual: number; valor: number }[];
}

/** Meta orçamentária por categoria × BU × competência (Passo 9). bu null = "todas". */
export interface FinOrcamento {
  id: string;
  company_id: string;
  categoria_id: string;
  bu_id: string | null;
  competencia: string;
  valor_orcado: number;
  valor_limite: number | null;
  ativo: boolean;
  created_at: string;
}

/**
 * Linha do comparativo Orçado × Previsto × Realizado × Limite numa competência.
 * Previsto = Σ das parcelas lançadas; Realizado = Σ das pagas. Os dois flags
 * derivam na leitura (não materializam `fin_alertas` — isso é do Dashboard TV).
 */
export interface OrcamentoLinha {
  id: string | null; // id do fin_orcamentos, se já existe meta pra (categoria, bu)
  categoria_id: string;
  bu_id: string | null;
  competencia: string;
  orcado: number;
  limite: number | null;
  previsto: number;
  realizado: number;
  previstoExcede: boolean; // previsto > orçado (pré-alerta)
  limiteEstourado: boolean; // realizado > limite (estouro)
}

/** Linha da sugestão de previsão (média mensal do custo histórico). */
export interface OrcamentoSugestaoLinha {
  categoria_id: string;
  bu_id: string | null;
  sugerido: number;
  mesesComDado: number; // em quantos dos N meses houve lançamento (confiança)
}
