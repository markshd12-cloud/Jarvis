-- 0034_recorrencia_metodo_pagamento.sql — Método de pagamento na recorrência.
--
-- `fin_parcelas.metodo_pagamento` existe desde a 0023, mas `fin_recorrencias`
-- não tinha o par — então a recorrência não conseguia dizer COMO a despesa que
-- ela gera é paga, e `materializar()` criava a parcela com o campo nulo.
--
-- Preencher na parcela à mão não resolvia: `updateRecorrencia` chama
-- `removerFuturosGerados` + `materializarHorizonte`, ou seja, editar a
-- recorrência apaga e refaz as parcelas futuras não pagas — e o método
-- preenchido à mão sumia junto. O dado precisa morar no molde, não na cópia.
--
-- Texto livre igual ao da parcela (pix/boleto/cartao/guru/stone/…): a lista de
-- sugestões vive em METODOS_PAGAMENTO (lib/financeiro/types.ts) e evolui sem
-- migration. Null = não informado, que é o estado de toda recorrência anterior
-- a esta migração.
--
-- Puramente aditivo, nullable, sem default: nenhuma linha existente muda de
-- comportamento. RLS service-role-only já ligada desde a 0023.

alter table public.fin_recorrencias
  add column if not exists metodo_pagamento text;

-- ============================================================================
-- ROLLBACK:
--   alter table public.fin_recorrencias drop column if exists metodo_pagamento;
-- ============================================================================
