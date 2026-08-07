# GPT no Jarvis — login do ChatGPT, sem API key

Documento dedicado ao provider **GPT**. A visão comparativa dos três motores
(Claude, GPT, Gemini) está em [`providers-ia.md`](./providers-ia.md); aqui é só
o GPT, em profundidade.

Escrito em 2026-08-07.

---

## O que é, em uma frase

O Jarvis conversa com o **backend do Codex** — o mesmo que o Codex CLI oficial
usa — autenticado pelo **seu login do ChatGPT**, e não por uma API key.

A conta é debitada da **assinatura ChatGPT** (Plus/Pro/Business). Não há custo
por token, nem `OPENAI_API_KEY` em lugar nenhum.

---

## Por que isso funciona

Uma API key e um login são credenciais **diferentes para o mesmo backend**:

| | API key | Login do ChatGPT |
|---|---|---|
| Formato | `sk-proj-…` | `access_token` OAuth (JWT) |
| Cobrança | por requisição | assinatura mensal |
| Modelos | inclui `*-codex` | só `gpt-5.5` |
| Onde vive | variável de ambiente | `~/.codex/auth.json` |

O endpoint `/responses` aceita as duas. O Jarvis manda a segunda:

```
Authorization: Bearer <access_token do seu login>
```

E vai além: **remove `OPENAI_API_KEY` do ambiente**, para que nenhuma biblioteca
a pegue por engano e gere cobrança silenciosa.

> **Diferença importante para o Claude.** O provider do Claude é um *bridge de
> CLI* — spawna o binário. O do GPT é **HTTP direto**. Não precisa do Codex CLI
> instalado no servidor, só do arquivo de token. Por isso roda em container
> enxuto.

---

## O fluxo de login

Dois caminhos. A escolha depende de **onde o navegador roda** em relação ao
servidor.

### Loopback — desenvolvimento local

`lib/ai/codex-loopback.ts`

1. O Jarvis sobe um servidor HTTP em `127.0.0.1:1455`.
2. Abre a tela de autorização da OpenAI no navegador.
3. Você loga e autoriza.
4. A OpenAI redireciona para `http://localhost:1455/auth/callback`.
5. O servidor local **captura o código sozinho** e troca por tokens.

É exatamente o que o Codex CLI oficial faz. Você não copia nada.

**Só funciona se navegador e servidor estiverem na mesma máquina.** Num VPS,
`localhost:1455` aponta para o SEU laptop, não para o servidor — e o login
morre no ar.

> Detalhe de implementação: o estado pendente (servidor + PKCE) vive em
> `globalThis`, não numa variável de módulo. No dev do Next os módulos recarregam
> a quente enquanto o servidor HTTP continua vivo — numa variável comum, o
> callback cairia numa instância nova e não acharia o `pending`.

### Device Auth — produção (VPS)

Rotas `device-start` → `device-poll`.

1. O servidor pede um código à OpenAI.
2. A tela mostra o código e a URL.
3. Você abre no navegador **de onde estiver** e autoriza.
4. O servidor fica consultando (`poll`) até a autorização aparecer.

É o caminho para produção, e o que está disponível no card como **"Usar código
do dispositivo"**.

### PKCE nos dois

O `code_verifier` (S256) e o `state` anti-CSRF ficam em **cookies httpOnly de 10
minutos** (`FLOW_COOKIE_MAX_AGE`). Nada disso vai para o banco.

Conectar e desconectar exigem a permissão **`conhecimento:gerenciar`** — é uma
conexão da empresa, mesmo tratamento do Notion e do Conta Azul.

---

## O arquivo de token

`~/.codex/auth.json` — o **mesmo arquivo** que o Codex CLI usa. Respeita
`CODEX_HOME`, e há o override `CODEX_AUTH_JSON_PATH`.

Formato gravado:

```json
{
  "OPENAI_API_KEY": null,
  "tokens": {
    "access_token": "...",
    "refresh_token": "...",
    "id_token": "...",
    "account_id": "..."
  },
  "last_refresh": "2026-08-07T..."
}
```

