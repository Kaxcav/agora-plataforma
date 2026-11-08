/**
 * `/qualidade-normativa` — Painel de qualidade normativa (RIA-14): IMR-02, o percentual de minutas geradas com
 * citações fiéis à Lei 14.133/2021 (meta de 100%), a série dos últimos meses, as citações apontadas e a conferência
 * de um texto colado. Tudo calculado no servidor, com a base normativa da Ágora; requer revisão humana.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { BadgeCheck, FileCheck, FileWarning, Files, ListChecks, ScanSearch } from 'lucide-react';
import type { PainelQualidadeNormativa } from '@agora/contratos';
import { useConferirTexto, usePainelQualidade } from '../../api/iaAncorada';
import { AreaTexto, Botao, CampoTexto, ConteudoConsulta, EstadoVazio, Etiqueta, Indicador, ListaDefinicoes, Pagina, Secao, Tabela, type TomEtiqueta } from '../../componentes';
import { contar, formatarInstante, formatarMesLongo, formatarNumero } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { CampoUasg } from '../compartilhado/CampoUasg';
import { TIPOS_DOCUMENTO } from '../jornada/rotulos';
import { ApoioResultado, EtiquetaCitacao, ListaCitacoesApontadas, ProvenienciaBase } from './comum';

type LinhaSerie = PainelQualidadeNormativa['serie'][number];

const SITUACAO_IMR: Record<LinhaSerie['situacao'], { rotulo: string; tom: TomEtiqueta }> = {
  atingida: { rotulo: 'Meta atingida', tom: 'sucesso' },
  abaixo: { rotulo: 'Abaixo da meta', tom: 'erro' },
  sem_minutas: { rotulo: 'Sem minutas', tom: 'neutro' },
};

function percentual(valor: number | null): string {
  return valor === null ? '—' : `${formatarNumero(valor)}%`;
}

function ConteudoQualidade({ painel }: { painel: PainelQualidadeNormativa }) {
  const { imr02 } = painel;
  const tom = imr02.situacao === 'atingida' ? 'sucesso' : imr02.situacao === 'abaixo' ? 'erro' : 'neutro';
  return (
    <div className="pilha pilha--ampla">
      <section aria-labelledby="indicadores-qualidade" className="pilha pilha--compacta">
        <h2 id="indicadores-qualidade" className="sr-only">
          Indicadores de {formatarMesLongo(painel.mes)}
        </h2>
        <div className="grade grade--kpi">
          <Indicador rotulo="IMR-02 no mês" valor={percentual(imr02.percentual)} detalhe={`Meta: ${painel.meta}% · ${SITUACAO_IMR[imr02.situacao].rotulo}`} tom={tom} icone={BadgeCheck} />
          <Indicador rotulo="Minutas conferidas" valor={formatarNumero(imr02.total)} detalhe={formatarMesLongo(painel.mes)} tom="info" icone={Files} />
          <Indicador rotulo="Minutas com citações fiéis" valor={formatarNumero(imr02.fieis)} detalhe="Sem citação inexistente, vetada ou suspeita" tom="sucesso" icone={FileCheck} />
          <Indicador
            rotulo="Citações apontadas"
            valor={formatarNumero(painel.apontamentos.length)}
            detalhe="Para revisão humana"
            tom={painel.apontamentos.length > 0 ? 'aviso' : 'sucesso'}
            icone={FileWarning}
          />
          <Indicador
            rotulo="Estrutura do modelo padronizado"
            valor={`${formatarNumero(painel.estrutura.completos)} de ${formatarNumero(painel.estrutura.conferidos)}`}
            detalhe="Com todas as seções obrigatórias (art. 19, IV)"
            tom={painel.estrutura.completos === painel.estrutura.conferidos ? 'sucesso' : 'aviso'}
            icone={ListChecks}
          />
        </div>
      </section>

      <Tabela<LinhaSerie>
        id="qualidade-serie"
        legenda="IMR-02 nos últimos 6 meses"
        colunas={[
          { id: 'mes', cabecalho: 'Mês', celula: (l) => formatarMesLongo(l.mes), identificadora: true, prioritaria: true },
          { id: 'total', cabecalho: 'Minutas', celula: (l) => formatarNumero(l.total), alinhamento: 'fim' },
          { id: 'fieis', cabecalho: 'Fiéis', celula: (l) => formatarNumero(l.fieis), alinhamento: 'fim' },
          { id: 'imr', cabecalho: 'IMR-02', celula: (l) => percentual(l.percentual), alinhamento: 'fim', prioritaria: true },
          {
            id: 'situacao',
            cabecalho: 'Situação',
            celula: (l) => (
              <Etiqueta tom={SITUACAO_IMR[l.situacao].tom} compacta>
                {SITUACAO_IMR[l.situacao].rotulo}
              </Etiqueta>
            ),
          },
        ]}
        linhas={painel.serie}
        chave={(l) => l.mes}
        semFerramentas
      />

      <div className="grade grade--2">
        <Secao titulo="Por documento" id="qualidade-tipos" descricao={`Minutas geradas em ${formatarMesLongo(painel.mes)}.`}>
          {painel.porTipo.length === 0 ? (
            <EstadoVazio icone={Files} titulo="Nenhuma minuta gerada no mês" />
          ) : (
            <ListaDefinicoes colunas={2} itens={painel.porTipo.map((t) => ({ termo: t.rotulo, valor: `${t.fieis} de ${t.total} com citações fiéis` }))} />
          )}
        </Secao>
        <Secao titulo="Por origem do texto" id="qualidade-origem" descricao="Modelo de texto determinístico ou redação com a IA auto-hospedada do órgão.">
          <ListaDefinicoes
            colunas={2}
            itens={painel.porOrigem.map((o) => ({
              termo: o.origem === 'ia' ? 'IA auto-hospedada' : 'Modelo de texto (sem IA)',
              valor: o.total === 0 ? 'Nenhuma minuta' : `${o.fieis} de ${o.total} com citações fiéis`,
            }))}
          />
        </Secao>
      </div>

      <Secao titulo="Citações apontadas no mês" id="qualidade-apontamentos" descricao="Citação inexistente, de dispositivo vetado ou revogado, ou cujo assunto não confere com o dispositivo citado.">
        {painel.apontamentos.length === 0 ? (
          <EstadoVazio icone={BadgeCheck} titulo="Nenhuma citação apontada" descricao="Todas as citações das minutas do mês conferem com a base normativa." />
        ) : (
          <ul className="lista-sinais">
            {painel.apontamentos.map((a, n) => (
              <li key={`${a.documentoId}-${n}`}>
                <span className="lista-sinais__titulo">
                  <Link to={a.processo.caminho}>{a.processo.identificador}</Link> · {TIPOS_DOCUMENTO[a.tipoDocumento].rotulo}, versão {a.versao}
                </span>
                <span className="linha">
                  <EtiquetaCitacao situacao={a.situacao} />
                  {a.revisado ? (
                    <Etiqueta tom="info" compacta>
                      Revisão registrada
                    </Etiqueta>
                  ) : null}
                </span>
                <div className="lista-sinais__corpo">
                  <p>
                    <span className="mono">{a.trecho}</span> — {a.motivo}
                  </p>
                  {a.sugestao ? <p className="texto-pequeno">{a.sugestao}</p> : null}
                  <p className="trecho-citado texto-pequeno texto-secundario">Trecho: “{a.contexto}”</p>
                  <p className="texto-pequeno texto-secundario">
                    Gerado em {formatarInstante(a.geradoEm)} por {a.geradoPor === 'ia' ? 'IA auto-hospedada' : 'modelo de texto'}.
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao titulo="Base normativa usada na conferência" id="qualidade-base" simples>
        <ProvenienciaBase norma={painel.base.norma} proveniencia={painel.base.proveniencia} />
      </Secao>

      <ApoioResultado premissas={painel.premissas} fontes={painel.fontes} aviso={painel.aviso} geradoEm={painel.geradoEm} />
    </div>
  );
}

/** Conferência de um texto colado (minuta externa, parecer ou rascunho): nada é gravado. */
function ConferirTexto() {
  const conferir = useConferirTexto();
  const [texto, definirTexto] = useState('');
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (texto.trim().length > 0) conferir.mutate(texto);
  };
  const resultado = conferir.data;
  const apontadas = resultado?.citacoes.filter((c) => c.situacao !== 'confere' && c.situacao !== 'outra_norma') ?? [];
  return (
    <Secao titulo="Conferir as citações de um texto" id="qualidade-conferir" descricao="Cole um trecho de minuta, parecer ou edital. A Ágora confere cada citação da Lei 14.133/2021 na base normativa; o texto não é gravado.">
      <form className="pilha pilha--compacta" onSubmit={enviar}>
        <AreaTexto rotulo="Texto a conferir" value={texto} maxLength={100_000} onChange={(e) => definirTexto(e.target.value)} rows={6} />
        <div>
          <Botao type="submit" variante="primario" icone={ScanSearch} carregando={conferir.isPending} disabled={texto.trim().length === 0}>
            Conferir citações
          </Botao>
        </div>
      </form>
      {conferir.isError ? <p className="texto-pequeno">Não foi possível conferir o texto agora. Tente novamente.</p> : null}
      {resultado ? (
        <div className="pilha pilha--compacta" role="status">
          <p className="linha">
            <Etiqueta tom={resultado.fiel ? 'sucesso' : resultado.bloqueantes > 0 ? 'erro' : 'aviso'} compacta>
              {resultado.fiel ? 'Citações fiéis' : contar(apontadas.length, 'citação apontada', 'citações apontadas')}
            </Etiqueta>
            <span className="texto-pequeno texto-secundario">
              {contar(resultado.total, 'citação encontrada', 'citações encontradas')}: {resultado.conferem} conferem, {resultado.outrasNormas} de outras normas.
            </span>
          </p>
          {apontadas.length > 0 ? <ListaCitacoesApontadas citacoes={apontadas} /> : null}
          <p className="texto-pequeno texto-secundario">{resultado.aviso}</p>
        </div>
      ) : null}
    </Secao>
  );
}

