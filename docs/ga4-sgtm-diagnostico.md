# GA4 parado — diagnóstico e conserto (passo a passo)

Escrito em 2026-08-11. **O conserto é no Google Tag Manager, não no Jarvis** — o
Jarvis só *lê* o GA4; se o GA4 não recebe dado, não há nada a mudar no nosso lado.

Este guia é para quem administra o GTM / o servidor de tagging.

---

## O sintoma

| | |
|---|---|
| Último dia com dado | **29/07/2026** |
| Sessões em agosto | **0** |
| Usuários em tempo real | **0** |
| Eventos nos últimos 7 dias | **0** |
| Dias com dado na vida da propriedade | **12** (16 a 29/07) |

Parou **de uma vez**, não foi definhando. Isso é cara de mudança de configuração,
não de queda de tráfego.

---

## O que JÁ foi verificado — não refaça

Tudo abaixo foi testado por HTTP em 2026-08-11 e está **correto**:

| Camada | Como foi testado | Resultado |
|---|---|---|
| Auth do Jarvis no GA4 | token do service account + `runReport` | ✅ responde |
| Propriedade e fluxo de dados | Admin API `dataStreams` | ✅ `G-HZE53T0J6P` → `cppem.com.br` |
| Servidor de tagging no ar | `GET /healthz` | ✅ `ok` |
| Loader carrega no site | `GET /metrics/` | ✅ 200, 369 KB |
| Tag do GA4 existe no container web | busca por `__googtag` no `gtm.js` | ✅ presente |
| A tag NÃO está pausada | busca por `__paused` | ✅ só 3 tags HTML pausadas |
| Destino dos hits | macro `server_container_url` | ✅ `https://sgtm.cppem.com.br` |

Ou seja: **o navegador carrega o GTM, a tag do GA4 existe e aponta para o servidor
certo.** O problema está depois disso.

---

## A pista mais forte

Mapeando quais endpoints o servidor atende:

| Endpoint | Quem atende | Resultado |
|---|---|---|
| `/gtm.js?id=GTM-PJ379FLQ` | cliente **GTM Web Container** | ✅ 200 |
| `/metrics/` | mesmo cliente (custom loader) | ✅ 200 |
| `/healthz` | o próprio servidor | ✅ 200 |
| `/gtag/js?id=G-HZE53T0J6P` | cliente **GA4** | ❌ **400** |
| `/g/collect?v=2&tid=…` | cliente **GA4** | ❌ **400** |

Em GTM server-side, cada endpoint é atendido por um **Cliente** dentro do container
do servidor. O cliente que serve o container web está funcionando. **Os dois
endpoints que pertencem ao cliente do GA4 recusam.**

`/gtag/js` é o mais revelador: ele só precisa do `id=`, que eu mandei. Um 400 ali
sugere que **não há cliente GA4 habilitado no container do servidor** — os hits
chegam e ninguém os reivindica.

> ⚠️ Isso é hipótese forte, não prova. Um 400 pode ter outras causas. Os passos
> abaixo confirmam ou descartam em minutos.

---

## ATUALIZAÇÃO — hit real capturado (2026-08-11)

O requisitante capturou uma requisição real no DevTools. Ela **derruba a hipótese
principal** e traz três fatos novos.

**O que o hit prova:** o navegador **está** enviando para o servidor.

```
POST https://sgtm.cppem.com.br/g/collect?v=2&tid=G-HZE53T0J6P&…&en=user_engagement
origin:  https://contato.cppem.com.br
cookie:  _ga_HZE53T0J6P=GS2.1.s1786476799$o57$…   ← 57 sessões neste navegador
         _ga_T8DW11X6XE=GS2.1.s…$o6$…             ← OUTRA propriedade GA4
parâmetros sst.* presentes                        ← passou pelo tagging server
```

Ou seja: a tag dispara, o `tid` é o certo, o destino é o certo e o hit sai. O
problema está **entre o servidor e o Google** — ou numa regra do próprio GA4.

### Fato novo 1 · O domínio nunca apareceu na propriedade

O hit vem de `contato.cppem.com.br`. Consultando os domínios que a propriedade
545839732 já registrou em 2026:

| Domínio | Sessões |
|---|---|
| pmpe.cppem.com.br | 269 |
| cppem.com.br | 215 |
| captura.cppem.com.br | 20 |
| aniversario.colegio.cppem.com.br | 10 |
| captura.unicive.cppem.com.br | 6 |
| bonus.cppem.com.br | 4 |
| unicive.cppem.com.br | 2 |
| colegio.cppem.com.br | 1 |
| contato.unicive.cppem.com.br | 1 |