**Não gravamos `auth_mode`.** O Codex CLI atual rejeita `"Chatgpt"` (espera
minúsculo) e infere o modo ChatGPT pela ausência de API key somada à presença de
tokens. Na leitura aceitamos os dois formatos — o do CLI e o legado do
evo-nexus/OpenClaude — para não quebrar arquivos antigos.

**Nada disso encosta em `.env` ou banco.** A consequência prática: o GPT só
funciona onde o processo tem **disco persistente**. Local, ou VPS com volume
montado. Em serverless sem volume, não funciona — e é por isso que o
`jarvis.stack.yml` monta `~/.codex`.

---

## O `chatgpt-account-id`

O backend exige um header identificando a conta. Ele **não vem num campo
separado** da resposta de token.

A solução (`accountIdFromToken`, em `codex-auth.ts`): **decodificar o JWT do
`access_token`** e ler a claim custom `chatgpt_account_id`. Se o arquivo já
trouxer `account_id`, esse tem precedência.

---

## A requisição

### Headers

```
Authorization:       Bearer <access_token>
Content-Type:        application/json
Accept:              text/event-stream
OpenAI-Beta:         responses=experimental
originator:          codex_cli_rs
chatgpt-account-id:  <da claim do JWT>
session_id:          <uuid novo por requisição>
```

O **`originator: codex_cli_rs`** é o que identifica o cliente como sendo o Codex
CLI. Sem ele o backend recusa.

### Corpo

```jsonc
{
  "model": "gpt-5.5",
  "instructions": "<system prompt>",
  "input": [{ "type": "message", "role": "user", "content": [...] }],
  "tools": [],                    // sem ferramentas: é chat de texto
  "tool_choice": "auto",
  "parallel_tool_calls": false,
  "reasoning": { "effort": "medium", "summary": "auto" },
  "store": false,                 // a OpenAI não guarda o turno
  "stream": true,
  "include": ["reasoning.encrypted_content"],
  "prompt_cache_key": "<uuid>"
}
```

`store: false` é deliberado — o histórico é nosso, no Supabase.

**Imagens** entram como `input_image` com data URL no mesmo `content`. (PDF
**não** vai por aqui: esse caminho é do Claude, que grava o arquivo e o abre com
o Read. Ver `docs/` do chat.)

### Resposta (SSE)

O parser quebra o stream em eventos por `\n\n` (tolera `\r\n\r\n`) e lê o JSON de
cada linha `data:`, ignorando `[DONE]` e linhas não-JSON.

Eventos tratados:

| Evento | O que fazemos |
|---|---|
| `response.output_text.delta` | emite o texto (`ClaudeChunk` do tipo `text`) |
| `response.reasoning_summary_text.delta` | primeira vez → status **"Pensando…"** |
| `response.reasoning_text.delta` | idem |
| `response.failed` / `error` | erro — ver a regra abaixo |
| `response.completed` | encerra |

---

## Erros e fallback

A regra de ouro: **o ponto sem volta é o primeiro caractere de texto.**

**Falhou ANTES de emitir texto** → lança `CodexError` / `CodexAuthError`, e o
chamador cai no Gemini. O usuário recebe uma resposta, de outro motor.

**Falhou DEPOIS** → encerra o stream onde está, sem trocar de motor. Costurar
duas respostas de autores diferentes produziria um texto incoerente, e o usuário
não teria como saber onde um terminou e o outro começou.

Terminar sem nenhum texto também é erro (`"GPT terminou sem resposta."`) — silêncio
não é resposta.

### O retry do 401

Antes de cada chamada o token é validado localmente. Mas um token **revogado na
borda** passa nessa checagem e só falha no servidor.

Por isso: se a resposta vier **401**, o cliente faz um refresh e **repete a
chamada uma vez**. Só então desiste.

### Timeout

120 s por padrão, combinado com o `AbortSignal` do chamador num único controller.

---

## Modelos

**Use `gpt-5.5`.** É o default e o único aceito para conta ChatGPT.

Nomes com sufixo `-codex` (`gpt-5-codex`, etc.) são recusados com:

> _model is not supported when using Codex with a ChatGPT account_

Eles existem só para quem paga por API key.

```
OPENAI_CODEX_MODEL=gpt-5.5        # default
OPENAI_CODEX_REASONING=medium     # effort do raciocínio
```

