"use client";

import { MoonIcon, SunMediumIcon } from "lucide-react";
import { Switch as SwitchPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/use-theme";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & {
    icon?: React.ReactNode;
    thumbClassName?: string;
  }
>(({ className, icon, thumbClassName, ...props }, ref) => (
  <SwitchPrimitive.Root
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none flex h-4 w-4 items-center justify-center rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
        thumbClassName
      )}
    >
      {icon ? icon : null}
    </SwitchPrimitive.Thumb>
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

/**
 * Toggle de tema (root ↔ dark). Marcado = dark.
 */
export default function ThemeToggle() {
  const { isDark, toggle, mounted } = useTheme();

  // Placeholder do mesmo tamanho até montar, para evitar mismatch de hidratação.
  if (!mounted) {
    return <div className="h-7 w-12 rounded-full bg-input" aria-hidden />;
  }

  return (
    <Switch
      checked={isDark}
      onCheckedChange={toggle}
      aria-label="Alternar tema claro/escuro"
      className="h-7 w-12"
      icon={
        isDark ? (
          <MoonIcon className="h-4 w-4" />
        ) : (
          <SunMediumIcon className="h-4 w-4" />
        )
      }
      thumbClassName="h-6 w-6 data-[state=checked]:translate-x-5"
    />
  );
}

export { Switch };
