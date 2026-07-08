import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Empacota o app + só as dependências usadas em `.next/standalone` (server.js),
  // deixando a imagem Docker enxuta. Ver Dockerfile / jarvis.stack.yml.
  output: "standalone",
};

export default nextConfig;
