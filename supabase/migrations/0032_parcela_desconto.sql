-- 0032_parcela_desconto.sql — Desconto obtido na baixa da parcela.
-- Ao pagar, é comum conseguir abatimento (pagamento adiantado, negociação com o
-- fornecedor). Hoje dava pra digitar um "valor pago" menor, mas o motivo se
-- perdia: `previsto − realizado` tanto pode ser desconto quanto pagamento
-- parcial. Registrando o desconto explicitamente, dá pra responder "quanto
-- economizamos com descontos no mês" e a diferença deixa de ser ambígua.
--
-- Só a baixa escreve aqui. NULL/0 = sem desconto. O DRE/Fluxo continuam usando
-- `valor_realizado` (o que de fato saiu do caixa) — este campo é informativo.
--
-- Puramente aditivo; mesma segurança do 0023 (RLS service-role-only já ligada).

alter table public.fin_parcelas
  add column if not exists desconto numeric(14,2)
    check (desconto is null or desconto >= 0);

-- ============================================================================
-- ROLLBACK:
--   alter table public.fin_parcelas drop column if exists desconto;
-- ============================================================================
