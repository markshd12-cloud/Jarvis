import type { Metadata } from "next";

import { JarvisLogo } from "@/components/brand/jarvis-logo";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "Entrar | Jarvis",
  description: "Acesse o HUB de IAs corporativo Jarvis.",
};

const NOTICES: Record<string, string> = {
  expired: "O link expirou ou já foi usado. Solicite um novo.",
  link: "Link inválido. Solicite um novo.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const notice = error ? NOTICES[error] : undefined;

  return (
    <main>
      <section>
        <div className="sectionbox min-h-screen items-center">
          <div className="grid w-full grid-cols-1 items-center gap-12 py-12 lg:grid-cols-2 lg:gap-8">
            {/* Logo centralizada na própria metade (esquerda) */}
            <div className="flex items-center justify-center">
              <JarvisLogo />
            </div>

            {/* Inputs à direita */}
            <div className="flex items-center justify-center">
              <LoginForm notice={notice} />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
