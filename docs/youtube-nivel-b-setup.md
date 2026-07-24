# YouTube Nível B — o que VOCÊ precisa fazer (OAuth do dono do canal)

O Nível A (já entregue) usa a service account e dá **dados públicos**: inscritos,
views, vídeos, likes, comentários. O **Nível B** usa a *YouTube Analytics API* e só
funciona com **autorização do dono do canal** — service account **não serve**,
porque a SA não é dona de nenhum canal.

Complementa `marketing-status.md`. Escrito em 2026-07-21.

---

## O que o Nível B destrava

| Métrica | Por que importa |
|---|---|
| **Watch time** (`estimatedMinutesWatched`) | é o que o algoritmo do YouTube premia — mais que views |
| **Retenção** (`averageViewPercentage`, `averageViewDuration`) | onde as pessoas largam o vídeo |
| **Inscritos ganhos/perdidos** (`subscribersGained/Lost`) | qual vídeo *converte* em inscrito (e qual espanta) |
| **Origem do tráfego** (`insightTrafficSourceType`) | busca do YouTube × sugeridos × externo × playlist |
| **Termos de busca** (`insightTrafficSourceDetail`) | o que as pessoas pesquisam e caem no canal |
| **Demografia** (`viewerPercentage` por idade/gênero) | público real do canal |
| **Receita** (`estimatedRevenue`) | se monetizado — exige escopo extra |

**Bônus:** resolve a limitação atual de "só os 25 vídeos mais recentes" — a Analytics
API reporta o **catálogo inteiro** dentro de um período.

---

## Passo a passo

### 1. Habilitar a API (2 min)
No projeto **`jarvis-498903`** (o mesmo do GA4/Vertex):

`https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com?project=jarvis-498903`

Clique em **Ativar**.

### 2. ⚠️ Configurar a tela de consentimento — FAÇA ANTES DE TENTAR CRIAR O CLIENTE

> **Pegadinha:** o Google **não deixa criar o ID do cliente OAuth** enquanto a tela de
> consentimento não estiver configurada — a opção aparece desabilitada/some. Além disso a
> interface mudou de nome/lugar: virou **"Google Auth Platform"**.

Abra `https://console.cloud.google.com/auth/overview?project=jarvis-498903` → **Começar**:
- **Informações do app**: nome `Jarvis`, e-mail de suporte `administrador@cppem.com.br`
- **Público-alvo**: ver tabela abaixo (decisão crítica)
- **Informações de contato** → aceitar política → **Criar**

*(No console antigo: **APIs e serviços → Tela de permissão OAuth**.)*

A escolha do público-alvo define se você vai precisar **reautorizar toda semana** ou não:

| Tipo | Quando usar | Consequência |
|---|---|---|
| **Interno** ✅ | Se o projeto GCP pertence à organização Google Workspace do `cppem.com.br` | **Sem verificação do Google, sem expiração.** Autoriza 1× e pronto. |
| **Externo + Teste** ⚠️ | Se não houver Workspace | Funciona, mas o **refresh token expira em 7 dias** → reautorizar toda semana |
| **Externo + Produção** | Alternativa ao acima | Exige **verificação do Google** (escopo sensível): formulário, vídeo demonstrativo, pode levar semanas |

> **Me diga qual aparece disponível para você.** Se "Interno" estiver habilitado, é o
> caminho — sem burocracia e sem reautorização.

Nos **escopos**, adicione:
- `https://www.googleapis.com/auth/yt-analytics.readonly` (obrigatório)
- `https://www.googleapis.com/auth/yt-analytics-monetary.readonly` (só se quiser **receita**)

### 3. Criar as credenciais OAuth (5 min)
**APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**
- Tipo: **Aplicativo da Web**
- Nome: `Jarvis — YouTube`
- **URIs de redirecionamento autorizados** (adicione os dois):
  - `http://localhost:3000/api/youtube/callback`
  - `http://162.243.194.122:3000/api/youtube/callback`
    *(troque pelo domínio final se/quando houver um)*

Isso gera **Client ID** e **Client Secret** → vão para o `.env` como
`YOUTUBE_CLIENT_ID` e `YOUTUBE_CLIENT_SECRET`. **Não cole o secret em chat/commit** —
me diga que criou e eu instruo onde colar no `.env.production` do servidor.

### 4. Confirmar quem é o dono dos canais
- Qual **conta Google** administra `@cppemconcursos` e `@colegiocppem`?
- Os canais são **Conta de Marca (Brand Account)**? (Comum em empresas.) Se sim, a conta
  que autorizar precisa ser **Proprietária ou Gerente** da conta de marca — na tela de
  consentimento o Google pergunta **qual canal** você está autorizando.
- ⚠️ **Cada canal precisa da sua própria autorização** (uma para CPPEM, outra para o Colégio),
  a menos que a mesma conta administre os dois e o Google permita selecionar ambos.

### 5. Autorizar dentro do Jarvis (depois que eu implementar)
Vou criar um botão **"Conectar YouTube"** em *Configurações → Conexões* (mesmo padrão do
Notion/Conta Azul). Você clica, escolhe o canal, aceita — e o `refresh_token` fica
guardado no banco com RLS service-role. Feito 1×, o sync passa a puxar os dados sozinho.

---

## Resumo do que eu preciso de você

- [ ] **1.** Ativar a *YouTube Analytics API* no projeto `jarvis-498903`
- [ ] **2.** Me dizer se a tela de consentimento pode ser **Interno** (Workspace do cppem.com.br) ou só **Externo**
- [ ] **3.** Criar o **ID do cliente OAuth** (Aplicativo da Web) com os redirects acima
- [ ] **4.** Me confirmar a conta dona dos canais e se são Conta de Marca
- [ ] **5.** Depois de eu implementar: clicar em **Conectar YouTube** e autorizar cada canal

**Esforço do meu lado:** MÉDIO — fluxo OAuth (start/callback), tabela de conexões com
refresh de token, queries da Analytics API e os cards. A infraestrutura de OAuth já
existe no projeto (Notion, Conta Azul), então é reaproveitamento, não algo do zero.
