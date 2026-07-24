# GA4 — Configuração de tracking (ações no GA4/GTM)

Guia das configurações que **não são código**: dependem do GA4/Google Tag Manager.
Complementa `marketing-status.md` (roadmap) e `marketing-fontes.md` (catálogo).
Validado com probe ao vivo na property `545839732` em 2026-07-21.

> ⚠️ **GA4 leva 24-48h para processar.** Métricas de "ontem/hoje" podem aparecer como
> `(data not available)`. Numa leitura feita durante o processamento vimos 28% de tráfego
> "sem atribuição"; com os dados processados, o número real caiu para **2%**. Sempre
> confira números de atribuição olhando uma janela com ≥2 dias de folga.

---

## Diagnóstico atual (2026-07-21, 28 dias)

| Item | Estado | Ação |
|---|---|---|
| **Eventos-chave (conversões)** | 🔴 **`keyEvents` = 0** | **Configurar** — seção 1 |
| UTMs / atribuição | 🟢 saudável (só 2% sem atribuição) | Manter a convenção — seção 2 |
| Cross-domain | 🟡 a decidir | Avaliar — seção 3 |
| Rótulo por site/marca | 🟡 opcional (`hostName` já resolve) | Seção 4 |

Sessões por origem hoje: `google/cpc` 187 · `MetaAds` 150 · `google/organic` 47 ·
`(direct)` 32 · `ig/social` 24 · `bing/organic` 9. Campanhas já com UTM:
`gtm_pmpe_cppem`, `bau_compt`, `bal_wpp_cppem`, `BAU | LEADS | PMPE`.

---

## 1. 🔴 Eventos-chave (key events) — a maior lacuna

**Problema:** o site só dispara os eventos automáticos (`page_view`, `session_start`,
`first_visit`, `user_engagement`). Nenhum evento de **conversão**. Por isso o card
"Conversões" do Jarvis mostra 0 e **não dá para saber qual canal traz LEAD** — só qual
canal traz visita.

### 1.1 Definir os eventos que importam

| Evento sugerido | Quando dispara | Por que importa |
|---|---|---|
| `contato_whatsapp` | clique em qualquer link de WhatsApp | principal canal de lead |
| `lead_formulario` | envio de formulário (contato/inscrição) | lead qualificado |
| `matricula_iniciada` | chegada na página de matrícula/checkout | intenção alta |
| `matricula_concluida` | página de obrigado/confirmação | conversão final |

### 1.2 Criar no Google Tag Manager

Para cada evento, é **1 acionador + 1 tag**:

**WhatsApp**
1. GTM → *Acionadores* → Novo → **Clique - Apenas links**.
2. Disparar em: *Alguns cliques em links* → `Click URL` **contém** `wa.me`
   (crie um segundo com `api.whatsapp.com`, ou use a condição "corresponde à regex"
   `wa\.me|api\.whatsapp\.com`).
3. GTM → *Tags* → Novo → **Google Analytics: evento do GA4**.
   - Tag de configuração: sua tag GA4 existente.
   - Nome do evento: `contato_whatsapp`
   - Parâmetros (opcional): `link_url` = `{{Click URL}}`, `pagina` = `{{Page Path}}`
   - Acionador: o criado acima.

**Formulário**
- Acionador: **Envio de formulário** (marque "Verificar validação"). Se o site envia por
  AJAX/React e o acionador nativo não pegar, use um acionador de **Evento personalizado**
  com o nome que o site empurra no dataLayer (peça ao dev do site).
- Tag GA4 evento: `lead_formulario`.

**Matrícula**
- Acionador: **Visualização de página** → `Page Path` contém `/obrigado` (ou a URL de
  confirmação real).
- Tag GA4 evento: `matricula_concluida`.

4. **Visualizar** (Preview) no GTM, testar cada ação no site, confirmar que o evento
   aparece no GA4 em *Relatórios → Tempo real*.
5. **Publicar** o container.

### 1.3 Marcar como evento-chave no GA4

1. GA4 → **Administrador** → *Exibição de dados* → **Eventos**.
2. Localize `contato_whatsapp`, `lead_formulario`, `matricula_concluida`.
   (Só aparecem **depois** de dispararem ao menos uma vez — pode levar até 24h.)
3. Ative a chave **"Marcar como evento principal"** em cada um.

### 1.4 O que isso destrava no Jarvis
Com `keyEvents` > 0, passa a fazer sentido puxar **conversões por canal/campanha** e
calcular **custo por lead do site** cruzando com o investimento do Meta/Google Ads —
fechando o ciclo anúncio → visita → **lead**.

---

## 2. 🟢 UTMs — manter a convenção

Está **saudável** (2% sem atribuição). Para continuar assim, padronize todo link de campanha:

```
https://cppem.com.br/pagina
  ?utm_source=meta            # de onde: meta | google | instagram | email | whatsapp
  &utm_medium=cpc             # tipo: cpc | organico | social | referral | email
  &utm_campaign=bau_compt     # nome da campanha (minúsculo, sem espaço)
  &utm_content=video_01       # criativo/variação (opcional, p/ teste A/B)
```

Regras práticas:
- **Sempre minúsculo e sem espaço** — `Meta` e `meta` viram duas origens diferentes.
- Um `utm_campaign` por campanha, reaproveitado em todos os criativos dela.
- Links de bio/WhatsApp também merecem UTM (senão caem em `(direct)`).
- Nunca colocar UTM em link **interno** do próprio site (quebra a sessão).

---

## 3. 🟡 Cross-domain (medição entre domínios)

Hoje `captura.cppem.com.br`, `pmpe.cppem.com.br`, `colegio.*`, `unicive.*` e
`cppem.com.br` são domínios distintos. Se o visitante **navega de um para o outro na mesma
jornada** (ex.: captura → site principal), sem cross-domain o GA4 abre **sessão nova** e a
origem original se perde (vira `referral` do próprio site) — distorcendo o funil.

**Como configurar (só se for a mesma jornada):**
1. GA4 → **Administrador** → *Fluxos de dados* → selecione o fluxo web.
2. **Configurar definições de tag** → **Configurar seus domínios**.
3. Adicione: `cppem.com.br`, `pmpe.cppem.com.br`, `captura.cppem.com.br`,
   `colegio.cppem.com.br`, `unicive.cppem.com.br`.

Se forem sites **independentes** (jornadas separadas), **não** configure — o `hostName`
que já usamos no Jarvis resolve a separação.

---

## 4. 🟡 (Opcional) Dimensão personalizada de marca/site

O Jarvis já separa por `hostName`, então isso é **opcional**. Só vale se você quiser
agrupar por MARCA (ex.: "Colégio" somando dois domínios):

1. GTM: envie um parâmetro `marca` na tag de configuração do GA4 (valor fixo por site
   ou via variável).
2. GA4 → Administrador → *Definições personalizadas* → **Criar dimensão personalizada**
   → escopo *Evento*, parâmetro `marca`.

---

## Checklist

- [ ] Criar acionadores + tags GA4 no GTM (WhatsApp, formulário, matrícula)
- [ ] Testar no modo Preview e publicar o container
- [ ] Marcar os 3 como **evento principal** no GA4 (após dispararem)
- [ ] Aguardar 24-48h e conferir "Conversões" no Jarvis (`/marketing` → GA4)
- [ ] Decidir cross-domain (mesma jornada ou sites independentes)
- [ ] Manter a convenção de UTM em toda campanha nova
