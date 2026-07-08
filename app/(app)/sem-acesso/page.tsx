import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sem acesso | Jarvis",
};

// Destino quando a role do usuário não concede nenhum módulo. Não é guardada
// (senão o redirect entraria em loop). O usuário continua logado; um gestor
// pode ajustar a role dele em Empresas.
export default function SemAcessoPage() {
  return (
    <main>
      <section>
        <div className="sectionbox min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Sem acesso</h1>
          <p className="max-w-md text-muted-foreground">
            Sua conta ainda não tem nenhuma área liberada. Fale com o
            administrador da sua empresa para receber as permissões.
          </p>
        </div>
      </section>
    </main>
  );
}
