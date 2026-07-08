import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/**
 * Renderiza Markdown (GFM) das respostas do Jarvis com o visual do app.
 * Sem isto, o texto do Claude apareceria cru (#, *, | literais). Tabelas
 * ganham borda — são os "quadrados organizados" das respostas ricas.
 *
 * Além do Markdown, aceita um VOCABULÁRIO VISUAL seguro via diretivas
 * (`remark-directive`) para respostas mais elaboradas — cards em grade e
 * blocos de destaque —, mapeadas para componentes React estilizados. Não
 * renderizamos HTML cru do modelo (evita XSS e layout quebrado); só estes
 * blocos controlados e on-brand.
 *
 * Regra do remark-directive: o container EXTERNO precisa de MAIS dois-pontos
 * que o interno. A grade usa QUATRO (::::), os cards internos TRÊS (:::).
 *
 *   ::::cards           (grade responsiva — 4 dois-pontos)
 *     :::card           (cartão com borda; título vem como ### dentro)
 *       ### Dores
 *       - ...
 *     :::
 *   ::::
 *
 *   :::callout          (bloco de destaque — resumo/dica)
 *     Texto importante.
 *   :::
 */

// Diretivas que viram componentes (o resto de `:::` é ignorado como texto).
const DIRECTIVE_NAMES = new Set(["cards", "card", "callout"]);

type MdNode = {
  type: string;
  name?: string;
  /** Nome da tag no HAST (o `node` que o react-markdown passa aos componentes). */
  tagName?: string;
  attributes?: Record<string, string> | null;
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  children?: MdNode[];
};

/**
 * Converte os nós de diretiva (`containerDirective`) em elementos com nome
 * próprio (`hName`) para o react-markdown renderizar via `components`.
 * Plugin remark minimalista — sem dependências extras.
 */
function remarkJarvisDirectives() {
  return (tree: MdNode) => {
    const walk = (node: MdNode) => {
      if (
        (node.type === "containerDirective" || node.type === "leafDirective") &&
        node.name &&
        DIRECTIVE_NAMES.has(node.name)
      ) {
        node.data = node.data ?? {};
        node.data.hName = node.name;
        node.data.hProperties = {};
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

/** Um parágrafo só de dois-pontos (':::') = marcador de diretiva vazado. */
function isStrayDirectiveMarker(children: ReactNode): boolean {
  const text =
    typeof children === "string"
      ? children
      : Array.isArray(children) && children.every((c) => typeof c === "string")
        ? children.join("")
        : "";
  return /^\s*:{2,}[a-z]*\s*$/i.test(text) && text.trim().length > 0;
}

// Tags que geram elementos de BLOCO (`<div>` etc.). Se um parágrafo contém
// qualquer uma, não podemos envolver em `<p>` (HTML inválido → hydration error):
// acontece quando o modelo cola uma diretiva (callout/card/cards) num parágrafo.
const BLOCK_TAGS = new Set([
  "cards",
  "card",
  "callout",
  "div",
  "pre",
  "table",
  "ul",
  "ol",
  "blockquote",
  "hr",
  "h1",
  "h2",
  "h3",
]);

function containsBlockChild(node: MdNode | undefined): boolean {
  return (
    node?.children?.some(
      (child) => child.type === "element" && BLOCK_TAGS.has(child.tagName ?? ""),
    ) ?? false
  );
}

const components = {
  h1: ({ children }: { children?: ReactNode }) => (
    <h1 className="mt-4 mb-2 text-lg font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  p: ({ children, node }: { children?: ReactNode; node?: MdNode }) => {
    if (isStrayDirectiveMarker(children)) return null;
    // Se o parágrafo contém um bloco (ex.: diretiva colada ao texto), não envolve
    // em <p> — evita "<div> cannot be a descendant of <p>" (erro de hydration).
    if (containsBlockChild(node)) return <>{children}</>;
    return <p className="my-2 first:mt-0 last:mb-0">{children}</p>;
  },
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => (
    <em className="italic">{children}</em>
  ),
  a: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  // Imagens (ex.: geradas pelo Imagen, entregues como ![](url)).
  img: ({ src, alt }: { src?: string; alt?: string }) =>
    typeof src === "string" ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt ?? "imagem"}
        className="my-2 max-w-full rounded-xl border border-border first:mt-0 last:mb-0"
      />
    ) : null,
  code: ({
    className,
    children,
  }: {
    className?: string;
    children?: ReactNode;
  }) => {
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) {
      return (
        <code className="block font-mono text-xs leading-relaxed">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="my-2 overflow-x-auto rounded-lg border border-border bg-muted p-3 first:mt-0 last:mb-0">
      {children}
    </pre>
  ),
  // Tabelas GFM: os "quadrados" organizados das respostas do Claude.
  table: ({ children }: { children?: ReactNode }) => (
    <div className="my-2 overflow-x-auto first:mt-0 last:mb-0">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className="bg-muted">{children}</thead>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="border border-border px-2.5 py-1.5 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="border border-border px-2.5 py-1.5 align-top">{children}</td>
  ),

  // --- Vocabulário visual (diretivas) -------------------------------------
  // Grade responsiva de cartões: 1 coluna no mobile, 2 a partir de sm.
  cards: ({ children }: { children?: ReactNode }) => (
    <div className="my-3 grid gap-3 first:mt-0 last:mb-0 sm:grid-cols-2">
      {children}
    </div>
  ),
  // Cartão com borda arredondada (título vem como ### dentro do bloco).
  card: ({ children }: { children?: ReactNode }) => (
    <div className="rounded-xl border border-border bg-card/60 p-4 shadow-sm">
      {children}
    </div>
  ),
  // Bloco de destaque com barra de acento na cor da marca.
  callout: ({ children }: { children?: ReactNode }) => (
    <div className="my-3 rounded-lg border border-border border-l-4 border-l-primary bg-muted/40 px-4 py-3 first:mt-0 last:mb-0">
      {children}
    </div>
  ),
} as Components;

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("text-sm leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkJarvisDirectives]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
