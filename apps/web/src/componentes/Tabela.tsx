import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, LoaderCircle } from 'lucide-react';
import { gravarPreferencia, lerListaPreferencia, lerPreferencia } from '../utilitarios/preferencias';
import { Esqueleto } from './Esqueleto';

export type Densidade = 'alta' | 'padrao' | 'baixa';
const DENSIDADES: readonly { valor: Densidade; rotulo: string }[] = [
  { valor: 'alta', rotulo: 'Alta (compacta)' },
  { valor: 'padrao', rotulo: 'Padrão' },
  { valor: 'baixa', rotulo: 'Baixa (espaçada)' },
];

export interface Ordenacao {
  por: string;
  ordem: 'asc' | 'desc';
}

export interface ColunaTabela<T> {
  id: string;
  cabecalho: string;
  celula: (linha: T) => ReactNode;
  /** Ordenável pelo servidor (`ordenarPor=id`) ou localmente se houver `valorOrdenacao`. */
  ordenavel?: boolean;
  valorOrdenacao?: (linha: T) => string | number | null;
  alinhamento?: 'inicio' | 'fim' | 'centro';
  /** Aparece no cartão em telas estreitas. */
  prioritaria?: boolean;
  /** Não pode ser ocultada no seletor de colunas. */
  fixa?: boolean;
  ocultaPorPadrao?: boolean;
  /** Primeira coluna identificadora: vira `<th scope="row">`. */
  identificadora?: boolean;
  larguraMinima?: string;
}

export interface PropsTabela<T> {
  /** Identificador estável (preferência de colunas). */
  id: string;
  legenda: string;
  colunas: readonly ColunaTabela<T>[];
  linhas: readonly T[] | undefined;
  chave: (linha: T) => string;
  carregando?: boolean;
  /** Recarregando em segundo plano: mantém os dados e sinaliza. */
  atualizando?: boolean;
  /** Ordenação controlada (servidor, via URL). */
  ordenacao?: Ordenacao;
  aoOrdenar?: (ordenacao: Ordenacao) => void;
  /** Ordenação local inicial (listas sem paginação no servidor). */
  ordenacaoInicial?: Ordenacao;
  /** Conteúdo exibido quando não há linhas. */
  vazio?: ReactNode;
  /** Coluna de ações (sempre visível, por último). */
  acoes?: { cabecalho?: string; celula: (linha: T) => ReactNode };
  rodape?: ReactNode;
  /** Elementos extras na barra de ferramentas (ex.: Exportar CSV). */
  ferramentas?: ReactNode;
  semFerramentas?: boolean;
  destaque?: (linha: T) => 'erro' | 'aviso' | 'sucesso' | undefined;
  linhasEsqueleto?: number;
}

function lerDensidade(): Densidade {
  const v = lerPreferencia('densidade');
  return v === 'alta' || v === 'baixa' ? v : 'padrao';
}

function comparar(a: string | number | null, b: string | number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
}

/**
 * Tabela semântica (`<caption>`, `scope`, `aria-sort`), ordenável, com densidade e seletor de colunas.
 * Abaixo de 768 px cada linha vira um cartão com os campos prioritários (papéis ARIA preservados).
 */
