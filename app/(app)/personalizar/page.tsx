import type { Metadata } from "next";

import { ManualSources } from "@/components/manual-sources";
import { getCompanyId } from "@/lib/db/company";
import { guardFeature } from "@/lib/db/permissions";
import { listManualSources } from "@/lib/db/sources";

export const metadata: Metadata = {
  title: "Personalizar | Jarvis",
};

export default async function PersonalizarPage() {
  await guardFeature("personalizar");
  const companyId = await getCompanyId();
  const sources = companyId ? await listManualSources(companyId) : [];

  return (
    <main>
      <section>
        <div className="sectionbox flex-col gap-6 py-10">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Personalizar</h1>
            <p className="text-muted-foreground">
              Fontes fixas que você escreve ou envia como arquivo (HTML, CSV, TXT,
              MD, JSON). O Jarvis as trata como conhecimento da empresa — junto do
              Notion — nas respostas do chat.
            </p>
          </div>

          <ManualSources sources={sources} />
        </div>
      </section>
    </main>
  );
}