**`contato.cppem.com.br` não está na lista.** Nunca entrou nada dele. O último
registro de qualquer domínio é 29/07.

### Fato novo 2 · Existe outra propriedade GA4

O cookie `_ga_T8DW11X6XE` mostra um segundo Measurement ID ativo no mesmo
navegador. O service account do Jarvis só enxerga **uma** propriedade
(`545839732 · "Analytics"`, conta "GM Educação") — a outra existe e não foi
compartilhada. Vale confirmar qual delas é a oficial do site.

### Fato novo 3 · Consentimento sem estado definido

O hit traz `gcs=G1--` e `npa=1`. O `--` significa que nem `ad_storage` nem
`analytics_storage` têm estado declarado. Combina com o site não ter CMP nenhum.
Não é prova de bloqueio — mas é a única anomalia visível nos parâmetros.

### ⚠️ Risco à parte: PII em texto puro no hit

O mesmo hit carrega dados pessoais **sem hash**:

```
ep.user_data.email=pedagogico@cppem.com.br
ep.user_data.phone_number=+5581999967444
ep.user_data.address.first_name / last_name / city / region / postal_code
```

Mandar isso em texto puro **para o servidor de vocês** é o desenho normal de
*enhanced conversions* — o servidor hasheia antes de repassar. **O problema seria
o servidor repassar assim para o GA4:** a política do Google proíbe PII em
parâmetros de evento, e propriedade flagrada pode ter dado descartado ou apagado.

Não dá para verificar de fora se o servidor hasheia. **Confira** no container do
servidor se a tag GA4 remove `user_data` antes de encaminhar. Isso é independente
do problema da coleta, e mais grave a longo prazo.

---

## 🎯 DIAGNÓSTICO FECHADO (2026-08-11)

Com os códigos de resposta em mãos, o ponto exato da quebra está isolado.

### As três requisições

| # | Destino | Evento | Status |
|---|---|---|---|
| 1 | `www.google.com/ccm/collect` · `tid=AW-17332184690` | `page_view` | **200** ✅ |
| 2 | `www.google.com/ccm/collect` · `tid=AW-17332184690` | `page_view` | **200** ✅ |
| 3 | `sgtm.cppem.com.br/g/collect` · `tid=G-HZE53T0J6P` | `PageView_Cppem` | **200** ✅ |

A #3 é a do GA4, e a resposta dela é conclusiva:

```
Código de status  200 OK
set-cookie        FPID=FPID2.3.…; Domain=cppem.com.br; Secure; HttpOnly
access-control-allow-origin  https://contato.cppem.com.br
```

**O servidor aceitou o hit e devolveu o cookie FPID** — comportamento de um
cliente GA4 funcionando. Isso **mata em definitivo** a hipótese de "não há cliente
GA4 no container do servidor". Há, e ele reivindicou a requisição.

### Onde exatamente quebra

```
navegador  →  sgtm.cppem.com.br     ✅ 200, com FPID
sgtm       →  Google Analytics      ❌ nada chega (0 eventos em 7 dias)
navegador  →  Google Ads            ✅ 200 (AW-17332184690 funciona)
```

**A quebra é DENTRO do container do servidor:** o cliente recebe, nenhuma tag
encaminha para o GA4. Por isso não há erro visível em lugar nenhum — do ponto de
vista do navegador tudo respondeu 200.

Repare que o **Google Ads continua funcionando**, indo direto para
`www.google.com`. Só o GA4, que depende do encaminhamento pelo servidor, morreu.
Isso explica por que ninguém notou: as campanhas seguiam medindo conversão.

### O suspeito número 1: nome de evento customizado

O evento da #3 é **`PageView_Cppem`**, não `page_view`.

Consultando a propriedade, os eventos já registrados em 2026 são apenas
`page_view`, `session_start`, `first_visit`, `user_engagement` e `page_test`.
**`PageView_Cppem` nunca apareceu — nenhuma vez.**

Se a tag GA4 do container do servidor tiver gatilho filtrado por nome de evento, e
alguém renomeou os eventos para o padrão `PageView_Cppem`, a tag **para de disparar
em silêncio**. Encaixa com o corte seco em 29/07.

---

## ⚠️ ANTES DE TUDO — talvez a propriedade esteja errada

O requisitante afirma que **"tudo recebe no GA4 normalmente"** e que o GTM funciona
em todos os sites. Isso e a propriedade zerada só podem ser verdade ao mesmo tempo
de um jeito: **vocês olham uma propriedade, o Jarvis lê outra.**

As datas sustentam isso:

