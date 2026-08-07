import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Empacota o app + só as dependências usadas em `.next/standalone` (server.js),
  // deixando a imagem Docker enxuta. Ver Dockerfile / jarvis.stack.yml.
  output: "standalone",

  experimental: {
    serverActions: {
      /**
       * Teto do corpo de uma Server Action. O padrão do Next é **1 MB**, e a
       * tela Personalizar sobe ARQUIVO por Server Action — qualquer anexo maior
       * estourava com `Body exceeded 1 MB limit` (HTTP 413), que o navegador
       * mostrava como uma página 404. O usuário via "não encontrado" sem
       * nenhuma pista do tamanho.
       *
       * O extrator (`lib/sources/extract.ts`) já anunciava aceitar 5 MB, então
       * a interface prometia o que o transporte recusava.
       *
       * 6 MB, e não 5: o corpo carrega o arquivo MAIS título, conteúdo e o
       * overhead do multipart. Um teto igual ao do arquivo quebraria justamente
       * no anexo de 5 MB.
       */
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
