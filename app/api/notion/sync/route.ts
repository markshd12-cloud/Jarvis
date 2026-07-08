import { NextResponse, type NextRequest } from "next/server";

import { getCompanyId } from "@/lib/db/company";
import { syncNotion } from "@/lib/notion/sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // Modo cron: header secreto → sincroniza todas as empresas conectadas.
  const cronSecret = req.headers.get("x-cron-secret");
  if (process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET) {
    const admin = createAdminClient();
    const { data: conns } = await admin
      .from("notion_connections")
      .select("company_id");

    for (const conn of conns ?? []) {
      try {
        await syncNotion(conn.company_id);
      } catch (error) {
        console.error("[notion] sync falhou (cron)", conn.company_id, error);
      }
    }
    return NextResponse.json({ ok: true, companies: conns?.length ?? 0 });
  }

  // Modo manual: usuário autenticado sincroniza a própria empresa.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return new Response("Unauthorized", { status: 401 });
  }

  const companyId = await getCompanyId();
  if (!companyId) {
    return new Response("Sem empresa", { status: 400 });
  }

  try {
    const result = await syncNotion(companyId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[notion] sync falhou (manual)", error);
    return new Response("Falha ao sincronizar", { status: 500 });
  }
}