export default function QualidadeNormativa() {
  const p = useParametrosUrl();
  const mes = p.texto('mes');
  const uasg = p.texto('uasg');
  const consulta = usePainelQualidade({ mes, uasg });
  return (
    <Pagina
      titulo="Qualidade normativa"
      subtitulo="IMR-02: percentual de minutas geradas com citações fiéis à Lei 14.133/2021 (meta de 100%), conferidas pelo servidor na base normativa da Ágora."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="normas.qualidade"
    >
      <div className="pilha pilha--ampla">
        <div className="painel-filtro">
          <div className="painel-filtro__campo">
            <CampoTexto
              rotulo="Mês de referência"
              type="month"
              value={mes ?? consulta.data?.mes ?? ''}
              onChange={(e) => p.atualizar({ mes: /^\d{4}-\d{2}$/.test(e.target.value) ? e.target.value : undefined })}
            />
          </div>
          <div className="painel-filtro__campo">
            <CampoUasg valor={uasg} aoMudar={(v) => p.atualizar({ uasg: v })} />
          </div>
        </div>
        <ConteudoConsulta consulta={consulta} rotuloCarregando="Calculando o IMR-02" tituloErro="Não foi possível calcular a qualidade normativa">
          {(painel) => <ConteudoQualidade painel={painel} />}
        </ConteudoConsulta>
        <ConferirTexto />
      </div>
    </Pagina>
  );
}
