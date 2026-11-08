/**
 * Renderizador de Markdown restrito e seguro para os documentos gerados: títulos, parágrafos, listas,
 * tabelas, citações, separadores, negrito, itálico e código em linha. Produz elementos React (o texto é
 * sempre escapado); não interpreta HTML nem links e omite comentários HTML (marcadores internos dos documentos).
 */
import { Fragment, type ReactNode } from 'react';

type Alinhamento = 'inicio' | 'centro' | 'fim';

type Bloco =
  | { tipo: 'titulo'; nivel: number; texto: string }
  | { tipo: 'paragrafo'; texto: string }
  | { tipo: 'lista'; ordenada: boolean; inicio: number; itens: string[] }
  | { tipo: 'tabela'; cabecalho: string[]; alinhamentos: Alinhamento[]; linhas: string[][] }
  | { tipo: 'citacao'; texto: string }
  | { tipo: 'separador' };

const TITULO = /^(#{1,6})\s+(.+?)\s*#*$/;
const SEPARADOR = /^(?:-{3,}|\*{3,}|_{3,})$/;
const ITEM_NAO_ORDENADO = /^[-*+]\s+(.*)$/;
const ITEM_ORDENADO = /^(\d{1,4})[.)]\s+(.*)$/;
const LINHA_ALINHAMENTO = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;