export function Tabela<T>({
  id,
  legenda,
  colunas,
  linhas,
  chave,
  carregando,
  atualizando,
  ordenacao,
  aoOrdenar,
  ordenacaoInicial,
  vazio,
  acoes,
  rodape,
  ferramentas,
  semFerramentas,
  destaque,
  linhasEsqueleto = 6,
}: PropsTabela<T>) {
  const base = useId();
  const [densidade, definirDensidade] = useState<Densidade>(lerDensidade);
  const [ocultas, definirOcultas] = useState<string[]>(() => {
    const salvas = lerListaPreferencia(`colunas:${id}`);
    if (salvas.length > 0) return salvas.filter((c) => c !== '-');
    return colunas.filter((c) => c.ocultaPorPadrao).map((c) => c.id);
  });
  const [ordemLocal, definirOrdemLocal] = useState<Ordenacao | undefined>(ordenacaoInicial);
  const [seletorAberto, definirSeletorAberto] = useState(false);
  const seletorRef = useRef<HTMLDivElement>(null);
  const botaoSeletorRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!seletorAberto) return;
    const aoClicar = (e: MouseEvent) => {
      if (seletorRef.current && e.target instanceof Node && !seletorRef.current.contains(e.target)) definirSeletorAberto(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        definirSeletorAberto(false);
        botaoSeletorRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', aoClicar);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicar);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [seletorAberto]);

  const controlada = aoOrdenar !== undefined;
  const ordemAtual = controlada ? ordenacao : ordemLocal;

  const visiveis = colunas.filter((c) => c.fixa || !ocultas.includes(c.id));

  const linhasOrdenadas = useMemo(() => {
    if (!linhas) return undefined;
    if (controlada || !ordemLocal) return linhas;
    const coluna = colunas.find((c) => c.id === ordemLocal.por);
    const extrair = coluna?.valorOrdenacao;
    if (!extrair) return linhas;
    const fator = ordemLocal.ordem === 'asc' ? 1 : -1;
    return [...linhas].sort((a, b) => fator * comparar(extrair(a), extrair(b)));
  }, [linhas, controlada, ordemLocal, colunas]);

  const alternarOrdem = (coluna: ColunaTabela<T>) => {
    const nova: Ordenacao =
      ordemAtual?.por === coluna.id ? { por: coluna.id, ordem: ordemAtual.ordem === 'asc' ? 'desc' : 'asc' } : { por: coluna.id, ordem: 'asc' };
    if (controlada) aoOrdenar(nova);
    else definirOrdemLocal(nova);
  };

  const mudarDensidade = (d: Densidade) => {
    definirDensidade(d);
    gravarPreferencia('densidade', d === 'padrao' ? null : d);
  };

  const alternarColuna = (idColuna: string) => {
    const novas = ocultas.includes(idColuna) ? ocultas.filter((c) => c !== idColuna) : [...ocultas, idColuna];
    definirOcultas(novas);
    gravarPreferencia(`colunas:${id}`, novas.length > 0 ? novas.join(',') : '-');
  };

  const idLegenda = `${base}-legenda`;
  const semLinhas = linhasOrdenadas !== undefined && linhasOrdenadas.length === 0;
  const mostrarEsqueleto = linhasOrdenadas === undefined || (carregando && linhasOrdenadas === undefined);
  const totalColunas = visiveis.length + (acoes ? 1 : 0);

  const ariaSort = (coluna: ColunaTabela<T>): 'ascending' | 'descending' | 'none' | undefined => {
    if (!coluna.ordenavel) return undefined;
    if (ordemAtual?.por !== coluna.id) return 'none';
    return ordemAtual.ordem === 'asc' ? 'ascending' : 'descending';
  };

  return (
    <div className={`tabela-bloco tabela-bloco--${densidade}`}>
      {semFerramentas ? null : (
        <div className="tabela-ferramentas">
          <div className="tabela-ferramentas__extra">{ferramentas}</div>
          <div className="tabela-ferramentas__preferencias">
            {atualizando ? (
              <span className="tabela-ferramentas__atualizando" role="status">
                <LoaderCircle className="botao__giro" size={14} aria-hidden="true" /> Atualizando…
              </span>
            ) : null}
            <label className="tabela-ferramentas__densidade">
              <span>Densidade</span>
              <select value={densidade} onChange={(e) => mudarDensidade(DENSIDADES.find((d) => d.valor === e.target.value)?.valor ?? 'padrao')}>
                {DENSIDADES.map((d) => (
                  <option key={d.valor} value={d.valor}>
                    {d.rotulo}
                  </option>
                ))}
              </select>
            </label>
            <div className="seletor-colunas" ref={seletorRef}>
              <button
                ref={botaoSeletorRef}
                type="button"
                className="botao botao--terciario botao--compacto"
                aria-expanded={seletorAberto}
                aria-controls={`${base}-colunas`}
                onClick={() => definirSeletorAberto((v) => !v)}
              >
                <Columns3 size={16} aria-hidden="true" />
                <span>Colunas</span>
              </button>
              {seletorAberto ? (
                <fieldset id={`${base}-colunas`} className="seletor-colunas__painel">
                  <legend>Colunas visíveis</legend>
                  {colunas.map((c) => (
                    <label key={c.id} className="seletor-colunas__opcao">
                      <input
                        type="checkbox"
                        checked={c.fixa || !ocultas.includes(c.id)}
                        disabled={c.fixa}
                        onChange={() => alternarColuna(c.id)}
                      />
                      <span>{c.cabecalho}</span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {semLinhas ? (
        <div className="tabela-vazia">
          <p className="sr-only" id={idLegenda}>
            {legenda}
          </p>
          {vazio}
        </div>
      ) : (
        <div className="tabela-rolagem" role="region" aria-labelledby={idLegenda} tabIndex={0}>
          <table className="tabela" role="table" aria-busy={mostrarEsqueleto || atualizando || undefined}>
            <caption id={idLegenda} className="tabela__legenda">
              {legenda}
            </caption>
            <thead role="rowgroup">
              <tr role="row">
                {visiveis.map((c) => (
                  <th
                    key={c.id}
                    role="columnheader"
                    scope="col"
                    aria-sort={ariaSort(c)}
                    className={`tabela__cabecalho tabela__alinhar--${c.alinhamento ?? 'inicio'}`}
                    style={c.larguraMinima ? { minWidth: c.larguraMinima } : undefined}
                  >
                    {c.ordenavel ? (
                      <button type="button" className="tabela__ordenar" onClick={() => alternarOrdem(c)}>
                        <span>{c.cabecalho}</span>
                        {ordemAtual?.por === c.id ? (
                          ordemAtual.ordem === 'asc' ? (
                            <ArrowUp size={14} aria-hidden="true" />
                          ) : (
                            <ArrowDown size={14} aria-hidden="true" />
                          )
                        ) : (
                          <ArrowUpDown size={14} aria-hidden="true" className="tabela__ordenar-inativo" />
                        )}
                      </button>
                    ) : (
                      c.cabecalho
                    )}
                  </th>
                ))}
                {acoes ? (
                  <th role="columnheader" scope="col" className="tabela__cabecalho tabela__alinhar--fim">
                    {acoes.cabecalho ?? 'Ações'}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {mostrarEsqueleto
                ? Array.from({ length: linhasEsqueleto }, (_, l) => (
                    <tr key={`esq-${l}`} role="row" className="tabela__linha tabela__linha--esqueleto">
                      {Array.from({ length: totalColunas }, (_, c) => (
                        <td key={c} role="cell">
                          <Esqueleto largura={`${50 + (((l + 1) * (c + 2) * 11) % 45)}%`} />
                        </td>
                      ))}
                    </tr>
                  ))
                : linhasOrdenadas?.map((linha) => {
                    const tomLinha = destaque?.(linha);
                    return (
                      <tr key={chave(linha)} role="row" className={['tabela__linha', tomLinha ? `tabela__linha--${tomLinha}` : ''].filter(Boolean).join(' ')}>
                        {visiveis.map((c) => {
                          const classe = [
                            'tabela__celula',
                            `tabela__alinhar--${c.alinhamento ?? 'inicio'}`,
                            c.prioritaria || c.identificadora ? 'tabela__celula--prioritaria' : 'tabela__celula--secundaria',
                            c.identificadora ? 'tabela__celula--identificadora' : '',
                          ]
                            .filter(Boolean)
                            .join(' ');
                          return c.identificadora ? (
                            <th key={c.id} role="rowheader" scope="row" className={classe} data-rotulo={c.cabecalho}>
                              {c.celula(linha)}
                            </th>
                          ) : (
                            <td key={c.id} role="cell" className={classe} data-rotulo={c.cabecalho}>
                              {c.celula(linha)}
                            </td>
                          );
                        })}
                        {acoes ? (
                          <td role="cell" className="tabela__celula tabela__celula--acoes tabela__alinhar--fim" data-rotulo={acoes.cabecalho ?? 'Ações'}>
                            {acoes.celula(linha)}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      )}
      {rodape ? <div className="tabela-rodape">{rodape}</div> : null}
    </div>
  );
}
