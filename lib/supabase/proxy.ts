import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Atualiza/renova a sessão do Supabase a cada request e protege rotas.
 * Segue o template oficial do Supabase para Next.js (App Router).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // Sem variáveis de ambiente configuradas, não há o que checar.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return supabaseResponse;
  }

  // Com Fluid compute, não guardar este client em variável global.
  // Sempre criar um novo a cada request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // NÃO rodar código entre createServerClient e supabase.auth.getClaims().
  // Um erro simples aqui torna muito difícil depurar usuários sendo
  // deslogados aleatoriamente.

  // IMPORTANTE: se remover getClaims() e usar SSR com o client do Supabase,
  // seus usuários podem ser deslogados aleatoriamente.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  // Rotas que o proxy NÃO redireciona: home, login, reset, callbacks de auth e
  // as rotas /api (que fazem a própria autenticação e devem responder 401, não 302).
  const isPublicRoute =
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/redefinir-senha") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    request.nextUrl.pathname.startsWith("/api");

  if (!user && !isPublicRoute) {
    // Sem usuário: redireciona para o login.
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // IMPORTANTE: você *deve* retornar o objeto supabaseResponse como está.
  // Se criar um novo NextResponse, lembre de:
  // 1. Passar o request: NextResponse.next({ request })
  // 2. Copiar os cookies: myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Ajustar o que precisar, mas sem alterar os cookies.
  // Caso contrário, navegador e servidor saem de sincronia e a sessão é
  // encerrada prematuramente.

  return supabaseResponse;
}
