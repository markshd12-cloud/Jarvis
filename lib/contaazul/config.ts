/**
 * Escopo da integração com a Conta Azul (API v2 — https://developers.contaazul.com).
 *
 * Apenas constantes/config, SEM I/O. O token de acesso de cada empresa é guardado
 * no banco via service_role (nunca aqui). Os segredos do app (client id/secret)
 * vêm de variáveis de ambiente do `.env.local`.
 *
 * Diferente do Notion (que alimenta o RAG/conhecimento), os dados da Conta Azul
 * são estruturados e vão para o DASHBOARD (pessoas, vendas, financeiro).
 */

/** Base da API v2. Paginação por `pagina` + `tamanho_pagina` (nunca `page`). */
export const CONTA_AZUL_API_BASE = "https://api-v2.contaazul.com/v1";

/** OAuth 2.0 (Cognito). Scope é FIXO na v2. */
export const CONTA_AZUL_OAUTH = {
  authorizeUrl: "https://auth.contaazul.com/oauth2/authorize",
  tokenUrl: "https://auth.contaazul.com/oauth2/token",
  scope: "openid profile aws.cognito.signin.user.admin",
} as const;

/** Caminho da rota de callback OAuth (default; o `redirect_uri` precisa BATER com
 * o cadastrado no portal — por isso deixamos sobrescrever via env). */
export const CONTA_AZUL_CALLBACK_PATH = "/api/contaazul/callback";

/** Credenciais do app (portal de desenvolvedores). Configurar no `.env.local`. */
export const CONTA_AZUL_ENV = {
  clientId: process.env.CONTA_AZUL_CLIENT_ID ?? "",
  clientSecret: process.env.CONTA_AZUL_CLIENT_SECRET ?? "",
  /** URL completa de callback registrada no portal (ex.: https://app/api/contaazul/callback). */
  redirectUri: process.env.CONTA_AZUL_REDIRECT_URI ?? "",
} as const;

export const CONTA_AZUL_PAGINATION = {
  pageParam: "pagina",
  sizeParam: "tamanho_pagina",
  defaultSize: 100,
} as const;

/**
 * Recursos da API v2 que pretendemos puxar para o Dashboard.
 *
 * `confidence`:
 *  - "alta"  → caminho confirmado na documentação oficial.
 *  - "media" → grupo de recurso confirmado, mas o PATH exato ainda precisa ser
 *              conferido no OpenAPI logado (portal bloqueia leitura automática).
 *              Onde não temos o path, fica `null` de propósito — não chutar.
 */
export interface ContaAzulResource {
  /** Área do Dashboard que este recurso vai alimentar. */
  group: "cadastros" | "vendas" | "financeiro";
  /** Path relativo à base; `null` = ainda a confirmar no OpenAPI. */
  path: string | null;
  confidence: "alta" | "media";
}

// Paths validados AO VIVO contra a API v2 de produção (empresa CPPEM) em
// 2026-07-14 — todos retornam 200. Cadastros e vendas usam o sufixo `/busca`
// (padrão `/{recurso}/busca`); financeiro usa a árvore `/financeiro/*`.
export const CONTA_AZUL_RESOURCES = {
  pessoas: { group: "cadastros", path: "/pessoa", confidence: "alta" },
  produtos: { group: "cadastros", path: "/produtos", confidence: "alta" },
  servicos: { group: "cadastros", path: "/servico", confidence: "alta" },

  vendas: { group: "vendas", path: "/venda/busca", confidence: "alta" },

  categorias: { group: "financeiro", path: "/categorias", confidence: "alta" },
  categoriasDre: { group: "financeiro", path: "/financeiro/categorias-dre", confidence: "alta" },
  // Eventos financeiros exigem `data_vencimento_de` (+ `data_vencimento_ate`).
  contasAPagar: {
    group: "financeiro",
    path: "/financeiro/eventos-financeiros/contas-a-pagar/buscar",
    confidence: "alta",
  },
  contasAReceber: {
    group: "financeiro",
    path: "/financeiro/eventos-financeiros/contas-a-receber/buscar",
    confidence: "alta",
  },
  contasFinanceiras: { group: "financeiro", path: "/conta-financeira", confidence: "alta" },
  centrosDeCusto: { group: "financeiro", path: "/centro-de-custo", confidence: "alta" },
} satisfies Record<string, ContaAzulResource>;

/** Não existe endpoint de fluxo de caixa: compor a partir dos recursos financeiros. */
export const CONTA_AZUL_NO_CASHFLOW_ENDPOINT = true;
