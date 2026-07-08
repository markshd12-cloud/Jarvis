import { cn } from "@/lib/utils";

/**
 * Símbolo do Jarvis (núcleo orbital em SVG), com gradientes verdes da marca.
 * Reutilizável: login (grande) e sidebar (compacto). Tamanho/sombra vêm via className.
 */
export function JarvisMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" role="img" aria-label="Jarvis" className={className}>
      <defs>
        <linearGradient id="jarvis-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--logo-from)" />
          <stop offset="50%" stopColor="var(--logo-via)" />
          <stop offset="100%" stopColor="var(--logo-to)" />
        </linearGradient>
        <radialGradient id="jarvis-core" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="var(--logo-from)" />
          <stop offset="100%" stopColor="var(--logo-via)" />
        </radialGradient>
      </defs>

      {/* anel externo */}
      <circle
        cx="60"
        cy="60"
        r="48"
        fill="none"
        stroke="url(#jarvis-ring)"
        strokeWidth="4"
      />
      {/* anel interno inclinado */}
      <ellipse
        cx="60"
        cy="60"
        rx="48"
        ry="20"
        fill="none"
        stroke="url(#jarvis-ring)"
        strokeWidth="2.5"
        opacity="0.7"
        transform="rotate(-30 60 60)"
      />
      {/* núcleo */}
      <circle cx="60" cy="60" r="13" fill="url(#jarvis-core)" />
    </svg>
  );
}

/**
 * Marca completa do Jarvis: símbolo + wordmark + subtítulo, com glow verde.
 * Usada na tela de login.
 */
export function JarvisLogo({ className }: { className?: string }) {
  return (
    <div className={cn("relative flex flex-col items-center gap-6", className)}>
      {/* Glow verde difuso atrás do símbolo */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 left-1/2 -z-10 h-72 w-72 -translate-x-1/2 rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, var(--brand) 0%, transparent 70%)",
        }}
      />

      <JarvisMark className="h-28 w-28 drop-shadow-[0_0_24px_var(--brand)]" />

      <span
        className="bg-clip-text text-5xl font-semibold tracking-[0.35em] text-transparent"
        style={{
          backgroundImage:
            "linear-gradient(120deg, var(--logo-from) 0%, var(--logo-via) 45%, var(--logo-to) 100%)",
        }}
      >
        JARVIS
      </span>
      <span className="text-sm tracking-widest text-muted-foreground">
        HUB DE IAs
      </span>
    </div>
  );
}
