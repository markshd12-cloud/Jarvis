-- Configurações pessoais: nome que o Jarvis usa para chamar o usuário +
-- instruções customizadas (system prompt pessoal). RLS já cobre select/update
-- (policies "profiles_select_company" e "profiles_update_self" da 0001).

alter table public.profiles
  add column if not exists nickname text,
  add column if not exists custom_instructions text;
