# Providers de IA do Jarvis (sem API key)

O Jarvis usa **três** motores de IA, todos autenticados **sem API key** paga por
requisição sempre que possível. Este documento explica como cada um funciona,
como conectar o GPT (login do ChatGPT), e como a **geração de imagem** escolhe
entre Imagen e GPT.

> Deploy em produção (Docker Swarm/Portainer): ver [`DEPLOY.md`](../DEPLOY.md).

---

## Visão geral

| Provider | Papel | Como autentica | Precisa no servidor |
|----------|-------|----------------|---------------------|
| **Claude** (CLI) | Texto principal (padrão) | Sessão OAuth (`claude login`) em `~/.claude/.credentials.json` | Binário `claude` + volume `~/.claude` |
| **GPT** (Codex OAuth) | Texto/imagem alternativos | Login do ChatGPT em `~/.codex/auth.json` | Volume `~/.codex` (sem binário) |
| **Gemini** (Vertex) | Fallback de texto + embeddings/memória + Imagen | Service account JSON na env `GOOGLE_SERVICE_ACCOUNT_JSON` | Só a env var |

Nenhum deles usa `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` no fluxo padrão — o código
remove essas chaves do ambiente para forçar o uso da sessão logada.

### Provider de texto principal

Configurável por `JARVIS_DEFAULT_PROVIDER` no `.env.local` (exige **restart** do
dev/servidor após mudar):

```
JARVIS_DEFAULT_PROVIDER=claude   # padrão. Também: codex (GPT) | gemini
```

O Claude é o preferido para respostas visíveis ao usuário. O GPT e o Gemini
entram como alternativas/fallback.

---

## GPT via login do ChatGPT (Codex OAuth)

Roda **GPT-5.5 pelo backend Codex do ChatGPT**, usando seu login normal — **sem
API key** (a cobrança vai pela sua assinatura ChatGPT). É o análogo do bridge do
Claude, mas por HTTP direto (`lib/ai/codex.ts`), então roda em qualquer host.

**Requisito:** conta ChatGPT com Codex disponível (Plus/Pro/Business). O modelo
aceito para conta ChatGPT é **`gpt-5.5`** — nomes `*-codex` (`gpt-5-codex` etc.)
são recusados com _"model is not supported when using Codex with a ChatGPT
account"_.

### Como conectar (interface)

1. **Configurações → Conexões → ChatGPT (GPT) → Conectar ChatGPT**.
2. Abre uma aba de login da OpenAI. Faça login e **autorize**.
3. Pronto — a tela conecta **sozinha** (não precisa copiar nada).

Nos bastidores, o Jarvis sobe um servidor local em `127.0.0.1:1455` que captura o
redirect do OAuth automaticamente (igual ao Codex CLI oficial) e grava o token em
`~/.codex/auth.json`. O token é renovado automaticamente perto de expirar.

> **Login remoto (VPS):** o loopback em `1455` só funciona quando o navegador e o
> servidor estão na mesma máquina (dev local). Em servidor remoto, use a opção
> **"Usar código do dispositivo"** no mesmo card.

### Configuração (opcional)

```
# Usar o GPT como provider de TEXTO principal (padrão é claude)
JARVIS_DEFAULT_PROVIDER=codex

# Sobrescrever o modelo (default: gpt-5.5 — o único aceito p/ conta ChatGPT)
OPENAI_CODEX_MODEL=gpt-5.5

# Endpoints do fluxo OAuth já vêm com defaults corretos do Codex embutidos no
# código; só o endpoint de responses e o originator são lidos do ambiente:
OPENAI_CODEX_RESPONSES_URL=https://chatgpt.com/backend-api/codex/responses
OPENAI_OAUTH_ORIGINATOR=codex_cli_rs
```

---

## Geração de imagem

Por padrão o Jarvis gera imagem com o **Imagen (Vertex/Google)** — rápido e sem
API key. O **GPT** pode gerar imagem **sob demanda** (via OAuth do ChatGPT,
também sem API key), mas é **mais lento (~47s)**.

### Sob demanda: peça o GPT por palavra-chave

Escreva o pedido de imagem normalmente. Se mencionar **GPT**, aquela imagem vai
para o GPT; senão, vai para o Imagen.

