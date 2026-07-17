# Módulo Financeiro — Status (atualizado 2026-07-16)

Fonte única de "onde estamos". Detalhe de cada passo no `financeiro-PRD.md` (§9).

## Feito e validado

| Passo | O quê | Estado |
|---|---|---|
| 1 | Migration `0023_financeiro` — 12 tabelas (RLS service-role, sem policy) | ✅ aplicada em prod |
| 2 | Seed do Conta Azul + de-para BU (4 BUs, 117 categorias, 10 centros) | ✅ validado ao vivo |
| 3 | Camada de acesso `lib/financeiro/*` (context/gate, types, Zod) | ✅ tsc |
| 4 | Aba **Cadastros** (BU/Categorias/Centros) — CRUD + excluir + inativar | ✅ validado no browser |
| 5 | Aba **Colaboradores** — CRUD, CPF/CNPJ validado, PII gated | ✅ tsc |
| 5.1 | Vínculo com painel de Empresas (`profile_id`) + "Importar usuários" | ✅ migration `0024` aplicada |
| 6 | Aba **Contas a Pagar** — despesa parcelada, gerador de parcelas, Σ=total | ✅ tsc + validado |
| 7 | Baixa (pagamento) + editar dívida + agrupar por dívida + mini-dialog de baixa | ✅ tsc |
| 8 | Aba **Recorrências** — despesas fixas + "Gerar do mês" idempotente | ✅ tsc + clamp testado |
| 10 | Aba **Receita** — snapshot do CA (upsert por evento, idempotente) | ✅ validado: 4863/4863, reconcilia com CA |

**Reconciliação do snapshot (Passo 10):** nosso número bate 100% com o relatório **Contas a Receber** do
CA (out/2025 = R$117.817,00). O DRE do CA mostra R$125.271,63 — a diferença (~7,5k) é **interna ao CA**
(o DRE dele soma receita avulsa que não é título a receber e a API não expõe). Não é bug nosso. Ver
memória `contaazul-dre-api-lag`.

## Ajustes de UI aplicados (pedidos do usuário)
- Dock (FloatingDock): label agora **abaixo** do ícone (antes saía da tela).
- `SearchSelect` (`components/financeiro/search-select.tsx`): combobox com busca, **flutuante via portal**
  (não é cortado pelo overflow do dialog nem empurra conteúdo). Usado em Contas a Pagar e Recorrências.
- Dialogs largos: `DialogContent` base tem `sm:max-w-sm` → alargar exige `sm:max-w-none` + `w-[min(..,94vw)]`.
- **Scrollbar Jarvis global** auto-hide (`components/scrollbar-autohide.tsx` + globals.css): barrinha verde
  fina, invisível parada, aparece só ao rolar. Vale pro site todo.

## Falta fazer

### Fase 4 (fechar) — o próximo passo natural
- **Passo 11 · DRE v2 / cutover** — o payoff. DRE lê **receita do snapshot + despesa das nossas parcelas**
  (`fin_parcelas`) por competência, filtro por BU, previsto×realizado.
  - **Decisão travada:** cutover **configurável, default `2025-12`** (mantém CA antes, nosso a partir dele).
  - **Regra dura (double-count):** cada competência lê despesa de UMA fonte só. Não cutar mês sem dado nosso.
  - Depende de 6–7 (ok) e 10 (ok). Mexe em `lib/contaazul/dre.ts` (o coração) — commitar antes.

### Fase 5 — Relatórios gerenciais
- **Passo 12 · Dashboards TV** — alertas + gráfico receita×despesa por BU. Depende de 9 e 11.
- **Passo 13 · Fluxo de Caixa** — caixa mensal/diário, **regime de caixa** (data de pagamento, não
  competência), filtros BU + previsto/realizado, export. Depende de 10–11.
- **Passo 14 · % por Centro de Custo** — tabela centro × valor × %. Depende de 6–7 (**já pode ser feito**).
- **Passo 15 · Vendas & contas a faturar** — read de `/venda/busca` do CA com filtros. Depende de 2.

### Fase 6 — Cadastros complementares (baixa prioridade)
- **Passo 16 · Clientes** — read de `/pessoa` do CA (read-only).
- **Passo 17 · Produtos & Serviços** — read de `/produtos` e `/servico`.

### Passo 9 (pulado, fazer antes do 12)
- **Orçamento & Limite + motor de alertas** — metas categoria×BU×competência, alerta de estouro.

## Itens fora da numeração (anotados)
- **Export pra CA** — gerar planilha no formato `Planilha_Modelo_ContaAzul.xls` (é `.xls` binário OLE; abrir
  o modelo e passar os cabeçalhos quando formos construir). Garante reversibilidade "voltar pro CA".
- **Cron de automação** — sync de receita (Passo 10) + materialização de recorrências (Passo 8) rodando
  sozinhos por mês/dia. Hoje ambos são manuais (botão). As rotas já existem.

## Notas operacionais
- **Turbopack:** rota/arquivo/método novo exige restart do `npm run dev`. Sequência de restarts corrompe o
  manifest do `.next` → 404 em rotas → `rm -rf .next` + restart + "warm" (curl nas rotas) resolve.
- **Nunca** renovar o token do CA fora da app (rotaciona refresh_token do Cognito → `invalid_grant` em prod).
- Tudo escopado por `companyId`; `fin_*` é service-role only (gate `financeiro` nas rotas via `finContext`).