| | |
|---|---|
| Propriedade `545839732` **criada** | 2026-07-16 |
| Primeiro dia com dado | 2026-07-16 |
| Último dia com dado | 2026-07-29 |
| Jarvis ligado nela (commit `a60c535`) | 2026-07-21 |

A propriedade que o Jarvis lê **nasceu em 16/07 e coletou por 13 dias**. Nome
genérico ("Analytics"), um único fluxo. Não é a propriedade histórica de uma
empresa que roda campanha há anos — parece uma propriedade **nova ou de teste**,
criada junto com a migração para o tagging server.

E o navegador do requisitante carrega **dois** cookies de sessão GA4:

```
_ga_HZE53T0J6P   ← a que o Jarvis lê (545839732)
_ga_T8DW11X6XE   ← OUTRA propriedade, não compartilhada com o Jarvis
```

Se `G-T8DW11X6XE` for a propriedade oficial, então **nada está quebrado**: o dado
flui normalmente para lá, e o erro foi o Jarvis ter sido apontado para a
propriedade errada — provavelmente porque foi a única compartilhada com o service
account em julho.

**Resolva isto primeiro.** Os passos abaixo mudam completamente conforme a resposta.

---

## PASSO 0 · Qual propriedade vocês realmente usam? (2 minutos)

1. Abra [analytics.google.com](https://analytics.google.com)
2. Canto superior esquerdo: clique no **seletor de contas/propriedades**
3. Anote **todas** as propriedades que aparecem, com o número de cada uma
4. Entre na que o time de marketing consulta no dia a dia
5. **Administrador** (engrenagem, canto inferior esquerdo) → **Fluxos de dados**
6. Anote o **ID de métricas** (formato `G-XXXXXXXXXX`)

**Compare com `G-HZE53T0J6P`:**

| Resultado | Significa | Vá para |
|---|---|---|
| É `G-HZE53T0J6P` mesmo | a propriedade certa está parada de verdade | **PASSO 2** |
| É `G-T8DW11X6XE` ou outra | o Jarvis lê a propriedade errada | **PASSO 1** |
| Existem várias, e o site manda para mais de uma | há duplicidade a resolver | **PASSO 1**, e decidam qual é a oficial |

---

## PASSO 1 · Se a propriedade certa for outra

Nesse caso o conserto é **no Jarvis**, e é simples — duas coisas:

**1.1 · Dar acesso ao service account**

Na propriedade correta, no GA4:

1. **Administrador** → **Gerenciamento de acesso à propriedade**
2. Botão **+** (azul, canto superior direito) → **Adicionar usuários**
3. Cole o e-mail do service account do Jarvis:
   ```
   jarvis-gemini@jarvis-498903.iam.gserviceaccount.com
   ```
4. Papel: **Leitor** (não precisa mais que isso)
5. Desmarque "Notificar por e-mail" e salve

**1.2 · Trocar a propriedade no Jarvis**

Uma linha em `lib/marketing/config.ts`:

```ts
export const GA4_PROPERTY_ID = "545839732";   // ← trocar pelo número da propriedade certa
```

O número é o **ID da propriedade** (só dígitos), não o `G-...`. Encontra em
**Administrador → Configurações da propriedade → ID da propriedade**.

Depois: build + deploy. Peça ao Jarvis — é uma linha e um redeploy.

> Aproveite para decidir o destino da `545839732`. Se foi só teste, vale excluir
> ou renomear para "TESTE — não usar", senão alguém vai reconectar nela daqui a
> seis meses.

---

## PASSO 2 · Se a propriedade certa É a 545839732

Aí o problema é real, e está no encaminhamento do container do servidor.

### 2.1 · Abrir o container CERTO

1. [tagmanager.google.com](https://tagmanager.google.com)
2. Na lista de containers, procure o que tem o tipo **Servidor** — o ícone e o
   rótulo dizem "Servidor" / "Server". **Não é o `GTM-PJ379FLQ`**, que é o Web.
3. Se não houver nenhum container de servidor na sua conta, ele está em outra
   conta do Google — provavelmente na do PixelX (ver PASSO 3).

### 2.2 · Conferir os Clientes

Menu lateral → **Clientes**

Deve existir um cliente **"Google Analytics: GA4"**, ativo. Sabemos que ele existe
e funciona (o hit voltou 200 com cookie FPID), mas confirme que não foi alterado.

### 2.3 · Conferir as Tags — é aqui que está o problema

Menu lateral → **Tags**

Procure uma tag do tipo **"Google Analytics: GA4"**. Três cenários:

**a) A tag não existe**
→ É a causa. O cliente recebe e ninguém encaminha.
   - **Nova** → **Google Analytics: GA4**
   - ID de métricas: `G-HZE53T0J6P`
   - Acionamento: o gatilho do **cliente GA4** (geralmente "Todos os eventos" ou
     um gatilho customizado que casa com o cliente)
   - Salvar → **Enviar** (publicar)

**b) A tag existe, mas o gatilho não cobre os eventos**
→ **Suspeito nº 1.** O evento chega como `PageView_Cppem`, nome customizado que a
   propriedade nunca registrou.
   - Abra o **gatilho** da tag
   - Se ele filtra por nome de evento (ex.: "Nome do evento é igual a `page_view`"),
     ele **não** vai pegar `PageView_Cppem`
   - Amplie: use "Todos os eventos" do cliente GA4, ou acrescente os nomes
     customizados
   - Salvar → **Enviar**

