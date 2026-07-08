import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function RootPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  // Já registrado/logado → dashboard. Caso contrário → login.
  if (data?.claims) {
    redirect("/dashboard");
  }
  redirect("/login");
}
