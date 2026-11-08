import { useId } from 'react';

export interface SerieGrafico {
  id: string;
  rotulo: string;
  /** Forma + cor: 'contorno' (planejado) e 'solido' (realizado) distinguem as séries sem depender só de cor. */
  estilo: 'contorno' | 'solido' | 'destaque';
}

export interface CategoriaGrafico {
  id: string;
  /** Rótulo curto no eixo ("jan"). */
  rotulo: string;
  /** Rótulo completo na tabela ("janeiro de 2026"). */
  rotuloCompleto: string;
  valores: Record<string, number>;
}

export interface PropsGraficoBarras {
  titulo: string;
  descricao: string;
  series: readonly SerieGrafico[];
  categorias: readonly CategoriaGrafico[];
  formatarValor: (valor: number) => string;
  formatarEixo: (valor: number) => string;
  rotuloCategoria: string;
}

function tetoAgradavel(valor: number): number {
  if (valor <= 0) return 1;
  const potencia = 10 ** Math.floor(Math.log10(valor));
  const normalizado = valor / potencia;
  const passo = normalizado <= 1 ? 1 : normalizado <= 2 ? 2 : normalizado <= 2.5 ? 2.5 : normalizado <= 5 ? 5 : 10;
  return passo * potencia;
}

const LARGURA = 760;
const ALTURA = 300;
const MARGEM = { topo: 16, direita: 12, base: 36, esquerda: 76 };

/**
 * Gráfico de barras agrupadas em SVG próprio (sem biblioteca), acompanhado da tabela equivalente
 * com os mesmos valores — a tabela é a alternativa acessível e também a versão impressa.
 */
export function GraficoBarras({ titulo, descricao, series, categorias, formatarValor, formatarEixo, rotuloCategoria }: PropsGraficoBarras) {
  const base = useId();
  const maximo = tetoAgradavel(Math.max(0, ...categorias.flatMap((c) => series.map((s) => c.valores[s.id] ?? 0))));
  const larguraUtil = LARGURA - MARGEM.esquerda - MARGEM.direita;
  const alturaUtil = ALTURA - MARGEM.topo - MARGEM.base;
  const larguraGrupo = categorias.length > 0 ? larguraUtil / categorias.length : larguraUtil;
  const folgaGrupo = Math.min(18, larguraGrupo * 0.25);
  const larguraBarra = Math.max(4, (larguraGrupo - folgaGrupo) / Math.max(1, series.length));
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maximo);
  const y = (v: number) => MARGEM.topo + alturaUtil - (Math.max(0, v) / maximo) * alturaUtil;

  return (
    <figure className="grafico">
      <div className="grafico__legenda" aria-hidden="true">
        {series.map((s) => (
          <span key={s.id} className="grafico__legenda-item">
            <span className={`grafico__amostra grafico__amostra--${s.estilo}`} />
            {s.rotulo}
          </span>
        ))}
      </div>
      <div className="grafico__area">
        <svg
          viewBox={`0 0 ${LARGURA} ${ALTURA}`}
          className="grafico__svg"
          role="img"
          aria-labelledby={`${base}-titulo ${base}-desc`}
          preserveAspectRatio="xMidYMid meet"
        >
          <title id={`${base}-titulo`}>{titulo}</title>
          <desc id={`${base}-desc`}>{descricao} Os mesmos valores estão na tabela a seguir.</desc>
          {marcas.map((m) => (
            <g key={m}>
              <line x1={MARGEM.esquerda} x2={LARGURA - MARGEM.direita} y1={y(m)} y2={y(m)} className={m === 0 ? 'grafico__eixo' : 'grafico__grade'} />
              <text x={MARGEM.esquerda - 8} y={y(m)} className="grafico__texto-eixo" textAnchor="end" dominantBaseline="middle">
                {formatarEixo(m)}
              </text>
            </g>
          ))}
          {categorias.map((c, i) => {
            const x0 = MARGEM.esquerda + i * larguraGrupo + folgaGrupo / 2;
            return (
              <g key={c.id}>
                {series.map((s, j) => {
                  const valor = c.valores[s.id] ?? 0;
                  const topo = y(valor);
                  const altura = Math.max(0, MARGEM.topo + alturaUtil - topo);
                  return (
                    <rect
                      key={s.id}
                      x={x0 + j * larguraBarra + 1}
                      y={topo}
                      width={Math.max(2, larguraBarra - 2)}
                      height={altura}
                      rx={2}
                      className={`grafico__barra grafico__barra--${s.estilo}`}
                    >
                      <title>{`${s.rotulo} em ${c.rotuloCompleto}: ${formatarValor(valor)}`}</title>
                    </rect>
                  );
                })}
                <text x={x0 + (larguraGrupo - folgaGrupo) / 2} y={ALTURA - MARGEM.base + 18} className="grafico__texto-eixo" textAnchor="middle">
                  {c.rotulo}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="sr-only">{titulo}</figcaption>
      <div className="tabela-rolagem grafico__tabela" role="region" aria-labelledby={`${base}-tabela`} tabIndex={0}>
        <table className="tabela tabela--compacta">
          <caption id={`${base}-tabela`} className="tabela__legenda">
            {titulo} — dados em tabela
          </caption>
          <thead>
            <tr>
              <th scope="col">{rotuloCategoria}</th>
              {series.map((s) => (
                <th key={s.id} scope="col" className="tabela__alinhar--fim">
                  {s.rotulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categorias.map((c) => (
              <tr key={c.id}>
                <th scope="row" className="tabela__celula">
                  {c.rotuloCompleto}
                </th>
                {series.map((s) => (
                  <td key={s.id} className="tabela__celula tabela__alinhar--fim numero">
                    {formatarValor(c.valores[s.id] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

export interface ItemBarraHorizontal {
  id: string;
  rotulo: string;
  valor: number;
  tom: 'erro' | 'critico' | 'aviso' | 'alerta' | 'info' | 'sucesso';
  detalhe?: string;
}

/**
 * Barras horizontais em SVG com rótulo e valor em texto visível em cada linha (a própria lista é a
 * alternativa textual; as barras são decorativas para leitores de tela).
 */
export function BarrasHorizontais({ itens, formatarValor, rotulo }: { itens: readonly ItemBarraHorizontal[]; formatarValor: (v: number) => string; rotulo: string }) {
  const maximo = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <ul className="barras-horizontais" aria-label={rotulo}>
      {itens.map((item) => (
        <li key={item.id} className="barras-horizontais__item">
          <span className="barras-horizontais__rotulo">
            {item.rotulo}
            {item.detalhe ? <span className="barras-horizontais__detalhe">{item.detalhe}</span> : null}
          </span>
          <svg className="barras-horizontais__svg" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <rect x="0" y="0" width="100" height="10" rx="2" className="barras-horizontais__trilho" />
            <rect x="0" y="0" width={Math.max(item.valor > 0 ? 1.5 : 0, (item.valor / maximo) * 100)} height="10" rx="2" className={`barras-horizontais__barra barras-horizontais__barra--${item.tom}`} />
          </svg>
          <span className="barras-horizontais__valor numero">{formatarValor(item.valor)}</span>
        </li>
      ))}
    </ul>
  );
}
