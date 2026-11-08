import { Link } from 'react-router';
import { CalendarCheck } from 'lucide-react';
import type { FaixaVencimento, VencimentoLinhaTempo } from '@agora/contratos';
import { adicionarDias, formatarData } from '@agora/dominio';
import { useLinhaTempoVencimentos } from '../../api/notificacoes';
import { EsqueletoTexto, EstadoVazio, Etiqueta, FalhaConsulta, Secao, type TomEtiqueta } from '../../componentes';
import { contar } from '../../utilitarios/formatacao';
import '../../design/paginas-notificacoes.css';

const FAIXAS: readonly { faixa: FaixaVencimento; rotulo: string; providencia: string; tom: TomEtiqueta; classe: string }[] = [
  { faixa: 30, rotulo: 'Até 30 dias', providencia: 'Formalizar a prorrogação ou garantir a continuidade', tom: 'critico', classe: 'critico' },
  { faixa: 60, rotulo: '31 a 60 dias', providencia: 'Concluir a instrução da prorrogação', tom: 'aviso', classe: 'atencao' },
  { faixa: 90, rotulo: '61 a 90 dias', providencia: 'Instruir a prorrogação ou a nova contratação', tom: 'alerta', classe: 'alerta' },
  { faixa: 120, rotulo: '91 a 120 dias', providencia: 'Avaliar a prorrogação ou planejar nova contratação', tom: 'info', classe: 'planejamento' },
];
const ITENS_POR_FAIXA = 6;
/** 12 intervalos: 0–10 dias e, depois, de 10 em 10 até 120 (3 por faixa do semáforo). */
const INTERVALOS = Array.from({ length: 12 }, (_, i) => ({ de: i === 0 ? 0 : i * 10 + 1, ate: (i + 1) * 10 }));

function caminho(i: VencimentoLinhaTempo): string {
  return `/${i.tipo === 'ata' ? 'atas' : 'contratos'}/${i.id}`;
}

function classeDoIntervalo(indice: number): string {
  return FAIXAS[Math.floor(indice / 3)]?.classe ?? 'planejamento';
}

/** Histograma decorativo dos vencimentos por intervalo de 10 dias; as listas por faixa são a alternativa textual. */
function Eixo({ hoje, instrumentos }: { hoje: string; instrumentos: readonly VencimentoLinhaTempo[] }) {
  const contagens = INTERVALOS.map((intervalo) => instrumentos.filter((i) => i.diasRestantes >= intervalo.de && i.diasRestantes <= intervalo.ate).length);
  const maximo = Math.max(1, ...contagens);
  return (
    <div className="ltv-eixo" aria-hidden="true">
      <div className="ltv-eixo__barras">
        {contagens.map((n, indice) => (
          <div key={indice} className="ltv-eixo__coluna">
            <span className="ltv-eixo__valor numero">{n > 0 ? n : ''}</span>
            <span
              className={`ltv-eixo__barra ltv-eixo__barra--${classeDoIntervalo(indice)}`}
              style={{ height: n > 0 ? `${Math.max(6, (n / maximo) * 100)}%` : '0' }}
            />
          </div>
        ))}
      </div>
      <div className="ltv-eixo__faixas">
        {FAIXAS.map((f) => (
          <span key={f.faixa} className={`ltv-eixo__faixa ltv-eixo__faixa--${f.classe}`}>
            {f.rotulo}
          </span>
        ))}
      </div>
      <div className="ltv-eixo__datas numero">
        {[0, 30, 60, 90, 120].map((dias) => (
          <span key={dias}>{dias === 0 ? 'Hoje' : formatarData(adicionarDias(hoje, dias)).slice(0, 5)}</span>
        ))}
      </div>
    </div>
  );
}

/** Linha do tempo dos vencimentos de contratos e atas nos próximos 120 dias (RN-31), por faixa do semáforo. */
export function LinhaTempoVencimentos({ uasg }: { uasg?: string }) {
  const consulta = useLinhaTempoVencimentos(uasg);
  const dados = consulta.data;
  return (
    <Secao
      id="linha-tempo-vencimentos"
      titulo="Linha do tempo de vencimentos"
      descricao="Contratos e atas que vencem nos próximos 120 dias, nas faixas do semáforo 30/60/90/120. Cada faixa gera um aviso automático ao gestor e ao fiscal."
    >
      {consulta.isError && !dados ? (
        <FalhaConsulta consulta={consulta} titulo="Não foi possível carregar a linha do tempo" />
      ) : !dados ? (
        <div aria-busy="true">
          <EsqueletoTexto linhas={5} />
        </div>
      ) : dados.instrumentos.length === 0 ? (
        <EstadoVazio icone={CalendarCheck} titulo="Nenhum vencimento nos próximos 120 dias" descricao="Não há atas ou contratos com fim de vigência até 120 dias a partir de hoje." />
      ) : (
        <div className="pilha">
          <Eixo hoje={dados.hoje} instrumentos={dados.instrumentos} />
          <div className="ltv-faixas">
            {FAIXAS.map((f) => {
              const itens = dados.instrumentos.filter((i) => i.faixa === f.faixa);
              const idTitulo = `ltv-faixa-${f.faixa}`;
              return (
                <section key={f.faixa} className={`ltv-faixa ltv-faixa--${f.classe}`} aria-labelledby={idTitulo}>
                  <h3 id={idTitulo} className="ltv-faixa__titulo">
                    <span>{f.rotulo}</span>
                    <Etiqueta tom={f.tom} compacta>
                      {contar(itens.length, 'instrumento', 'instrumentos')}
                    </Etiqueta>
                  </h3>
                  <p className="texto-pequeno texto-secundario">{f.providencia}.</p>
                  {itens.length === 0 ? (
                    <p className="texto-pequeno texto-secundario">Nenhum vencimento nesta faixa.</p>
                  ) : (
                    <ol className="ltv-faixa__lista">
                      {itens.slice(0, ITENS_POR_FAIXA).map((i) => (
                        <li key={`${i.tipo}-${i.id}`}>
                          <Link to={caminho(i)}>{i.identificador}</Link>
                          <span className="texto-pequeno texto-secundario">
                            fim em <span className="numero">{formatarData(i.vigenciaFim)}</span> ({contar(i.diasRestantes, 'dia', 'dias')})
                          </span>
                          <span className="ltv-faixa__objeto texto-pequeno" title={i.objeto}>
                            {i.objeto}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {itens.length > ITENS_POR_FAIXA ? (
                    <p className="texto-pequeno texto-secundario">e mais {contar(itens.length - ITENS_POR_FAIXA, 'instrumento', 'instrumentos')} nesta faixa.</p>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </Secao>
  );
}
