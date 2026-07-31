"use client";

import { Input } from "@/components/ui/input";

/**
 * Input de dinheiro com máscara BRL ao digitar (estilo app de banco): o usuário
 * digita dígitos e o campo exibe "R$ 10.000,00" — os dígitos entram pelos
 * centavos ("10000" → R$ 100,00). O `value` externo segue sendo a string decimal
 * ("10000.00"), compatível com todo o código existente (`Number(value)`).
 * Vazio é permitido (campos opcionais, ex. limite) → devolve "".
 */
const fmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function MoneyInput({
  value,
  onChange,
  className,
  placeholder = "R$ 0,00",
  disabled,
  autoFocus,
  onBlur,
}: {
  value: string;
  onChange: (decimal: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
}) {
  const n = Number(value);
  const display = value === "" || !Number.isFinite(n) ? "" : fmt.format(n);
  return (
    <Input
      type="text"
      inputMode="numeric"
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onBlur={onBlur}
      value={display}
      onChange={(e) => {
        // Máscara por dígitos: tudo que não for dígito cai fora; os dígitos são centavos.
        const digits = e.target.value.replace(/\D/g, "");
        if (!digits) return onChange("");
        onChange((Number(digits) / 100).toFixed(2));
      }}
    />
  );
}
