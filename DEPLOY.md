# Deploy do Jarvis — VPS com Docker Swarm + Portainer

Guia para publicar o Jarvis e usar os 3 providers de IA **sem API key**.

## Como cada provider autentica (importante)

Os 3 rodam no **mesmo container** (é o app Next), mas o login de cada um é diferente:

| Provider | Como loga (sem API key) | O que o container precisa | Login 1x |
|---|---|---|---|
| **Gemini** (Vertex) | Service account JSON na env `GOOGLE_SERVICE_ACCOUNT_JSON` | Nada além da env var | — (já pronto) |
| **GPT** (Codex) | Token OAuth em `/root/.codex/auth.json` | Volume `jarvis_codex_auth` | Pela UI (abaixo) |
| **Claude** (CLI) | Binário `claude` + sessão em `/root/.claude` | Volume `jarvis_claude_auth` (binário já vem na imagem) | `claude login` (abaixo) |

Os tokens **persistem nos volumes** → sobrevivem a redeploys. Como o volume é local por nó, o stack roda **1 réplica fixada num nó** (`jarvis.stack.yml`). Não escale para 2+ réplicas sem migrar o token do GPT para o Supabase.

---

## 1. Build da imagem

As variáveis `NEXT_PUBLIC_*` são **inlinadas no build** (vão no bundle do cliente), então passam como `--build-arg`:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="https://SEU-REF.supabase.co" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..." \
  --build-arg NEXT_PUBLIC_BASE_URL="https://jarvis.suaempresa.com" \
  --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY="..." \
  -t jarvis:latest .
```

Se usa registry privado, `docker tag jarvis:latest registry.suaempresa.com/jarvis:1.0 && docker push ...` e ajuste `JARVIS_IMAGE` no stack.

> Faça o build **no nó** onde o stack vai rodar (ou num registry acessível ao Swarm). Sem registry, a imagem precisa existir localmente no nó fixado.

## 2. Variáveis de ambiente

Copie `.env.production.example` e preencha. No Portainer, cole os pares na seção **Environment variables** do stack (ou aponte um `.env`). Pontos de atenção:

- `GOOGLE_SERVICE_ACCOUNT_JSON` = o JSON da service account em **uma única linha**.
- `OPENAI_OAUTH_*` e `OPENAI_CODEX_RESPONSES_URL` = os mesmos valores do seu `.env.local` de dev.
- **Não** coloque `ANTHROPIC_API_KEY` nem `OPENAI_API_KEY` — os providers OAuth devem rodar sem elas.

## 3. Deploy do stack

No Portainer: **Stacks → Add stack**, cole o `jarvis.stack.yml`, preencha as variáveis e **Deploy**. Ou via CLI:

```bash
docker stack deploy -c jarvis.stack.yml jarvis
```

Ajuste a constraint de placement em `jarvis.stack.yml` (`node.role == manager` ou `node.hostname == SEU_NO`).

## 4. Logins de uma vez (pós-deploy)

### Gemini — nada a fazer
Funciona assim que `GOOGLE_SERVICE_ACCOUNT_JSON` está setada.

### GPT (ChatGPT / Codex) — pela interface
1. Acesse o Jarvis → **Configurações → Conexões → ChatGPT (GPT)**.
2. **Conectar ChatGPT** → abre o login da OpenAI no seu navegador.
3. Após autorizar, o navegador tenta abrir um endereço `localhost:1455/...` (vai dar "não conecta" — normal). **Copie a URL completa** dessa página e **cole** no modal → **Concluir login**.
4. Pronto: o token vai para `/root/.codex/auth.json` (volume) e o card mostra a conta.

> Alternativa: **"Usar código do dispositivo"** — mostra um código para digitar em `auth.openai.com/codex/device`.

### Claude — `claude login` dentro do container
```bash
# descobre o container da task e faz o login interativo
docker exec -it $(docker ps -q -f name=jarvis_jarvis) claude login
```
Siga o fluxo (abre URL / cola código). As credenciais vão para `/root/.claude` (volume) e persistem.

## 5. Atualizações e manutenção

- **Redeploy** (nova imagem): os logins **persistem** (estão nos volumes). Basta atualizar a imagem e re-deployar.
- **Trocar o provider principal**: mude `JARVIS_DEFAULT_PROVIDER` (`claude`/`codex`/`gemini`) e re-deploy.
- **Refazer um login**: pela UI (GPT: Desconectar → Conectar) ou `docker exec ... claude login`. Para zerar o GPT na unha: `docker exec ... rm /root/.codex/auth.json`.
- **Backup dos logins**: os volumes `jarvis_codex_auth` e `jarvis_claude_auth`.

## 6. Domínio / TLS

Ponha um reverse proxy (Traefik/nginx) na frente da porta `3000` para o domínio + HTTPS. Garanta que `NEXT_PUBLIC_BASE_URL` e os `*_REDIRECT_URI` (Notion) usem a URL pública. O login do GPT **não** precisa de porta pública (é paste-back), então funciona atrás do proxy sem exposição extra.

---

### Termos de uso
Usar assinaturas de consumidor (ChatGPT Plus / Claude Pro-Max) como backend de um produto multiempresa pode conflitar com os ToS desses serviços. Decisão do responsável pelo projeto.