function celulas(linha: string): string[] {
  let conteudo = linha.trim();
  if (conteudo.startsWith('|')) conteudo = conteudo.slice(1);
  if (conteudo.endsWith('|') && !conteudo.endsWith('\\|')) conteudo = conteudo.slice(0, -1);
  return conteudo.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function alinhamento(celula: string): Alinhamento {
  const esquerda = celula.startsWith(':');
  const direita = celula.endsWith(':');
  if (esquerda && direita) return 'centro';
  if (direita) return 'fim';
  return 'inicio';
}

function iniciaBloco(linha: string, proxima: string | undefined): boolean {
  return (
    TITULO.test(linha) ||
    SEPARADOR.test(linha) ||
    ITEM_NAO_ORDENADO.test(linha) ||
    ITEM_ORDENADO.test(linha) ||
    linha.startsWith('>') ||
    (linha.startsWith('|') && proxima !== undefined && LINHA_ALINHAMENTO.test(proxima.trim()))
  );
}

/** Comentários HTML (marcadores internos como `<!-- situacao -->` e `<!-- protegido:… -->`) não são exibidos. */
const COMENTARIO_HTML = /<!--[\s\S]*?-->/g;

function analisarBlocos(markdown: string): Bloco[] {
  const linhas = markdown.replace(/\r\n?/g, '\n').replace(COMENTARIO_HTML, '').split('\n');
  const blocos: Bloco[] = [];
  let i = 0;
  while (i < linhas.length) {
    const atual = (linhas[i] ?? '').trim();
    if (atual === '') {
      i += 1;
      continue;
    }

    const titulo = TITULO.exec(atual);
    if (titulo) {
      blocos.push({ tipo: 'titulo', nivel: (titulo[1] ?? '#').length, texto: titulo[2] ?? '' });
      i += 1;
      continue;
    }

    if (SEPARADOR.test(atual)) {
      blocos.push({ tipo: 'separador' });
      i += 1;
      continue;
    }

    const proxima = linhas[i + 1];
    if (atual.startsWith('|') && proxima !== undefined && LINHA_ALINHAMENTO.test(proxima.trim())) {
      const cabecalho = celulas(atual);
      const alinhamentos = celulas(proxima).map(alinhamento);
      const corpo: string[][] = [];
      i += 2;
      while (i < linhas.length && (linhas[i] ?? '').trim().startsWith('|')) {
        corpo.push(celulas(linhas[i] ?? ''));
        i += 1;
      }
      blocos.push({ tipo: 'tabela', cabecalho, alinhamentos, linhas: corpo });
      continue;
    }

    const naoOrdenado = ITEM_NAO_ORDENADO.exec(atual);
    const ordenado = ITEM_ORDENADO.exec(atual);
    if (naoOrdenado || ordenado) {
      const ehOrdenada = !naoOrdenado;
      const itens: string[] = [];
      const inicio = ordenado ? Number(ordenado[1]) : 1;
      while (i < linhas.length) {
        const linha = (linhas[i] ?? '').trim();
        if (linha === '') {
          const seguinte = (linhas[i + 1] ?? '').trim();
          const continua = ehOrdenada ? ITEM_ORDENADO.test(seguinte) : ITEM_NAO_ORDENADO.test(seguinte);
          if (!continua) break;
          i += 1;
          continue;
        }
        const item = ehOrdenada ? ITEM_ORDENADO.exec(linha) : ITEM_NAO_ORDENADO.exec(linha);
        if (item) {
          itens.push((ehOrdenada ? item[2] : item[1]) ?? '');
        } else if (iniciaBloco(linha, linhas[i + 1])) {
          break;
        } else if (itens.length > 0) {
          itens[itens.length - 1] = `${itens[itens.length - 1] ?? ''} ${linha}`;
        }
        i += 1;
      }
      blocos.push({ tipo: 'lista', ordenada: ehOrdenada, inicio, itens });
      continue;
    }

    if (atual.startsWith('>')) {
      const partes: string[] = [];
      while (i < linhas.length && (linhas[i] ?? '').trim().startsWith('>')) {
        partes.push((linhas[i] ?? '').trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocos.push({ tipo: 'citacao', texto: partes.join(' ') });
      continue;
    }

    const partes: string[] = [atual];
    i += 1;
    while (i < linhas.length) {
      const linha = (linhas[i] ?? '').trim();
      if (linha === '' || iniciaBloco(linha, linhas[i + 1])) break;
      partes.push(linha);
      i += 1;
    }
    blocos.push({ tipo: 'paragrafo', texto: partes.join(' ') });
  }
  return blocos;
}

const EM_LINHA = /\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\*(?=\S)(.+?)(?<=\S)\*/g;

/** Negrito (`**` ou `__`), itálico (`*`) e código em linha; o restante é texto puro. */
function emLinha(texto: string, prefixo: string): ReactNode[] {
  const nos: ReactNode[] = [];
  let ultimo = 0;
  let indice = 0;
  for (const encontrado of texto.matchAll(EM_LINHA)) {
    const posicao = encontrado.index;
    if (posicao > ultimo) nos.push(texto.slice(ultimo, posicao));
    const chave = `${prefixo}-${indice}`;
    const [, negrito, negritoAlternativo, codigo, italico] = encontrado;
    if (negrito !== undefined || negritoAlternativo !== undefined) {
      nos.push(<strong key={chave}>{emLinha(negrito ?? negritoAlternativo ?? '', chave)}</strong>);
    } else if (codigo !== undefined) {
      nos.push(<code key={chave}>{codigo}</code>);
    } else if (italico !== undefined) {
      nos.push(<em key={chave}>{emLinha(italico, chave)}</em>);
    }
    ultimo = posicao + encontrado[0].length;
    indice += 1;
  }
  if (ultimo < texto.length) nos.push(texto.slice(ultimo));
  return nos;
}

const NIVEIS_TITULO = ['h3', 'h4', 'h5', 'h6'] as const;
type NivelTitulo = 3 | 4 | 5 | 6;

function tagTitulo(base: NivelTitulo, nivel: number): (typeof NIVEIS_TITULO)[number] {
  const alvo = Math.min(6, base + nivel - 1);
  return NIVEIS_TITULO[alvo - 3] ?? 'h6';
}

const CLASSE_ALINHAMENTO: Record<Alinhamento, string> = {
  inicio: '',
  centro: 'tabela__alinhar--centro',
  fim: 'tabela__alinhar--fim',
};

export interface PropsMarkdown {
  conteudo: string;
  /** Nível HTML do `#` do documento, para manter a hierarquia de títulos da página. */
  nivelInicial?: NivelTitulo;
  /** Nome acessível da tabela quando o documento não traz título antes dela. */
  rotuloTabelas?: string;
}

export function Markdown({ conteudo, nivelInicial = 4, rotuloTabelas = 'Tabela do documento' }: PropsMarkdown) {
  const blocos = analisarBlocos(conteudo);
  return (
    <div className="markdown">
      {blocos.map((bloco, i) => {
        const chave = `b${i}`;
        switch (bloco.tipo) {
          case 'titulo': {
            const Tag = tagTitulo(nivelInicial, bloco.nivel);
            return (
              <Tag key={chave} className={`markdown__titulo markdown__titulo--${Math.min(bloco.nivel, 4)}`}>
                {emLinha(bloco.texto, chave)}
              </Tag>
            );
          }
          case 'paragrafo':
            return <p key={chave}>{emLinha(bloco.texto, chave)}</p>;
          case 'citacao':
            return <blockquote key={chave}>{emLinha(bloco.texto, chave)}</blockquote>;
          case 'separador':
            return <hr key={chave} />;
          case 'lista':
            return bloco.ordenada ? (
              <ol key={chave} start={bloco.inicio}>
                {bloco.itens.map((item, j) => (
                  <li key={j}>{emLinha(item, `${chave}-${j}`)}</li>
                ))}
              </ol>
            ) : (
              <ul key={chave}>
                {bloco.itens.map((item, j) => (
                  <li key={j}>{emLinha(item, `${chave}-${j}`)}</li>
                ))}
              </ul>
            );
          case 'tabela':
            return (
              <div key={chave} className="tabela-rolagem markdown__tabela" role="region" aria-label={rotuloTabelas} tabIndex={0}>
                <table className="tabela tabela--compacta">
                  <thead>
                    <tr>
                      {bloco.cabecalho.map((c, j) => (
                        <th key={j} scope="col" className={CLASSE_ALINHAMENTO[bloco.alinhamentos[j] ?? 'inicio']}>
                          {emLinha(c, `${chave}-c${j}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bloco.linhas.map((linha, l) => (
                      <tr key={l}>
                        {bloco.cabecalho.map((_, j) => (
                          <td key={j} className={CLASSE_ALINHAMENTO[bloco.alinhamentos[j] ?? 'inicio']}>
                            {emLinha(linha[j] ?? '', `${chave}-${l}-${j}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <Fragment key={chave} />;
        }
      })}
    </div>
  );
}
