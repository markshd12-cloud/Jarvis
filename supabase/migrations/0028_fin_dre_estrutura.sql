-- 0028_fin_dre_estrutura.sql — Estrutura do DRE cacheada (Opção A).
-- O DRE monta a árvore (grupos 01–08, subgrupos, totalizadores) a partir do
-- `/financeiro/categorias-dre` do Conta Azul, buscado AO VIVO a cada cálculo.
-- Isso deixava o DRE refém do CA: token expirado / API fora → DRE não abre.
--
-- Aqui guardamos a última árvore boa que o CA devolveu (JSON) + o carimbo do
-- sync. O motor do DRE passa a: tentar o CA → se responder, usa E regrava aqui
-- (mantém fresco); se o CA falhar, usa esta CÓPIA (o DRE continua abrindo). A
-- árvore é config quase-estática (muda só quando se mexe nas categorias do DRE),
-- então cachear é seguro. RECEITA e DESPESA seguem suas fontes (não mudam aqui).
--
-- Puramente aditivo. Mesma segurança do 0023/0025: só o service_role acessa.

alter table public.fin_dre_config
  add column if not exists estrutura_json jsonb,
  add column if not exists estrutura_sync_at timestamptz;
  
-- ============================================================================
-- ROLLBACK:
--   alter table public.fin_dre_config
--     drop column if exists estrutura_json,
--     drop column if exists estrutura_sync_at;
-- ============================================================================
