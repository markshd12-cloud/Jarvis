"use client";

import { useEffect } from "react";

/**
 * Auto-hide global do scrollbar (estilo Jarvis): põe `.is-scrolling` no <html>
 * enquanto qualquer elemento rola e remove ~900ms após parar. O visual (barrinha
 * verde fina) fica no globals.css; aqui só alterna a classe. Listener em captura
 * pega o scroll de qualquer container, não só o da janela. Renderiza nada.
 */
export function ScrollbarAutoHide() {
  useEffect(() => {
    let timer: number | undefined;
    const onScroll = () => {
      document.documentElement.classList.add("is-scrolling");
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => document.documentElement.classList.remove("is-scrolling"),
        900,
      );
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
