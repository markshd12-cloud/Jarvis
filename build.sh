#!/usr/bin/env bash
# Builda a imagem de produção do Jarvis NO NÓ (o Swarm usa a imagem local do nó).
# Lê os valores de .env.production — o MESMO arquivo que você cola no Portainer.
#
# Uso, na VPS, dentro da pasta do projeto:
#   bash build.sh                 # usa ./.env.production e tag jarvis:latest
#   bash build.sh caminho/.env    # usa outro arquivo de env
#
# Os NEXT_PUBLIC_* são "inlinados" no bundle do cliente em tempo de BUILD, por
# isso vão como --build-arg (não bastam em runtime). Ver DEPLOY.md.
set -euo pipefail

ENV_FILE="${1:-.env.production}"
if [ ! -f "$ENV_FILE" ]; then
  echo "ERRO: não achei '$ENV_FILE'. Copie de .env.production.example e preencha." >&2
  exit 1
fi

# Carrega as variáveis do arquivo (ignora comentários/linhas vazias e CRLF).
set -a
# shellcheck disable=SC1090
. <(grep -vE '^[[:space:]]*#|^[[:space:]]*$' "$ENV_FILE" | sed 's/\r$//')
set +a

: "${NEXT_PUBLIC_SUPABASE_URL:?defina NEXT_PUBLIC_SUPABASE_URL em $ENV_FILE}"
: "${NEXT_PUBLIC_BASE_URL:?defina NEXT_PUBLIC_BASE_URL (domínio público) em $ENV_FILE}"

IMAGE="${JARVIS_IMAGE:-jarvis:latest}"
echo ">> Buildando $IMAGE (base: $NEXT_PUBLIC_BASE_URL) ..."

docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" \
  --build-arg NEXT_PUBLIC_BASE_URL="$NEXT_PUBLIC_BASE_URL" \
  --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY="${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-}" \
  -t "$IMAGE" .

echo ""
echo ">> OK: imagem '$IMAGE' criada neste nó."
echo ">> Se usa registry: docker push \"$IMAGE\" (e ajuste JARVIS_IMAGE no stack)."