| Exemplo no chat | Motor |
|-----------------|-------|
| "Crie uma imagem de um gato astronauta" | **Imagen** ⚡ |
| "Crie uma imagem **com o GPT** de um gato astronauta" | **GPT** 🤖 |
| "faça uma imagem, **use o gpt**, de um logo azul" | **GPT** 🤖 |
| "gere **pelo gpt-5** uma ilustração de robô" | **GPT** 🤖 |
| "desenhe um banner da empresa" | **Imagen** ⚡ |

Gatilhos reconhecidos: `gpt`, `gpt-5`, `chatgpt`, com ou sem
`com/pelo/usando/via/no`. A frase de roteamento é removida do prompt antes de
gerar, e se o GPT falhar a imagem cai automaticamente no Imagen.

**Detecção de imagem:** o turno de imagem dispara quando há um verbo de criação
("crie/gere/faça/desenhe…") perto de um substantivo visual ("imagem/desenho/
ilustração/logo…"), **ou** quando o pedido menciona **GPT** com verbo de criação
e sem indício de tarefa textual. Ou seja:

- "Crie **uma imagem** de um cachorro" → imagem (Imagen)
- "Crie um cachorro de muleta **com o GPT**" → imagem (GPT) — não precisa dizer "imagem"
- "faça um **resumo** com o gpt" → **texto** (tarefa textual, não vira imagem)

### GPT como padrão global (opcional)

Para toda imagem ir pelo GPT sem precisar digitar a palavra-chave:

```
JARVIS_IMAGE_PROVIDER=gpt   # vazio/qualquer outro valor → Imagen (padrão)
```

Nesse modo o Imagen vira fallback. Requer login do ChatGPT ativo.

### Modelo/tamanho da imagem (opcional)

```
OPENAI_CODEX_IMAGE_MODEL=gpt-5.5   # default
OPENAI_CODEX_IMAGE_SIZE=1024x1024  # default
IMAGEN_MODEL=imagen-4.0-fast-generate-001  # modelo do Imagen
```

---

## Gemini (Vertex)

Autentica por **service account** (sem API key). Usado como:
- **Fallback** de texto quando o provider principal falha antes de responder;
- Motor de **embeddings** e **destilação de memórias** (RAG);
- **Imagen** (geração de imagem padrão).

```
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}   # JSON em UMA linha
GOOGLE_CLOUD_PROJECT=seu-projeto
GOOGLE_VERTEX_LOCATION=us-central1
GEMINI_MODEL=gemini-2.5-flash
```

---

## Onde os tokens ficam (importante)

- **Claude:** `~/.claude/.credentials.json` (arquivo — precisa de volume no Docker)
- **GPT:** `~/.codex/auth.json` (arquivo — precisa de volume no Docker)
- **Gemini:** env var (nada em disco)

Ou seja, GPT e Claude só funcionam onde o processo tem acesso persistente ao
arquivo de sessão — **self-hosted/local ou VPS com volume**, não serverless
(Vercel) sem volume. Detalhes de deploy em [`DEPLOY.md`](../DEPLOY.md).

---

## Troubleshooting

**"model is not supported when using Codex with a ChatGPT account"**
O modelo não é aceito para conta ChatGPT. Use `gpt-5.5` (default). Nomes
`*-codex` só funcionam com API key da OpenAI, não com login do ChatGPT.

**Imagem via GPT demora muito**
É esperado (~47s). Para respostas rápidas, não use a palavra "gpt" no pedido —
vai pelo Imagen. Ou reverta `JARVIS_IMAGE_PROVIDER`.

**Login do ChatGPT termina no `chatgpt.com` em vez de conectar**
Garanta que não há `OPENAI_OAUTH_REDIRECT_URI`/`OPENAI_OAUTH_AUTHORIZE_URL`
customizados errados no `.env.local` — o código usa as constantes corretas do
Codex (`http://localhost:1455/auth/callback`, `.../oauth/authorize`).

**Sessão do ChatGPT expirada**
O token renova sozinho. Se falhar, reconecte em Configurações → Conexões →
ChatGPT → Reconectar (ou Desconectar e Conectar).

**`~/.codex/auth.json` não é lido pelo Codex CLI oficial**
O Jarvis grava no formato compatível (`{ OPENAI_API_KEY, tokens, last_refresh }`,
sem o campo `auth_mode`). Se um arquivo antigo tiver `"auth_mode": "Chatgpt"`,
reconecte pela interface para regravar.
