import { createClient } from "@/lib/supabase/server";

/** Empresa do usuário autenticado (null se não houver sessão/perfil). */
export async function getCompanyId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const { data } = await supabase
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();

  return data?.company_id ?? null;
}
