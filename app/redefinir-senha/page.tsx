import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/reset-password-form";

export const metadata: Metadata = {
  title: "Redefinir senha | Jarvis",
};

export default function RedefinirSenhaPage() {
  return (
    <main>
      <section>
        <div className="sectionbox min-h-screen flex-col items-center justify-center">
          <ResetPasswordForm />
        </div>
      </section>
    </main>
  );
}
