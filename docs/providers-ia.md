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

---

# Como o "sem API key" funciona por dentro

As três seções abaixo explicam o **mecanismo** de cada provider, não o uso.
Escritas em 2026-08-07.

Os três resolvem o mesmo problema — autenticar sem pagar por requisição — de
**três formas diferentes**, porque as três empresas expõem coisas diferentes:

| Provider | Estratégia | Credencial | Quem paga |
|---|---|---|---|
| **Claude** | dirige o **binário do CLI** por subprocess | sessão do `claude login` | assinatura Pro/Max |
| **GPT** | fala **HTTP direto** com o backend do Codex | login do ChatGPT | assinatura ChatGPT |
| **Gemini** | assina um **JWT** e troca por access token | service account | projeto Google Cloud |

---

## 1 · GPT (Codex OAuth) — HTTP direto

### A ideia central

Uma API key é uma credencial de **cobrança por requisição**. O login do ChatGPT é
uma credencial de **assinatura**. O backend do Codex aceita as duas — e o Jarvis
usa a segunda.

Na prática: em vez de `Authorization: Bearer sk-proj-…` (API key), a requisição
vai com `Authorization: Bearer <access_token do seu login>`. O endpoint é o mesmo
que o **Codex CLI oficial** usa, e o token é lido do **mesmo arquivo** que ele
grava. O Jarvis não spawna o CLI — fala HTTP direto (`lib/ai/codex.ts`), o que o
faz rodar em qualquer host, inclusive container sem o binário instalado.

O código ainda **remove `OPENAI_API_KEY` do ambiente** para garantir que nenhuma
biblioteca a use por engano e gere cobrança silenciosa.

### O fluxo de login (OAuth PKCE)

Dois caminhos, escolhidos pelo lugar onde o navegador roda:

**Loopback (dev local)** — `lib/ai/codex-loopback.ts`. O Jarvis sobe um servidor
HTTP em `127.0.0.1:1455`, abre a tela de autorização da OpenAI e **captura o
redirect sozinho**. É exatamente o que o Codex CLI faz. Só funciona quando o
navegador e o servidor estão na mesma máquina.

**Device Auth (VPS)** — `app/api/providers/openai/device-start` e `device-poll`.
O servidor pede um código, mostra na tela, você digita no navegador de onde
estiver, e o servidor fica consultando até você autorizar. É o caminho para
produção, porque em VPS o `localhost:1455` apontaria para a SUA máquina, não
para o servidor.

Nos dois, o PKCE é S256: o `code_verifier` fica num **cookie httpOnly de 10
minutos**, junto de um `state` anti-CSRF. Nada disso encosta no banco.

Conectar/desconectar exige a permissão `conhecimento:gerenciar` — é uma conexão
da empresa, mesmo tratamento do Notion.

### Onde o token vive

`~/.codex/auth.json` — o mesmo arquivo do Codex CLI, no formato dele
(`{ OPENAI_API_KEY, tokens, last_refresh }`). Respeita `CODEX_HOME`.

**Não vai para `.env` nem para o banco.** A consequência prática é que o GPT só
funciona onde o processo tem disco persistente: local ou VPS **com volume
montado**. Em serverless sem volume, não funciona — e é por isso que o
`jarvis.stack.yml` monta `~/.codex`.

### O `chatgpt-account-id`

O backend Codex exige um header com a conta. Ele não vem em campo separado: o
Jarvis **decodifica o JWT do access_token** e lê a claim `chatgpt_account_id`
(`accountIdFromToken`, em `codex-auth.ts`). Se o arquivo já trouxer `account_id`,
esse tem precedência.

### Os headers que fazem funcionar

```
Authorization: Bearer <access_token>
Accept: text/event-stream
OpenAI-Beta: responses=experimental
originator: codex_cli_rs
chatgpt-account-id: <da claim do JWT>
session_id: <uuid por requisição>
```

O `originator: codex_cli_rs` é o que identifica o cliente como o Codex CLI. Sem
ele o backend recusa.

### Renovação do token

Transparente. Antes de cada chamada o token é validado; perto de expirar, o
`refresh_token` renova e o arquivo é regravado.

Há ainda uma **segunda tentativa**: se a requisição voltar **401** (token
revogado na borda, que a checagem local não pega), o cliente faz um refresh e
repete a chamada uma vez. Só então desiste.

### Por que só `gpt-5.5`

Modelos com sufixo `-codex` (`gpt-5-codex`) são recusados com _"model is not
supported when using Codex with a ChatGPT account"_. Eles existem só para quem
paga por API key. Com login de assinatura, o aceito é `gpt-5.5`.

### Como se encaixa no chat

`streamCodexText` emite os **mesmos `ClaudeChunk`** (`text` | `status`) que o
bridge do Claude. Foi de propósito: todo o streaming, a persistência e o feedback
"pensando…" da UI são reaproveitados sem um ramo novo.

Se o Codex falhar **antes de emitir texto**, lança `CodexError`/`CodexAuthError`
e o chamador cai no Gemini. Depois que o texto começou, não há fallback — trocar
de motor no meio da resposta produziria um texto costurado de dois autores.

### Mapa dos arquivos