**c) A tag existe mas está pausada**
→ Despause e publique.

**d) A tag existe e o ID de métricas é OUTRO**
→ Achou. O servidor está mandando o dado para outra propriedade. Decida qual é a
   oficial e alinhe com o PASSO 1.

### 2.4 · Confirmar visualmente antes de publicar

1. No container do servidor, botão **Visualizar** (canto superior direito)
2. Noutra aba, abra `https://contato.cppem.com.br`
3. Volte à janela de Visualizar

Você deve ver:
- a requisição **entrando** (aba de requisições, à esquerda)
- o **cliente GA4** reivindicando
- as **tags disparadas** — e é aqui que aparece o problema: se a lista de tags
  disparadas estiver vazia ou sem a tag GA4, o diagnóstico está confirmado na tela

---

## PASSO 3 · O PixelX

Os cookies mostram que o **PixelX está instalado**:

```
pxa_lead_id, pxa_lead_email, pxa_lead_phone, pxa_lead_name,
pxa_lead_ip, pxa_lead_city, pxa_lead_region, pxa_lead_zipcode
```

E é quase certo que é ele quem preenche os `ep.user_data.*` do hit — nome, e-mail,
telefone e endereço vêm exatamente desses cookies.

**Isso torna o PixelX um suspeito legítimo**, porque ferramentas desse tipo
costumam **gerenciar o container do servidor**. Se alguém do PixelX republicou o
container em 29/07 — trocando o ID de métricas, mudando o gatilho ou renomeando os
eventos para `PageView_Cppem` — a coleta pararia exatamente como parou, sem erro
em lugar nenhum.

**O que perguntar ao suporte do PixelX:**

1. Vocês administram o container de servidor do `sgtm.cppem.com.br`? Se sim, houve
   publicação por volta de **29/07/2026**?
2. Para qual **ID de métricas do GA4** o servidor encaminha hoje?
3. O evento `PageView_Cppem` é um rename feito por vocês? Se sim, a tag do GA4 no
   servidor foi ajustada para o novo nome?
4. Os dados de `user_data` (e-mail, telefone) são **hasheados** antes de irem para
   o GA4? (ver seção de PII acima — se forem em texto puro, é violação de política
   do Google)

> **Peça acesso ao container do servidor**, mesmo que só de leitura. Depender de
> terceiro para saber por que a medição parou é a razão de isso ter passado duas
> semanas despercebido.

---

## PASSO 4 · Confirmar que voltou

Depois de qualquer mudança publicada:

1. **GA4 → Relatórios → Tempo real**. Abra `contato.cppem.com.br` numa aba
   anônima. Deve aparecer **1 usuário ativo em segundos**. Este é o teste
   definitivo — não espere o relatório diário.
2. **GA4 → Administrador → DebugView** mostra evento a evento, com parâmetros.
   Serve para conferir se `PageView_Cppem` está chegando e com que dados.
3. No Jarvis, a aba **GA4 / Site** volta a mostrar número **no dia seguinte** — o
   relatório diário consolida com atraso, o tempo real não.

Se o tempo real mostrar usuário mas o relatório continuar zerado no dia seguinte,
aí sim investigue **filtros de dados** (Administrador → Configurações de dados →
Filtros de dados) — um filtro de tráfego interno ativo descartaria justamente as
visitas do escritório.

---

## O que segue pendente mesmo depois do conserto

1. **Eventos-chave** — a propriedade nunca teve nenhum configurado. Sessões e
   usuários voltam; **conversão continua zero** até alguém marcar quais eventos
   contam (Administrador → Eventos-chave).
2. **PII em texto puro** — ver seção acima. Independente da coleta, e mais grave.
3. **Duas propriedades GA4** — decidir qual é a oficial e aposentar a outra.

---

## Passo 1 · O hit sai do navegador? (5 min)

