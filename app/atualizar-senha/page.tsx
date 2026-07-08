import type { Metadata } from "next";

import { UpdatePasswordForm } from "@/components/update-password-form";

export const metadata: Metadata = {
  title: "Nova senha | Jarvis",
};

export default function AtualizarSenhaPage() {
  return (
    <main>
      <section>
        <div className="sectionbox min-h-screen flex-col items-center justify-center">
          <UpdatePasswordForm />
        </div>
      </section>
    </main>
  );
}
