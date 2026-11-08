/**
 * `/base-normativa` — Consulta à base normativa soberana (RNF-08): busca na Lei 14.133/2021 (BM25 no próprio
 * servidor, sem serviço externo), visualização do artigo estruturado e estrutura dos modelos padronizados.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpenText, Search } from 'lucide-react';
import type { ArtigoLeiApi, IncisoLeiApi } from '@agora/contratos';
import { useArtigoLei, useBuscaNormas, useModelosPadronizados, useResumoBaseNormativa } from '../../api/iaAncorada';
import { Botao, CampoTexto, ConteudoConsulta, EstadoVazio, Etiqueta, Pagina, Secao } from '../../componentes';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { ProvenienciaBase } from './comum';

function Incisos({ incisos }: { incisos: readonly IncisoLeiApi[] }) {
  return (
    <>
      {incisos.map((i) => (
        <div key={i.numero} className="artigo-lei__inciso">
          <p>
            <span className="artigo-lei__rotulo">{i.numero} –</span> {i.texto}
          </p>
          {i.alineas.map((a) => (
            <p key={a.letra} className="artigo-lei__alinea">
              <span className="artigo-lei__rotulo">{a.letra})</span> {a.texto}
            </p>
          ))}
        </div>
      ))}
    </>
  );
}

function TextoArtigo({ artigo, aoNavegar }: { artigo: ArtigoLeiApi; aoNavegar: (numero: string) => void }) {
  const rotulo = artigo.rotulo.replace(/^art/, 'Art');
  return (
    <Secao
      titulo={`${rotulo} da ${artigo.norma}`}
      id="artigo"
      descricao={artigo.titulos.join(' › ')}
      acoes={
        <span className="linha">
          {artigo.anterior ? (
            <Botao tamanho="compacto" variante="terciario" icone={ArrowLeft} onClick={() => aoNavegar(artigo.anterior ?? '')}>
              Artigo anterior
            </Botao>
          ) : null}
          {artigo.proximo ? (
            <Botao tamanho="compacto" variante="terciario" iconeFim={ArrowRight} onClick={() => aoNavegar(artigo.proximo ?? '')}>
              Próximo artigo
            </Botao>
          ) : null}
        </span>
      }
    >
      <article className="artigo-lei" aria-label={`Texto do ${artigo.rotulo}`}>
        <p>
          <span className="artigo-lei__rotulo">{rotulo}</span> {artigo.caput}
        </p>
        <Incisos incisos={artigo.incisos} />
        {artigo.paragrafos.map((p) => (
          <div key={p.numero} className="pilha pilha--compacta">
            <p>
              <span className="artigo-lei__rotulo">{p.numero === 'unico' ? 'Parágrafo único.' : p.rotulo}</span> {p.texto}
            </p>
            <Incisos incisos={p.incisos} />
          </div>
        ))}
        {artigo.textoAlterador.length > 0 ? (
          <div className="trecho-citado texto-pequeno texto-secundario">
            <p>Texto que este artigo insere em outra lei (não é dispositivo da {artigo.norma}):</p>
            {artigo.textoAlterador.map((linha, n) => (
              <p key={n}>{linha}</p>
            ))}
          </div>
        ) : null}
      </article>
    </Secao>
  );
}

function Resultados({ consulta, aoAbrir }: { consulta: string; aoAbrir: (numero: string) => void }) {
  const busca = useBuscaNormas(consulta);
  return (
    <ConteudoConsulta consulta={busca} rotuloCarregando="Buscando na lei" tituloErro="Não foi possível buscar na lei">
      {(r) =>
        r.resultados.length === 0 ? (
          <EstadoVazio titulo="Nenhum artigo encontrado" descricao="Tente outras palavras ou informe o número do artigo (ex.: art. 75)." />
        ) : (
          <ul className="lista-sinais" aria-label={`Resultados da busca por ${r.consulta}`}>
            {r.resultados.map((item) => (
              <li key={item.artigo}>
                <span className="lista-sinais__titulo">
                  {item.rotulo.replace(/^art/, 'Art')}
                  {item.divisao ? <span className="texto-secundario texto-pequeno"> · {item.divisao}</span> : null}
                </span>
                <span className="linha">
                  {item.exato ? (
                    <Etiqueta tom="info" compacta>
                      Artigo pedido
                    </Etiqueta>
                  ) : null}
                  <Botao tamanho="compacto" icone={BookOpenText} onClick={() => aoAbrir(item.artigo)}>
                    Ler o {item.rotulo}
                  </Botao>
                </span>
                <div className="lista-sinais__corpo">
                  {item.trechos.map((t) => (
                    <p key={t.referencia} className="texto-pequeno">
                      <span className="texto-forte">{t.referencia}:</span> {t.texto}
                    </p>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )
      }
    </ConteudoConsulta>
  );
}

export default function BaseNormativa() {
  const p = useParametrosUrl();
  const consulta = p.texto('q') ?? '';
  const numero = p.texto('art') ?? null;
  const [texto, definirTexto] = useState(consulta);
  useEffect(() => definirTexto(consulta), [consulta]);
  const resumo = useResumoBaseNormativa();
  const modelos = useModelosPadronizados();
  const artigo = useArtigoLei(numero);

  const buscar = (e: FormEvent) => {
    e.preventDefault();
    p.atualizar({ q: texto.trim() || undefined, art: undefined });
  };
  const abrir = (n: string) => p.atualizar({ art: n });

  return (
    <Pagina
      titulo="Base normativa"
      subtitulo="Texto oficial da Lei 14.133/2021 guardado na Ágora, estruturado por artigo, parágrafo, inciso e alínea. A busca roda no próprio servidor, sem serviço externo."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="normas.base"
    >
      <div className="pilha pilha--ampla">
        <form className="busca-normas" role="search" aria-label="Buscar na lei" onSubmit={buscar}>
          <CampoTexto
            rotulo="Buscar na Lei 14.133/2021"
            ajuda="Palavras do assunto (ex.: dispensa de licitação) ou o número do artigo (ex.: art. 75)."
            value={texto}
            maxLength={200}
            onChange={(e) => definirTexto(e.target.value)}
          />
          <Botao type="submit" variante="primario" icone={Search}>
            Buscar
          </Botao>
        </form>

        {numero ? (
          <ConteudoConsulta
            consulta={artigo}
            rotuloCarregando="Carregando o artigo"
            tituloErro="Não foi possível abrir o artigo"
            naoEncontrado={{ titulo: 'Artigo não encontrado', descricao: 'Confira o número do artigo.' }}
          >
            {(a) => <TextoArtigo artigo={a} aoNavegar={abrir} />}
          </ConteudoConsulta>
        ) : null}

        {consulta ? (
          <Secao titulo="Resultados" id="resultados" descricao="Ordenados por relevância. O artigo pedido pelo número vem primeiro.">
            <Resultados consulta={consulta} aoAbrir={abrir} />
          </Secao>
        ) : null}

        <Secao
          titulo="Modelos padronizados: seções obrigatórias"
          id="modelos"
          descricao="Estrutura que a lei exige de cada documento (art. 19, IV). Os rascunhos da Ágora são conferidos contra ela; o texto dos modelos de terceiros não é copiado."
        >
          <ConteudoConsulta consulta={modelos} rotuloCarregando="Carregando os modelos" tituloErro="Não foi possível carregar os modelos">
            {(lista) => (
              <div className="pilha pilha--compacta">
                {lista.map((m) => (
                  <details key={m.tipo}>
                    <summary>
                      {m.documento} — {m.fundamento} ({m.secoes.length} seções)
                    </summary>
                    <ol className="texto-pequeno">
                      {m.secoes.map((s) => (
                        <li key={s.id}>
                          {s.titulo} <span className="texto-secundario">({s.fundamento})</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                ))}
              </div>
            )}
          </ConteudoConsulta>
        </Secao>

        <ConteudoConsulta consulta={resumo} rotuloCarregando="Carregando a base normativa" tituloErro="Não foi possível carregar a base normativa">
          {(r) => (
            <>
              <Secao titulo="Estrutura da lei" id="estrutura" descricao={`${r.norma.titulo} — ${r.norma.ementa} ${r.totalArtigos} artigos.`}>
                <ul className="lista-sinais">
                  {r.divisoes.map((d) => (
                    <li key={`${d.titulo}-${d.primeiroArtigo}`}>
                      <span className="lista-sinais__titulo">{d.titulo}</span>
                      <Botao tamanho="compacto" variante="terciario" onClick={() => abrir(d.primeiroArtigo)}>
                        Arts. {d.primeiroArtigo} a {d.ultimoArtigo}
                      </Botao>
                    </li>
                  ))}
                </ul>
              </Secao>
              <Secao titulo="Origem do texto" id="origem" simples>
                <ProvenienciaBase norma={r.norma.titulo} proveniencia={r.proveniencia} />
              </Secao>
            </>
          )}
        </ConteudoConsulta>
      </div>
    </Pagina>
  );
}
