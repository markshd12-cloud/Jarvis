import { InteractiveLineChart } from "@/components/charts/interactive-line";
import type { DetalheCanal, Fatia } from "@/lib/marketing/youtube-analytics";

import { YoutubeAnalyticsControles } from "./youtube-analytics-controles";

/**
 * Dados do dono do canal (YouTube Analytics API) — o que a leitura pública não
 * enxerga.
 *
 * O contraste com o painel público logo abaixo é o ponto da tela: lá o CPPEM
 * aparece com "387 mil" imóvel; aqui o mesmo período mostra quantos entraram,
 * quantos saíram, por onde chegaram e até onde assistiram.
 */
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

function tempo(min: number): string {
  if (min >= 60) return `${int.format(Math.round(min / 60))} h`;
  return `${int.format(min)} min`;
}

/** Segundos → "3:42". Duração média assistida por visualização. */
function mmss(seg: number): string {
  const m = Math.floor(seg / 60);
  return `${m}:${String(Math.round(seg - m * 60)).padStart(2, "0")}`;
}

function dataCurta(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

// ============================ PEÇAS ======================================= //

function Kpi({
  rotulo,
  valor,
  apoio,
  tom,
}: {
  rotulo: string;
  valor: string;
  apoio?: string;
  tom?: "bom" | "ruim";
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-card p-3">
      <span className="text-[11px] text-muted-foreground">{rotulo}</span>
      <span
        className={
          tom === "bom"
            ? "text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400"
            : tom === "ruim"
              ? "text-xl font-semibold tabular-nums text-destructive"
              : "text-xl font-semibold tabular-nums"
        }
      >
        {valor}
      </span>
      {apoio ? (
        <span className="text-[11px] text-muted-foreground tabular-nums">{apoio}</span>
      ) : null}
    </div>
  );
}

/**
 * Ranking em barras proporcionais ao maior valor.
 *
 * Barra em vez de rosca porque a pergunta aqui é "quais são os maiores e em que
 * ordem", e comprimento se compara melhor do que ângulo — sobretudo com 16
 * origens de tráfego, onde a rosca viraria confete.
 */
function Ranking({
  itens,
  total,
  sufixo,
}: {
  itens: Fatia[];
  total?: number;
  sufixo?: (f: Fatia) => string;
}) {
  if (itens.length === 0)
    return <p className="text-xs text-muted-foreground">Sem dados no período.</p>;
  const max = Math.max(...itens.map((i) => i.views), 1);
  const soma = total ?? itens.reduce((s, i) => s + i.views, 0);
  return (
    <ul className="flex flex-col gap-1.5">
      {itens.map((f) => (
        <li key={f.rotulo} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate" title={f.rotulo}>
              {f.rotulo}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {sufixo ? sufixo(f) : int.format(f.views)}
              {soma > 0 ? ` · ${((f.views / soma) * 100).toFixed(1)}%` : ""}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(f.views / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Bloco({
  titulo,
  ajuda,
  children,
  className,
}: {
  titulo: string;
  ajuda?: string;
  children: React.ReactNode;
  className?: string;
}) {
  /**
   * `div`, NUNCA `section`. No `globals.css` deste projeto `section` é camada
   * ESTRUTURAL de página (`grid min-h-full justify-items-center px-4`, ver
   * agents/AGENTS.md) — uma por página, envolvendo `div.sectionbox`.
   *
   * Usar `section` para desenhar cartão fazia cada bloco herdar
   * `min-height: 100%` e esticar por mais de mil pixels, com o conteúdo seguinte
   * indo parar embaixo. Foi exatamente o "espaço cinza enorme" reportado.
   */
  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border border-border bg-card p-4 ${className ?? ""}`}
    >
      <div>
        <h4 className="text-sm font-semibold">{titulo}</h4>
        {ajuda ? <p className="text-[11px] text-muted-foreground">{ajuda}</p> : null}
      </div>
      {children}
    </div>
  );
}

// ============================ PAINEL ====================================== //

export function YoutubeAnalyticsPanel({
  detalhe,
  canais,
  dias,
}: {
  detalhe: DetalheCanal;
  canais: { channelId: string; titulo: string }[];
  dias: number;
}) {
  const r = detalhe.resumo;
  const cresceu = r.liquido >= 0;

  // O gráfico usa escala independente por série (o componente já faz isso), o que
  // permite pôr views na casa dos milhares junto de saldo de inscritos na casa
  // das dezenas sem uma achatar a outra.
  const pontos = detalhe.serie.map((p) => ({
    label: dataCurta(p.data),
    values: { views: p.views, liquido: p.liquido, minutos: p.minutos },
  }));

  /**
   * As 8 maiores origens, e o resto somado numa linha só.
   *
   * O canal tem 16 origens, e a cauda (hashtags, tela final, cards) some perto
   * de Shorts e busca — 16 barras minúsculas cansam sem informar. Somar em vez
   * de cortar mantém os percentuais honestos: a linha "Outras origens" diz
   * quantas foram agrupadas, então nada desaparece sem aviso.
   */
  const trafegoTop = (() => {
    const t = detalhe.trafego;
    if (t.length <= 9) return t;
    const cauda = t.slice(8);
    return [
      ...t.slice(0, 8),
      {
        rotulo: `Outras origens (${cauda.length})`,
        views: cauda.reduce((s, f) => s + f.views, 0),
      },
    ];
  })();

  const totalFormato = detalhe.formatos.reduce((s, f) => s + f.views, 0);
  const totalInscritos = detalhe.inscritos.reduce((s, f) => s + f.views, 0);
  const maxDemo = Math.max(
    1,
    ...detalhe.demografia.map((d) => Math.max(d.masculino, d.feminino)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Dados do dono do canal</h3>
          <p className="text-xs text-muted-foreground">
            Números exatos, sem o arredondamento da leitura pública.{" "}
            {detalhe.janela.inicio.split("-").reverse().join("/")} a{" "}
            {detalhe.janela.fim.split("-").reverse().join("/")}.
          </p>
        </div>
        <YoutubeAnalyticsControles
          canais={canais}
          canalAtual={detalhe.channelId}
          dias={dias}
        />
      </div>

      {/* ------------------------------ KPIs ------------------------------ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi
          rotulo="Inscritos (líquido)"
          valor={`${cresceu ? "+" : "−"}${int.format(Math.abs(r.liquido))}`}
          apoio={`${int.format(r.ganhos)} ganhos · ${int.format(r.perdidos)} perdidos`}
          tom={cresceu ? "bom" : "ruim"}
        />
        <Kpi rotulo="Visualizações" valor={int.format(r.views)} />
        <Kpi
          rotulo="Tempo de exibição"
          valor={tempo(r.minutosAssistidos)}
          apoio={`média ${mmss(r.duracaoMedia)} por view`}
        />
        <Kpi
          rotulo="Retenção média"
          valor={r.retencao == null ? "—" : `${r.retencao.toFixed(1)}%`}
          apoio="do vídeo assistido"
        />
        <Kpi
          rotulo="Engajamento"
          valor={int.format(r.likes + r.comentarios + r.compartilhamentos)}
          apoio={`${int.format(r.likes)} likes · ${int.format(r.comentarios)} coment.`}
        />
        {/* Receita só aparece quando existe. Canal não monetizado devolve
            `rows: []`, e um "R$ 0,00" cravado sugeriria monetização com
            desempenho nulo — que é uma afirmação diferente e falsa. */}
        {r.receita != null ? (
          <Kpi
            rotulo="Receita estimada"
            valor={r.receita.toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            })}
            apoio="no período"
          />
        ) : (
          <Kpi
            rotulo="Compartilhamentos"
            valor={int.format(r.compartilhamentos)}
            apoio={`${int.format(r.playlists)} salvos em playlist`}
          />
        )}
      </div>

      {/* ---------------------------- EVOLUÇÃO ---------------------------- */}
      {pontos.length > 1 ? (
        <Bloco
          titulo="Dia a dia"
          ajuda="Views e saldo de inscritos têm escalas próprias — clique na legenda para isolar uma série. A série termina ~2 dias antes de hoje: o YouTube ainda não consolidou os últimos dias, e eles não vêm na resposta."
        >
          <InteractiveLineChart
            points={pontos}
            legend
            ariaLabel={`Evolução diária de ${detalhe.marca}`}
            series={[
              { key: "views", label: "Views", color: "#ef4444", area: true, format: "int" },
              { key: "minutos", label: "Minutos assistidos", color: "#6366f1", dashed: true, format: "int" },
              { key: "liquido", label: "Saldo de inscritos", color: "#10b981", format: "int" },
            ]}
          />
        </Bloco>
      ) : null}

      {/* ---------------------------- FORMATOS ---------------------------- */}
      {detalhe.formatos.length > 0 ? (
        <Bloco
          titulo="Shorts, vídeos e lives"
          ajuda="Onde estão as views e onde está o tempo assistido — quase nunca no mesmo lugar."
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {detalhe.formatos.map((f) => (
              <div
                key={f.tipo}
                className="flex flex-col gap-1 rounded-lg border border-border/60 p-3"
              >
                <span className="text-xs font-medium">{f.tipo}</span>
                <span className="text-lg font-semibold tabular-nums">
                  {int.format(f.views)}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {totalFormato > 0
                    ? `${((f.views / totalFormato) * 100).toFixed(1)}% das views`
                    : "—"}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {tempo(f.minutos)} · {f.ganhos >= 0 ? "+" : ""}
                  {int.format(f.ganhos)} inscritos
                </span>
              </div>
            ))}
          </div>
        </Bloco>
      ) : null}

      {/* --------------------------- TOP VÍDEOS --------------------------- */}
      {detalhe.topVideos.length > 0 ? (
        <Bloco
          titulo="Mais vistos no período"
          ajuda="Ordenado por views. A retenção e os inscritos ganhos dizem quais realmente trabalharam pelo canal."
        >
          <ul className="flex flex-col divide-y divide-border">
            {detalhe.topVideos.map((v, i) => (
              <li key={v.videoId} className="flex items-center gap-3 py-2">
                <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                {v.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={v.thumb}
                    alt=""
                    className="h-9 w-16 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="h-9 w-16 shrink-0 rounded bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <a
                    href={v.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="line-clamp-1 text-xs font-medium hover:underline"
                    title={v.titulo}
                  >
                    {v.titulo}
                  </a>
                  <span className="text-[11px] text-muted-foreground">
                    {v.isShort ? "Short" : "Vídeo"}
                    {v.publicadoEm
                      ? ` · ${new Date(v.publicadoEm).toLocaleDateString("pt-BR")}`
                      : ""}
                  </span>
                </div>
                <div className="hidden shrink-0 text-right sm:block">
                  <span className="block text-xs font-medium tabular-nums">
                    {int.format(v.views)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">views</span>
                </div>
                <div className="hidden shrink-0 text-right sm:block">
                  <span className="block text-xs font-medium tabular-nums">
                    {v.retencao == null ? "—" : `${v.retencao.toFixed(0)}%`}
                  </span>
                  <span className="text-[11px] text-muted-foreground">retenção</span>
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={
                      v.ganhos > 0
                        ? "block text-xs font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
                        : "block text-xs font-medium tabular-nums text-muted-foreground"
                    }
                  >
                    {v.ganhos > 0 ? "+" : ""}
                    {int.format(v.ganhos)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">inscritos</span>
                </div>
              </li>
            ))}
          </ul>
        </Bloco>
      ) : null}

      {/* ------------------------ TRÁFEGO E BUSCA -------------------------
          `items-start` em TODA grade daqui para baixo: sem ele o CSS Grid estica
          cada cartão até a altura do mais alto, e o de conteúdo menor vira um
          bloco cinza com um vazio enorme embaixo. Tráfego tem 16 linhas, busca
          tem 10 — a diferença aparecia como buraco. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Bloco
          titulo="De onde vêm as views"
          ajuda="Origem do tráfego. Shorts e busca costumam disputar o topo — mas entregam tempos de exibição muito diferentes."
        >
          <Ranking itens={trafegoTop} />
        </Bloco>

        <Bloco
          titulo="O que pesquisaram para chegar aqui"
          ajuda="Termos digitados na busca do YouTube. É a pauta que o público está pedindo."
        >
          <Ranking itens={detalhe.buscas} />
        </Bloco>
      </div>

      {/* ---------------------------- PÚBLICO ----------------------------- */}
      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Bloco
          titulo="Idade e gênero"
          ajuda="% das visualizações de espectadores identificados."
          className="sm:col-span-2"
        >
          {detalhe.demografia.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem dados no período.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {detalhe.demografia.map((d) => (
                <li key={d.faixa} className="flex items-center gap-2 text-xs">
                  <span className="w-12 shrink-0 tabular-nums text-muted-foreground">
                    {d.faixa}
                  </span>
                  <div className="flex flex-1 items-center gap-1">
                    <div className="flex h-2 flex-1 justify-end overflow-hidden rounded-l-full bg-muted">
                      <div
                        className="h-full rounded-l-full bg-sky-500"
                        style={{ width: `${(d.masculino / maxDemo) * 100}%` }}
                      />
                    </div>
                    <div className="flex h-2 flex-1 overflow-hidden rounded-r-full bg-muted">
                      <div
                        className="h-full rounded-r-full bg-pink-500"
                        style={{ width: `${(d.feminino / maxDemo) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                    {d.masculino.toFixed(0)}% / {d.feminino.toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">
            <span className="text-sky-500">■</span> masculino{" "}
            <span className="text-pink-500">■</span> feminino
          </p>
        </Bloco>

        <Bloco titulo="Dispositivo" ajuda="Onde o conteúdo é consumido.">
          <Ranking itens={detalhe.dispositivos} />
        </Bloco>

        <Bloco titulo="País" ajuda="Origem geográfica das visualizações.">
          <Ranking itens={detalhe.paises} />
        </Bloco>

        {/* Bloco próprio: antes ele carregava TAMBÉM a lista de países, ficava o
            dobro da altura dos vizinhos e esticava a linha inteira. */}
        <Bloco
          titulo="Inscritos × não inscritos"
          ajuda="Alcance novo ou público de casa?"
          className="sm:col-span-2 lg:col-span-1"
        >
          <Ranking
            itens={detalhe.inscritos}
            total={totalInscritos}
            sufixo={(f) => `${int.format(f.views)} · ${tempo(f.minutos ?? 0)}`}
          />
        </Bloco>
      </div>
    </div>
  );
}