---

## Imagem pelo GPT

`lib/ai/codex-image.ts` — usa a ferramenta nativa `image_generation` da Responses
API, com o mesmo token e endpoint do texto.

**É incerto por natureza:** o backend do Codex é focado em código e pode não
expor essa ferramenta. Por isso `lib/ai/image.ts` trata falha aqui como sinal
para cair no **Imagen/Vertex**.

Na prática é bem mais lento (~47 s contra alguns segundos do Imagen), então o
padrão é o Imagen e o GPT entra **sob demanda**, quando o pedido menciona "gpt".
Ver a seção de imagem em `providers-ia.md`.

```
OPENAI_CODEX_IMAGE_MODEL=gpt-5.5
OPENAI_CODEX_IMAGE_SIZE=1024x1024
```

---

## Configuração

```bash
# Tornar o GPT o provider de texto principal (padrão é claude)
JARVIS_DEFAULT_PROVIDER=codex

# Endpoint e identificação do cliente
OPENAI_CODEX_RESPONSES_URL=https://chatgpt.com/backend-api/codex/responses
OPENAI_OAUTH_ORIGINATOR=codex_cli_rs

# Modelo e raciocínio
OPENAI_CODEX_MODEL=gpt-5.5
OPENAI_CODEX_REASONING=medium
```

As URLs do fluxo OAuth já têm defaults corretos no código. **Não** defina
`OPENAI_API_KEY`.

---

## Mapa dos arquivos

| Arquivo | Papel |
|---|---|
| `lib/ai/codex.ts` | cliente HTTP do `/responses`, SSE, retry no 401, fallback |
| `lib/ai/codex-auth.ts` | lê/grava/renova o `auth.json`; extrai o account_id do JWT |
| `lib/ai/codex-oauth.ts` | PKCE, state, cookies, gate de permissão |
| `lib/ai/codex-loopback.ts` | servidor `127.0.0.1:1455` que captura o redirect |
| `lib/ai/codex-image.ts` | geração de imagem (incerta, cai no Imagen) |
| `app/api/providers/openai/login-start` | inicia o loopback |
| `app/api/providers/openai/auth-start` | monta a URL de autorização (PKCE) |
| `app/api/providers/openai/auth-complete` | troca o code por tokens |
| `app/api/providers/openai/device-start` | pede o código de dispositivo |
| `app/api/providers/openai/device-poll` | consulta até autorizar |
| `app/api/providers/openai/status` | se está conectado (para a UI) |
| `app/api/providers/openai/logout` | apaga o `auth.json` |

---

## Troubleshooting

**"model is not supported when using Codex with a ChatGPT account"**
Modelo errado. Use `gpt-5.5`.

**O login termina no `chatgpt.com` em vez de conectar**
Há `OPENAI_OAUTH_REDIRECT_URI` ou `OPENAI_OAUTH_AUTHORIZE_URL` customizados e
errados no `.env`. Remova — o código usa as constantes corretas do Codex.

**Login não conecta no servidor**
Loopback não funciona remotamente. Use **"Usar código do dispositivo"**.

**Sessão expirada**
O token renova sozinho. Se o `refresh_token` foi revogado, reconecte em
**Configurações → Conexões → ChatGPT**.

**O Codex CLI oficial não lê nosso `auth.json`**
Arquivo antigo com `"auth_mode": "Chatgpt"`. Reconecte pela interface para
regravar no formato atual.

**Perdeu o login após deploy**
O volume do `~/.codex` não está montado. Ver `DEPLOY.md`.

---

## O risco que vale registrar

**Este é um endpoint não público**, mapeado a partir do comportamento do Codex
CLI. Não há contrato de estabilidade nem versionamento anunciado.

Se a OpenAI mudar o endpoint, o `originator` ou o formato dos eventos, o sintoma
será **4xx em toda chamada** ou stream que não produz texto. A correção é
observar o que o Codex CLI passou a enviar e alinhar.

Enquanto isso, o desenho já protege: falha antes do primeiro texto cai no Gemini,
então uma quebra do Codex degrada o chat em vez de derrubá-lo.
