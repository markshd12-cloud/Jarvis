/**
 * Serializa uma `Extracao` em CSV que o **Excel pt-BR abre com dois cliques**.
 *
 * Três detalhes que parecem preciosismo e não são — cada um foi encontrado
 * gerando as extrações manuais de 2026-08-12:
 *
 * 1. **Separador `;`**, não vírgula. No Windows em pt-BR a vírgula é separador
 *    DECIMAL, então um CSV com vírgula abre tudo numa coluna só.
 * 2. **BOM UTF-8** (`﻿`) no começo. Sem ele o Excel assume a codificação do
 *    sistema e "Competência" vira "CompetÃªncia".
 * 3. **Número em pt-BR** (`1.234,56`). Com ponto decimal o Excel trata como
 *    texto e a coluna não soma.
 *
 * O XLSX (v2) resolve o item 3 de forma melhor — formato de célula de verdade,
 * em vez de string formatada — e por isso vive num serializador separado, sem
 * mexer nas fontes.
 */
import "server-only";

import type { Coluna, Extracao } from "./tipos";

const dinheiro = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** Aspas duplas sempre: descrição com `;` ou quebra de linha quebraria a coluna. */
const esc = (v: string): string => `"${v.replace(/"/g, '""')}"`;

function celula(valor: string | number | null, col: Coluna): string {
  if (valor === null || valor === undefined || valor === "") return '""';
  if (typeof valor === "number") {
    switch (col.tipo) {
      case "dinheiro":
        return esc(dinheiro.format(valor));
      case "inteiro":
        return esc(inteiro.format(valor));
      case "percentual":
        return esc(`${dinheiro.format(valor)}%`);
      default:
        return esc(String(valor));
    }
  }
  return esc(valor);
}

const ICONE: Record<string, string> = {
  critico: "[!] CRITICO",
  atencao: "[!] ATENCAO",
  nota: "[i] NOTA",
};

/**
 * Monta o arquivo completo: cabeçalho com título/período/avisos, a tabela, e o
 * rodapé com os totais.
 *
 * Os avisos ficam ANTES da tabela de propósito. Quem abre a planilha lê o topo
 * primeiro — e o motivo de existirem é justamente alcançar quem não estava na
 * conversa em que o arquivo foi gerado.
 */
export function paraCsv(e: Extracao): string {
  const linhas: string[] = [];

  linhas.push([e.titulo, e.subtitulo ?? "", `gerado em ${new Date().toLocaleString("pt-BR")}`].map(esc).join(";"));

  if (e.avisos.length) {
    linhas.push("");
    for (const a of e.avisos) linhas.push([ICONE[a.nivel] ?? "", a.texto].map(esc).join(";"));
  }

  linhas.push("");
  linhas.push(e.colunas.map((c) => esc(c.titulo)).join(";"));
  for (const l of e.linhas) {
    linhas.push(e.colunas.map((c, i) => celula(l[i] ?? null, c)).join(";"));
  }

  if (e.totais && Object.keys(e.totais).length) {
    linhas.push("");
    for (const [rot, v] of Object.entries(e.totais)) {
      linhas.push([rot, dinheiro.format(v)].map(esc).join(";"));
    }
  }
  linhas.push("");
  linhas.push(esc(`${e.linhas.length} linha(s).`));

  // BOM + CRLF: o par que faz o Excel do Windows abrir sem assistente.
  return "﻿" + linhas.join("\r\n") + "\r\n";
}

/**
 * Nome de arquivo seguro: sem acento, sem espaço, sem caractere que o Windows
 * recuse. `DRE previsto × realizado` → `DRE-previsto-realizado`.
 */
export function nomeArquivo(titulo: string, sufixo: string, ext = "csv"): string {
  const base = titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suf = sufixo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base}${suf ? `-${suf}` : ""}.${ext}`;
}
