/**
 * DRE de um PERÍODO (trimestre, ano, intervalo livre) — soma de competências.
 *
 * ## Por que somar a SAÍDA do `getDre`, e não filtrar por intervalo lá dentro
 *
 * `computeDre` recebe UMA competência e a usa em oito consultas diferentes, cada
 * uma com o seu recorte de data. Alargar tudo aquilo para um intervalo daria uma
 * segunda implementação do DRE para manter em sincronia — e, pior, atropelaria o
 * CUTOVER: `usaJarvis = cutover != null && competencia >= cutover` é decidido POR
 * MÊS, então um período que atravessa a virada precisa de meses lendo do Conta
 * Azul e meses lendo do Jarvis. Somando por fora, cada mês resolve a própria
 * fonte e o cutover funciona de graça.
 *
 * Bônus: cada mês passa pelo cache do `getDre`, então trocar de trimestre relê
 * só os meses novos.
 *
 * ## O AV% não é recalculado à mão
 *
 * Percentual não se soma, então os AV precisam sair das somas. Para as linhas
 * normais é direto (valor ÷ receita bruta somada). Para as linhas que mostram a
 * META no previsto (Faturamento Bruto e suas folhas, e o Lucro Líquido, no
 * regime de competência) vale uma identidade do `computeDre`: nelas `previsto` e
 * `orcado` são O MESMO número. Logo `avPrev === avOrc`, e basta copiar — sem
 * reescrever a regra e sem risco de as duas versões divergirem.
 */
import "server-only";

import {
  getDre,
  type DreChild,
  type DreRegime,
  type DreResult,
  type DreRow,
} from "./dre";

/** Divisão protegida, igual à do `computeDre`. */
const av = (valor: number, base: number): number => (base ? (valor / base) * 100 : 0);

/** Identidade da linha entre meses. A árvore do CA é a mesma, então isto casa. */
const chave = (r: DreRow, i: number): string =>
  r.kind === "group" ? `g:${r.codigo}` : `t:${i}:${r.label}`;

/**
 * DRE somado de `comps` (na ordem). Uma competência só devolve o `getDre` puro —
 * o caminho novo não muda em nada a tela de sempre.
 */
