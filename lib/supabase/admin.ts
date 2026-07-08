import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Client com a service_role key — ignora RLS. USAR SOMENTE NO SERVIDOR
 * (sync do Notion, armazenamento do token). NUNCA importar em Client Components.
 * Como ignora RLS, todo acesso deve filtrar company_id explicitamente no código.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
