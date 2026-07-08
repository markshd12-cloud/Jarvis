import { createVertex } from "@ai-sdk/google-vertex";

/**
 * Provider do Gemini via Vertex AI, autenticando com a service account
 * (GOOGLE_SERVICE_ACCOUNT_JSON do .env.local) — sem API key.
 *
 * O parse é tolerante: no `docker build` (e em qualquer ambiente sem a env) o
 * módulo NÃO pode lançar ao ser importado, senão quebra o `next build` inteiro.
 * Sem credencial, o provider só falha quando o Gemini é REALMENTE chamado
 * (fallback/embeddings), não na carga do módulo.
 */
const rawServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const serviceAccount = rawServiceAccount
  ? JSON.parse(rawServiceAccount)
  : { client_email: "", private_key: "" };

export const vertex = createVertex({
  project: process.env.GOOGLE_CLOUD_PROJECT!,
  location: process.env.GOOGLE_VERTEX_LOCATION ?? "us-central1",
  googleAuthOptions: {
    credentials: {
      client_email: serviceAccount.client_email,
      private_key: serviceAccount.private_key,
    },
  },
});

/** Modelo padrão do chat (sobrescrevível por env). */
export const chatModel = vertex(process.env.GEMINI_MODEL ?? "gemini-2.5-flash");
