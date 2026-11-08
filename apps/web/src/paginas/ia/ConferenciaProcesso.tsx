/**
 * `/jornada/:id/conferencia` — Conferência dos documentos do processo: divergências entre DFD, ETP, matriz de riscos,
 * nota técnica, TR, edital e minuta (RIA-15) e a conferência das citações legais de cada documento (RIA-14).
 * Sinais calculados pelo servidor: a correção é feita gerando nova versão do documento, por decisão da equipe.
 */
import { useParams } from 'react-router';
import { ArrowLeft, GitCompareArrows } from 'lucide-react';
import type { CitacoesDocumento, ConferenciaCruzadaApi } from '@agora/contratos';
import { useCitacoesProcesso, useConferenciaCruzada } from '../../api/iaAncorada';
import { useProcesso } from '../../api/jornada';
import { Alerta, ConteudoConsulta, EstadoVazio, Etiqueta, EsqueletoTexto, LinkBotao, Pagina, Secao, Tabela } from '../../componentes';
import { contar, formatarInstante } from '../../utilitarios/formatacao';
import { SITUACOES_DOCUMENTO, TIPOS_DOCUMENTO } from '../jornada/rotulos';
import { ApoioResultado, ListaCitacoesApontadas } from './comum';

type Aspecto = ConferenciaCruzadaApi['aspectos'][number];
type Ocorrencia = ConferenciaCruzadaApi['divergencias'][number]['ocorrencias'][number];

function ConteudoCruzada({ r }: { r: ConferenciaCruzadaApi }) {
  return (
    <div className="pilha">
      {r.documentos.length < 2 ? (
        <EstadoVazio icone={GitCompareArrows} titulo="Poucos documentos para comparar" descricao="A conferência cruzada precisa de ao menos dois documentos gerados no processo." />
      ) : r.consistente ? (
        <Alerta tipo="sucesso" compacto titulo="Nenhuma divergência entre os documentos">
          <p>Os dados comparados são os mesmos em todos os documentos conferidos.</p>
        </Alerta>
      ) : (
        <Alerta tipo="aviso" compacto titulo={`${contar(r.divergencias.length, 'divergência encontrada', 'divergências encontradas')} entre os documentos`}>
          <p>Confira os trechos de cada documento e gere nova versão do documento que estiver errado.</p>
        </Alerta>
      )}
      <Tabela<Aspecto>
        id="conferencia-aspectos"
        legenda="Dados comparados entre os documentos"
        colunas={[
          { id: 'aspecto', cabecalho: 'Dado', celula: (a) => a.rotulo, identificadora: true, prioritaria: true },
          { id: 'comparacoes', cabecalho: 'Comparações', celula: (a) => String(a.comparacoes), alinhamento: 'fim' },
          {
            id: 'divergencias',
            cabecalho: 'Divergências',
            prioritaria: true,
            celula: (a) =>
              a.comparacoes === 0 ? (
                <span className="texto-secundario">Sem dado em dois documentos</span>
              ) : (
                <Etiqueta tom={a.divergencias > 0 ? 'erro' : 'sucesso'} compacta>
                  {a.divergencias > 0 ? contar(a.divergencias, 'divergência', 'divergências') : 'Confere'}
                </Etiqueta>
              ),
          },
        ]}
        linhas={r.aspectos}
        chave={(a) => a.aspecto}
        semFerramentas
      />
      {r.divergencias.map((d) => (
        <Tabela<Ocorrencia>
          key={d.chave}
          id={`divergencia-${d.chave.replace(/[^a-z0-9]/gi, '-')}`}
          legenda={d.titulo}
          colunas={[
            { id: 'documento', cabecalho: 'Documento', celula: (o) => `${o.documento} (versão ${o.versao})`, identificadora: true, prioritaria: true },
            { id: 'valor', cabecalho: 'Valor no documento', celula: (o) => <span className="texto-forte">{o.valor}</span>, prioritaria: true },
            { id: 'trecho', cabecalho: 'Trecho', celula: (o) => <span className="texto-pequeno">{o.trecho}</span> },
          ]}
          linhas={d.ocorrencias}
          chave={(o) => `${o.tipo}-${o.versao}-${o.valor}`}
          semFerramentas
          rodape={<span className="texto-pequeno texto-secundario">Fundamento: {d.fundamento}</span>}
        />
      ))}
      <ApoioResultado premissas={r.premissas} fontes={r.fontes} aviso={r.aviso} geradoEm={r.geradoEm} />
    </div>
  );
}

