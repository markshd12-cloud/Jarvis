import "server-only";

/**
 * Competência corrente no fuso da OPERAÇÃO (America/Sao_Paulo), não em UTC.
 *
 * O servidor roda em UTC; entre 21h e meia-noite (BRT) o UTC já está no dia
 * seguinte — e no último dia do mês isso vira o MÊS seguinte. Usar `new
 * Date().toISOString()` aí materializava/consultava a competência errada (caso
 * real: às 20:33 de 31/07 o servidor achava que era 07/2026… e no dia 1º às 21h
 * acharia 09/2026). Toda decisão de "que mês é hoje" no servidor passa por aqui.
 */
export function mesCorrente(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

/** Data de hoje ('AAAA-MM-DD') no fuso da operação. */
export function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
    new Date(),
  );
}
