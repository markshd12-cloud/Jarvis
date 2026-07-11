import { NextResponse, type NextRequest } from "next/server";

import { getCompanyId } from "@/lib/db/company";
import { syncTasks } from "@/lib/notion/tasks";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // Modo cron: header secreto → sincroniza as tarefas de todas as empresas.
  const cronSecret = req.headers.get("x-cron-secret");
  if (process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET) {
    const admin = createAdminClient();
    const { data: conns } = await admin
      .from("notion_connections")
      .select("company_id");

    for (const conn of conns ?? []) {
      try {
        await syncTasks(conn.company_id);
      } catch (error) {
        console.error("[tasks] sync falhou (cron)", conn.company_id, error);
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
    const result = await syncTasks(companyId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[tasks] sync falhou (manual)", error);
    return new Response("Falha ao sincronizar", { status: 500 });
  }
}