/** Versão mais recente de cada documento, com o resultado da conferência das citações. */
function CitacoesPorDocumento({ lista }: { lista: readonly CitacoesDocumento[] }) {
  const recentes = new Map<string, CitacoesDocumento>();
  for (const c of lista) {
    const atual = recentes.get(c.tipo);
    if (!atual || c.versao > atual.versao) recentes.set(c.tipo, c);
  }
  const documentos = [...recentes.values()];
  if (documentos.length === 0) return <EstadoVazio titulo="Nenhum documento gerado" descricao="Gere os rascunhos nas etapas da jornada." />;
  return (
    <ul className="lista-sinais">
      {documentos.map((d) => {
        const apontadas = d.conferencia.citacoes.filter((c) => c.situacao !== 'confere' && c.situacao !== 'outra_norma');
        return (
          <li key={d.documentoId}>
            <span className="lista-sinais__titulo">
              {TIPOS_DOCUMENTO[d.tipo].rotulo} — versão {d.versao}{' '}
              <span className="texto-pequeno texto-secundario">({SITUACOES_DOCUMENTO[d.situacao].rotulo.toLowerCase()})</span>
            </span>
            <Etiqueta tom={d.conferencia.fiel ? 'sucesso' : d.conferencia.bloqueantes > 0 ? 'erro' : 'aviso'} compacta>
              {d.conferencia.fiel ? 'Citações fiéis' : contar(apontadas.length, 'citação apontada', 'citações apontadas')}
            </Etiqueta>
            <div className="lista-sinais__corpo">
              <p className="texto-pequeno texto-secundario">
                {contar(d.conferencia.total, 'citação encontrada', 'citações encontradas')}
                {d.estrutura.aplicavel ? ` · estrutura do modelo: ${d.estrutura.presentes} de ${d.estrutura.total} seções` : ''}
                {d.revisao ? ` · revisão registrada por ${d.revisao.revisadoPor.nome} em ${formatarInstante(d.revisao.revisadoEm)}` : ''}
              </p>
              {apontadas.length > 0 ? <ListaCitacoesApontadas citacoes={apontadas} /> : null}
              {d.aprovacaoBloqueada ? (
                <p className="texto-pequeno">Aprovação bloqueada até a revisão das citações: abra o documento na etapa da jornada e registre a revisão.</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function ConferenciaProcesso() {
  const { id = '' } = useParams();
  const processo = useProcesso(id);
  const cruzada = useConferenciaCruzada(id);
  const citacoes = useCitacoesProcesso(id, 'conferencia');
  const naoEncontrado = { titulo: 'Processo não encontrado', descricao: 'O processo não existe ou está fora das UASGs do seu escopo.' };
  return (
    <Pagina
      titulo="Conferência dos documentos"
      trilha={[
        { rotulo: 'Início', para: '/' },
        { rotulo: 'Jornada da contratação', para: '/jornada' },
        { rotulo: processo.data?.titulo ?? 'Processo', para: `/jornada/${encodeURIComponent(id)}` },
      ]}
      tela="jornada.conferencia"
      subtitulo={processo.data ? <span className="mono">{processo.data.numeroSei}</span> : undefined}
      acoes={
        <LinkBotao to={`/jornada/${encodeURIComponent(id)}`} icone={ArrowLeft}>
          Voltar ao processo
        </LinkBotao>
      }
    >
      <div className="pilha pilha--ampla">
        <Secao
          titulo="Conferência cruzada entre os documentos"
          id="conferencia-cruzada"
          descricao="Compara objeto, quantidades, valor estimado, prazos, dotação, modalidade e critério de julgamento na versão mais recente de cada documento."
        >
          <ConteudoConsulta consulta={cruzada} carregando={<EsqueletoTexto linhas={6} />} rotuloCarregando="Conferindo os documentos" naoEncontrado={naoEncontrado}>
            {(r) => <ConteudoCruzada r={r} />}
          </ConteudoConsulta>
        </Secao>
        <Secao
          titulo="Citações legais dos documentos"
          id="conferencia-citacoes"
          descricao="Cada citação da Lei 14.133/2021 conferida na base normativa da Ágora: dispositivo existente, em vigor e com o assunto do trecho."
        >
          <ConteudoConsulta consulta={citacoes} carregando={<EsqueletoTexto linhas={4} />} rotuloCarregando="Conferindo as citações" naoEncontrado={naoEncontrado}>
            {(lista) => <CitacoesPorDocumento lista={lista} />}
          </ConteudoConsulta>
        </Secao>
      </div>
    </Pagina>
  );
}
