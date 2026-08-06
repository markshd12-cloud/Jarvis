"use client";

import { useState } from "react";

import { ChartTooltip, TooltipRow } from "@/components/charts/chart-tooltip";
import type { CacMes } from "@/lib/marketing/cac";

/**
 * Barras de CAC por mês, com tooltip.
 *
 * NÃO usa o `InteractiveBarsChart` compartilhado por um motivo concreto: aquele
 * calcula a escala sobre TODOS os grupos, e o mês em curso é um outlier de uma
 * ordem de grandeza (custo do mês inteiro ÷ vendas parciais — R$ 1.220 contra
 * R$ 63 a R$ 135 dos meses fechados). Escalar por ele espremeria os demais em
 * barras de 8px. Aqui a escala ignora o mês em curso, que aparece listrado e
 * limitado ao topo.
 *
 * O tooltip é o `ChartTooltip` do kit, para ficar visualmente idêntico ao dos
 * outros gráficos do app.
 *
 * Alturas em PIXEL, não em porcentagem. A primeira versão usava `height: X%`
 * dentro de um flex com `items-end` — e `align-items: flex-end` dá a cada coluna
 * a altura do próprio conteúdo, não a do container. A porcentagem resolvia contra
 * zero e NENHUMA barra aparecia. Com pixel não há contra o que resolver.
 */
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const money = (v: number | null) => (v == null ? "—" : brl.format(v));

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesLabel = (ym: string) => MESES[(Number(ym.slice(5, 7)) - 1) % 12] ?? ym;
const mesAno = (ym: string) => `${mesLabel(ym)}/${ym.slice(0, 4)}`;

const ALTURA = 120;

export function CacSerieChart({
  serie,
  mesEmCurso,
}: {
  serie: CacMes[];
  /** Competência 'AAAA-MM' do mês corrente — fica fora da escala. */
  mesEmCurso: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const fechados = serie.filter((x) => x.mes !== mesEmCurso);
  const base = (fechados.length ? fechados : serie).map((x) => x.cacPrevisto ?? 0);
  const max = Math.max(1, ...base);

  const alturaDe = (m: CacMes) =>
    m.cacPrevisto
      ? Math.min(ALTURA, Math.max(4, Math.round((m.cacPrevisto / max) * ALTURA)))
      : 3;

  const m = hover != null ? serie[hover] : null;
  const parcial = m?.mes === mesEmCurso;

  /**
   * Posição horizontal do tooltip, em %. Preso entre 12% e 88% para não vazar
   * pelas bordas do cartão nos meses das pontas.
   */
  const left =
    hover != null && serie.length
      ? Math.min(88, Math.max(12, ((hover + 0.5) / serie.length) * 100))
      : 50;

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <div className="overflow-x-auto">
        <div className="flex min-w-[520px] items-end gap-1.5">
          {serie.map((mes, i) => {
            const ehParcial = mes.mes === mesEmCurso;
            return (
              <div
                key={mes.mes}
                className="flex flex-1 cursor-default flex-col items-center gap-1"
                onMouseEnter={() => setHover(i)}
              >
                {/* Área de captura até o topo: sem ela só a barra recebe o
                    hover, e num mês de 4px acertar com o mouse é sorte. */}
                <div
                  className="flex w-full items-end"
                  style={{ height: ALTURA }}
                >
                  <div
                    className="w-full rounded-t bg-[var(--brand)] transition-opacity"
                    style={{
                      height: alturaDe(mes),
                      opacity: mes.cacPrevisto ? (hover === i ? 0.8 : ehParcial ? 0.55 : 1) : 0.25,
                      // Listrado = mês incompleto. Sem isso a barra no teto
                      // pareceria só "o mês mais caro do ano".
                      backgroundImage: ehParcial
                        ? "repeating-linear-gradient(45deg, transparent 0 4px, rgba(0,0,0,.35) 4px 8px)"
                        : undefined,
                    }}
                  />
                </div>
                <span
                  className={
                    ehParcial
                      ? "text-[10px] italic text-muted-foreground"
                      : "text-[10px] text-muted-foreground"
                  }
                >
                  {mesLabel(mes.mes)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {m ? (
        // `top` no TOPO da barra em foco (o tooltip se desloca para cima via
        // transform), não na base do gráfico — assim ele acompanha a coluna.
        <ChartTooltip left={`${left}%`} top={ALTURA - alturaDe(m)}>
          <p className="mb-1 font-medium text-foreground">{mesAno(m.mes)}</p>
          <div className="flex flex-col gap-0.5">
            <TooltipRow
              color="var(--brand)"
              label="CAC previsto"
              value={money(m.cacPrevisto)}
            />
            <TooltipRow label="custo lançado" value={money(m.custoPrevisto)} />
            <TooltipRow label="vendas" value={int.format(m.vendas)} />
            <div className="my-1 border-t border-border" />
            <TooltipRow label="CAC realizado" value={money(m.cacRealizado)} />
            <TooltipRow label="custo pago" value={money(m.custoRealizado)} />
            <TooltipRow label="faturadas" value={int.format(m.vendasFaturadas)} />
            <div className="my-1 border-t border-border" />
            <TooltipRow
              label="fonte"
              value={m.fonte === "banco-proprio" ? "Banco próprio" : "Conta Azul"}
            />
          </div>
          {/* O aviso só aparece onde ele é verdadeiro. Repetir em todo mês
              treinaria o leitor a ignorá-lo. */}
          {parcial ? (
            <p className="mt-1.5 max-w-[15rem] whitespace-normal text-[11px] italic text-muted-foreground">
              Mês em curso: o custo já cobre o mês inteiro, mas as vendas só
              existem até hoje — o CAC previsto fica inflado e fora da escala.
            </p>
          ) : null}
          {m.cacRealizado == null && m.custoPrevisto > 0 ? (
            <p className="mt-1.5 max-w-[15rem] whitespace-normal text-[11px] italic text-muted-foreground">
              Sem realizado: nenhuma parcela deste mês tem pagamento registrado.
            </p>
          ) : null}
        </ChartTooltip>
      ) : null}
    </div>
  );
}