export async function getDrePeriodo(
  companyId: string,
  comps: string[],
  buId?: string | null,
  regime: DreRegime = "competencia",
): Promise<DreResult> {
  if (comps.length === 0) throw new Error("período sem competências");
  if (comps.length === 1) return getDre(companyId, comps[0], buId, regime);

  // Sequencial de propósito: em série o cache do mês anterior já está quente e
  // não disparamos 12 rodadas de consultas simultâneas contra a CA.
  const partes: DreResult[] = [];
  for (const c of comps) partes.push(await getDre(companyId, c, buId, regime));

  const vivos = partes.filter((p) => p.connected);
  const semDados = comps.filter((_, i) => !partes[i].connected);
  const base = vivos[0] ?? partes[0];

  // --- soma das linhas ----------------------------------------------------- //
  const ordem: string[] = [];
  const linhas = new Map<string, DreRow>();

  for (const p of vivos) {
    p.rows.forEach((r, i) => {
      const k = chave(r, i);
      const atual = linhas.get(k);
      if (!atual) {
        ordem.push(k);
        // Cópia própria: as linhas vêm do cache do `getDre` e somar em cima
        // delas corromperia o mês guardado.
        linhas.set(k, {
          ...r,
          ...(r.kind === "group" ? { children: r.children.map((c) => ({ ...c })) } : {}),
        } as DreRow);
        return;
      }
      atual.valor += r.valor;
      atual.previsto += r.previsto;
      atual.orcado += r.orcado;
      atual.temMeta = atual.temMeta || r.temMeta;
      if (atual.kind === "group" && r.kind === "group")
        somarFilhas(atual.children, r.children);
    });
  }

  const rows = ordem.map((k) => linhas.get(k)!);

  // --- bases dos AV, das próprias somas ------------------------------------ //
  const g01 = rows.find(
    (r): r is Extract<DreRow, { kind: "group" }> =>
      r.kind === "group" && r.codigo === "01",
  );
  const receitaBruta = g01?.valor ?? 0;
  const receitaBrutaPrev = vivos.reduce((s, p) => s + p.receitaBrutaPrev, 0);
  const receitaBrutaOrc = g01?.orcado ?? 0;

  for (const r of rows) {
    r.av = av(r.valor, receitaBruta);
    r.avOrc = av(r.orcado, receitaBrutaOrc);
    // Linha de meta: `previsto === orcado` por construção (ver o cabeçalho).
    r.avPrev = r.previstoEhMeta ? r.avOrc : av(r.previsto, receitaBrutaPrev);
    if (r.previstoEhMeta) r.previstoSemMeta = !r.temMeta;
    if (r.kind !== "group") continue;
    for (const c of r.children) {
      c.av = av(c.valor, receitaBruta);
      c.avOrc = av(c.orcado, receitaBrutaOrc);
      c.avPrev = c.previstoEhMeta ? c.avOrc : av(c.previsto, receitaBrutaPrev);
      if (c.previstoEhMeta) c.previstoSemMeta = !c.temMeta;
    }
  }

  // O Faturamento Bruto É a base do AV previsto: 100% quando há meta. Idêntico
  // ao que o `computeDre` faz para um mês.
  if (g01?.previstoEhMeta) g01.avPrev = g01.temMeta ? 100 : 0;

  // --- avisos -------------------------------------------------------------- //
  const avisos: string[] = [];
  if (semDados.length)
    avisos.push(
      `Sem dados do Conta Azul em ${semDados.join(", ")} — o período está incompleto.`,
    );
  /**
   * Mês com despesa orçada e NENHUMA meta de faturamento = plano pela metade.
   *
   * O "lucro planejado" desse mês vira a despesa inteira com sinal negativo
   * (jul/2026: −R$ 242.049,17), e somado ao período arrasta o resultado para
   * baixo sem que exista previsão de prejuízo nenhuma. É o mesmo engano que a
   * extração já avisa em "SEM FATURAMENTO EMITIDO", do lado do plano.
   */
  if (regime === "competencia") {
    const semMetaReceita = comps.filter((c, i) => {
      const p = partes[i];
      if (!p.connected || !p.temOrcamento) return false;
      const g = p.rows.find((r) => r.kind === "group" && r.codigo === "01");
      return (g?.orcado ?? 0) === 0;
    });
    if (semMetaReceita.length)
      avisos.push(
        `Sem META DE FATURAMENTO em ${semMetaReceita.join(", ")}, mas com despesa orçada: ` +
          `nesses meses o Lucro Líquido previsto é a despesa inteira negativada, não uma previsão de prejuízo. ` +
          `Cadastre a meta de receita para o período fechar.`,
      );
  }
  if (new Set(vivos.map((p) => p.despesaFonte)).size > 1)
    avisos.push(
      "O período atravessa o cutover: parte da despesa vem do Conta Azul e parte do Jarvis.",
    );
  avisos.push(...new Set(vivos.map((p) => p.aviso).filter(Boolean) as string[]));

  return {
    connected: vivos.length > 0,
    // O último mês do período: o que a tela usa como referência de "onde estou".
    competencia: comps[comps.length - 1],
    periodo: { de: comps[0], ate: comps[comps.length - 1], meses: comps.length },
    receitaBruta,
    receitaBrutaPrev,
    temPrevReal: vivos.some((p) => p.temPrevReal),
    rows,
    semMapeamento: vivos.reduce((s, p) => s + p.semMapeamento, 0),
    atualizadoAte: vivos.reduce<string | null>(
      (mx, p) => (p.atualizadoAte && (!mx || p.atualizadoAte > mx) ? p.atualizadoAte : mx),
      null,
    ),
    temOrcamento: vivos.some((p) => p.temOrcamento),
    /**
     * Liquidação NÃO é somável: ela é uma razão, e a média das razões de doze
     * meses não é a razão do ano. Como só o painel de Fechamento a usa, e lá ela
     * existe para dizer "ainda é cedo para julgar o mês", num período fechado ela
     * perde o sentido — `null` é a resposta honesta.
     */
    liquidacao: { despesa: null, receita: null },
    despesaFonte: vivos[vivos.length - 1]?.despesaFonte ?? base.despesaFonte,
    cutover: base.cutover,
    estruturaFonte: base.estruturaFonte,
    estruturaSyncAt: base.estruturaSyncAt,
    regime,
    foraDaCompetencia: juntarForaDaCompetencia(vivos),
    aviso: avisos.length ? avisos.join(" ") : undefined,
  };
}

function somarFilhas(alvo: DreChild[], novas: DreChild[]): void {
  const idx = new Map(alvo.map((c, i) => [c.label, i]));
  for (const n of novas) {
    const i = idx.get(n.label);
    if (i === undefined) {
      alvo.push({ ...n });
      idx.set(n.label, alvo.length - 1);
      continue;
    }
    alvo[i].valor += n.valor;
    alvo[i].previsto += n.previsto;
    alvo[i].orcado += n.orcado;
    alvo[i].temMeta = alvo[i].temMeta || n.temMeta;
  }
}

function juntarForaDaCompetencia(partes: DreResult[]): DreResult["foraDaCompetencia"] {
  const comItens = partes.filter((p) => p.foraDaCompetencia);
  if (comItens.length === 0) return undefined;
  return {
    total: comItens.reduce((s, p) => s + p.foraDaCompetencia!.total, 0),
    totalProprio: comItens.reduce((s, p) => s + p.foraDaCompetencia!.totalProprio, 0),
    totalImportado: comItens.reduce((s, p) => s + p.foraDaCompetencia!.totalImportado, 0),
    // Teto para não devolver mil linhas num ano inteiro — a tela lista, não audita.
    itens: comItens.flatMap((p) => p.foraDaCompetencia!.itens).slice(0, 200),
  };
}