| Arquivo | Papel |
|---|---|
| `lib/ai/codex.ts` | cliente HTTP do `/responses`, streaming e retry no 401 |
| `lib/ai/codex-auth.ts` | lê, grava e renova o `auth.json`; extrai o account_id do JWT |
| `lib/ai/codex-oauth.ts` | PKCE, state, cookies e o gate de permissão |
| `lib/ai/codex-loopback.ts` | servidor `127.0.0.1:1455` que captura o redirect |
| `lib/ai/codex-image.ts` | imagem pela ferramenta `image_generation` (incerto, cai no Imagen) |
| `app/api/providers/openai/*` | rotas: login-start, auth-start, auth-complete, device-start, device-poll, status, logout |

### O que pode quebrar

**A OpenAI mudar o endpoint ou o `originator`.** É uma API não pública, usada
por engenharia reversa do CLI oficial. Não há contrato de estabilidade — se um
dia parar, o sintoma será 4xx em toda chamada, e a correção é acompanhar o que o
Codex CLI passou a enviar.

**O volume do `~/.codex` sumir.** Perde o login; reconecta pela interface.

---

## 2 · Claude (CLI) — bridge por subprocess

### A ideia central

Aqui **não há requisição HTTP nossa**. O Jarvis executa o binário do **Claude
Code CLI** como subprocesso, em modo `--print` (não-interativo) com saída
`stream-json`, e lê o stdout linha a linha.

O truque está numa regra do próprio CLI: **quando ele não encontra
`ANTHROPIC_API_KEY` no ambiente, cai automaticamente nas credenciais do
`claude login`** — o token OAuth da conta Pro/Max, em
`~/.claude/.credentials.json`.

Ou seja, o "sem API key" aqui é literal: a ausência da variável é o que ativa o
caminho da assinatura.

### O ambiente é montado do zero

`buildCleanEnv()` **não repassa `process.env` inteiro**. Monta um ambiente novo
só com as variáveis de sistema necessárias e, por cima, apaga explicitamente:

```
delete env.ANTHROPIC_API_KEY
delete env.ANTHROPIC_AUTH_TOKEN
```

Blindagem dupla: se alguém puser uma chave no `.env` por engano, ela não chega ao
CLI e não vira cobrança.

### O isolamento (a parte que mais importa)

O CLI é um **agente**, e um agente solto no repositório seria um risco. O bridge
o encaixota:

- **`cwd` num diretório temporário vazio** (`mkdtemp`) — sem `CLAUDE.md`, sem
  repositório, sem nada para ele explorar. Os anexos são gravados justamente ali.
- **`--strict-mcp-config`** — ignora TODOS os servidores MCP globais do usuário
  (Google Drive, Notion, n8n). Essas ferramentas não entram no chat.
- **Ferramentas agênticas desligadas** — `Bash`, `Write`, `Edit`, `Glob` e
  companhia entram na lista de negadas. Queremos um chat de texto, não um agente
  mexendo em arquivo e rede.
- **Exceção deliberada:** quando há anexo, o `Read` é liberado **confinado ao
  workspace** (`--allowedTools "Read(./**)"`). É o que permite ao modelo abrir a
  imagem ou o PDF — e só eles.

### Onde o token vive

`~/.claude/.credentials.json`, gravado pelo `claude login`. Como o GPT, é
**arquivo em disco**: exige volume no Docker e não funciona em serverless.

### O que pode quebrar

**O binário `claude` não estar no PATH.** O resolvedor procura com
`command -v` / `where` e cacheia por processo; no Windows prefere o shim `.cmd`.
Não achando, tenta `"claude"` e falha na hora do spawn.

**A sessão expirar.** Só reconectando com `claude login` no host.

---

## 3 · Gemini (Vertex) — JWT assinado

### A ideia central

Aqui não há login de usuário nenhum: a credencial é uma **service account**, e a
autenticação é o fluxo padrão do Google — assinar um JWT com a chave privada e
trocá-lo por um access token de curta duração.

`lib/google/auth.ts` faz isso em ~40 linhas, sem SDK:

1. monta o cabeçalho `{alg: RS256, typ: JWT}` e o payload com `iss` (o e-mail da
   service account), `scope`, `aud` (o endpoint de token), `iat` e `exp`;
2. assina com `createSign("RSA-SHA256")` usando a `private_key`;
3. troca no `oauth2.googleapis.com/token` com
   `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`.

### Um helper, várias APIs

A função é **genérica por escopo** — a mesma serve para tudo que é Google:

```
analytics.readonly        → GA4
cloud-platform            → Vertex (Gemini, Imagen, embeddings)
yt-analytics.readonly     → YouTube (nível B)
```

O token é **cacheado por escopo em memória**, renovado 1 minuto antes de expirar.
Escopos diferentes não disputam a mesma entrada.

### Onde a credencial vive

**Em variável de ambiente** (`GOOGLE_SERVICE_ACCOUNT_JSON`, o JSON numa linha) —
diferente dos outros dois. Isso é o que permite ao Gemini funcionar em qualquer
lugar, inclusive serverless: não depende de disco.

Em compensação, é a credencial mais sensível dos três: um arquivo vazado dá
acesso a GA4, Vertex e YouTube de uma vez.

### O que pode quebrar

**Cobrança do projeto suspensa.** Já aconteceu aqui: o `jarvis-498903` ficou
bloqueado e a memória evolutiva parou de gerar embeddings.

**Permissão faltando na service account.** Cada API precisa do papel dela — ser
Leitor no GA4 não dá acesso ao Vertex.
