# syntax=docker/dockerfile:1
#
# Imagem de produção do Jarvis (Next.js 16 standalone).
#
# Os 3 providers "sem API key" convivem no MESMO container, mas cada um precisa
# de coisas diferentes (ver DEPLOY.md):
#   • Gemini (Vertex) → só a env var GOOGLE_SERVICE_ACCOUNT_JSON (nada aqui).
#   • GPT   (Codex)   → token OAuth em /root/.codex/auth.json  (volume no stack).
#   • Claude (CLI)    → binário `claude` (instalado abaixo) + sessão OAuth em
#                       /root/.claude (volume no stack).
#
# Debian slim (não alpine): o binário `claude` e o ripgrep que ele embute
# esperam glibc.

# ---- Base -------------------------------------------------------------------
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- Dependências -----------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- Build ------------------------------------------------------------------
FROM base AS builder
# NEXT_PUBLIC_* são INLINADOS no bundle do cliente em tempo de BUILD — precisam
# existir aqui (passados como --build-arg). Ver DEPLOY.md.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- Runner -----------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    HOME=/root

# Provider "claude": o binário do Claude Code CLI (lê a sessão OAuth de /root/.claude).
RUN npm install -g @anthropic-ai/claude-code \
    && rm -rf /root/.npm

# Saída standalone do Next: server.js + node_modules mínimos + estáticos.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Homes das sessões OAuth (viram pontos de montagem dos volumes persistentes).
RUN mkdir -p /root/.codex /root/.claude

EXPOSE 3000
CMD ["node", "server.js"]
