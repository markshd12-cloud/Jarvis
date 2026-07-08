"use client";

import { useEffect, useState } from "react";

/**
 * Estado do tema (dark/root). Lê a classe `.dark` aplicada pelo script do layout
 * e persiste a escolha em localStorage (mesma chave lida no boot: "theme").
 */
export function useTheme() {
  const [isDark, setIsDark] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);

  function toggle() {
    setIsDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  }

  return { isDark, toggle, mounted };
}