Antes de mexer em qualquer configuração, descubra **onde** a corrente arrebenta.

1. Abra `https://cppem.com.br` no Chrome
2. `F12` → aba **Network** → filtre por `collect`
3. Recarregue a página

**Leia assim:**

| O que você vê | Significa | Vá para |
|---|---|---|
| Nenhuma requisição `collect` | a tag não dispara (gatilho ou consentimento) | Passo 3 |
| `collect` para `sgtm.cppem.com.br` com **200/204** | o hit sai e é aceito — o problema é o encaminhamento | Passo 2 |
| `collect` para `sgtm.cppem.com.br` com **400** | o servidor recusa — confirma a hipótese | Passo 2 |
| `collect` para `google-analytics.com` | não está passando pelo servidor | Passo 4 |

---

## Passo 2 · O container do SERVIDOR (o suspeito principal)

Atenção: **são dois containers diferentes.** `GTM-PJ379FLQ` é o *web*. O servidor
tem um container próprio, do tipo **Server**, e é nele que se mexe aqui.

1. Entre em [tagmanager.google.com](https://tagmanager.google.com)
2. Abra o container do tipo **Servidor** (não o web)
3. Vá em **Clientes** (menu lateral)

**Existe um cliente "Google Analytics: GA4"?**

- **Não existe** → é essa a causa. Crie:
  `Novo` → `Configuração do cliente` → **Google Analytics: GA4** → salvar → **Enviar/Publicar**
- **Existe mas está desativado** → ative e publique
- **Existe e está ativo** → siga para as Tags

4. Vá em **Tags**, ainda no container do servidor

Precisa haver uma tag **"Google Analytics: GA4"** que *encaminha* o hit para o
Google, acionada pelo gatilho do cliente GA4. Sem ela, o hit chega ao servidor e
morre ali — silenciosamente.

- **Não existe** → crie: `Nova Tag` → **Google Analytics: GA4** → gatilho: o do
  cliente GA4 → publique

5. Use o **Visualizar (Preview)** do container do servidor e recarregue o site
   numa outra aba. Você deve ver a requisição chegando, o cliente reivindicando e
   a tag disparando. É aqui que o elo quebrado aparece na cara.

---

## Passo 3 · Consentimento (se nada dispara no Passo 1)

O container tem a maquinaria de Consent Mode, e o HTML do site **não tem banner de
cookies nenhum** — nem a palavra "consent" aparece na página.

Se o padrão for `analytics_storage: denied` e nunca houver quem conceda, o GA4
simplesmente não registra sessão. Isso explicaria um corte seco.

No container **web** (`GTM-PJ379FLQ`):

1. **Administrador** → **Configurações de consentimento**
2. Veja o estado padrão de `analytics_storage`

Duas saídas legítimas:

- **Instalar um CMP** (banner de cookies) que conceda o consentimento — o caminho
  correto se vocês precisam de conformidade com a LGPD
- **Ajustar o padrão** para `granted` — só se houver base legal para isso; é
  decisão jurídica de vocês, não técnica

---

## Passo 4 · Confirmar que voltou

Depois de publicar qualquer mudança:

1. **GA4 → Relatórios → Tempo real** — abra o site numa aba anônima. Deve aparecer
   1 usuário ativo em segundos. Este é o teste definitivo.
2. **GA4 → Administrador → DebugView** — mostra os eventos chegando um a um, com
   os parâmetros. Útil para ver *o que* chega, não só *se* chega.
3. No Jarvis, a aba **GA4 / Site** volta a mostrar número no dia seguinte (o
   relatório diário consolida com atraso; o tempo real é imediato).

---

## Enquanto não voltar

**Conversões continuam zeradas mesmo depois do conserto.** A propriedade não tem
**nenhum evento-chave** configurado — nunca teve. Restaurar a coleta traz sessões e
usuários, mas "conversão" seguirá zero até alguém marcar quais eventos contam.

Isso é configuração no GA4 (**Administrador → Eventos-chave**), gratuita, e é
pré-requisito para qualquer meta de conversão do site
(ver [`marketing-metas-plano.md`](marketing-metas-plano.md) §3.1).

---

## Se quiser um teste definitivo pelo Jarvis

Dá para mandar **um hit real** para `sgtm.cppem.com.br/g/collect` com todos os
parâmetros e ver o código de resposta. Isso prova em segundos se o servidor aceita
ou recusa.

**Não foi feito** porque cria um evento falso na propriedade de vocês. Se
autorizarem, é o teste mais rápido que existe — e um evento a mais numa propriedade
zerada é ruído desprezível.
